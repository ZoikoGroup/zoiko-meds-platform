import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI } from '@google/genai';

/**
 * Reads a prescription document with Gemini.
 *
 * This service is a READER, not an identifier. It returns what is written on
 * the page and nothing more: no generic name it inferred, no manufacturer it
 * remembered, no medicine it thought was likely. Everything downstream treats
 * its output as untrusted text, and MediBase decides what a medicine actually
 * is (see prescription-matcher.service.ts).
 *
 * That boundary is the whole safety argument for the feature. A model that is
 * allowed to say "this is Paracetamol by Micro Labs" is a model that can invent
 * a medicine for an illegible line; a model that may only transcribe can, at
 * worst, transcribe badly — and a bad transcription fails to match the catalog
 * rather than producing a confident wrong answer.
 *
 * Images and PDFs both go to the model directly, as bytes. There is no OCR step
 * and no local PDF text extraction in front of it: Gemini reads the document
 * natively, including multi-page PDFs, which is what lets a medicine on page
 * four be found at all.
 */

/** One medicine exactly as written on the page. Only `rawText` is always present. */
export interface ExtractedMedicine {
  /** The line as it appears, kept verbatim so a human can always check the reading. */
  rawText: string;
  /**
   * Medicine or brand name as written — never corrected or expanded.
   *
   * Null when the handwriting could not be read. That is a real and useful
   * answer: a null name routes the line to the patient for confirmation, where
   * a guessed name would route it to a medicine nobody prescribed.
   */
  name: string | null;
  strength: string | null;
  dosageForm: string | null;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  route: string | null;
  instructions: string | null;

  /** The model could not read some part of this line confidently. */
  isUncertain: boolean;
  /** Which fields it was unsure of — 'name', 'strength', 'dose', and so on. */
  uncertainFields: string[];
  /**
   * The unclear glyphs as they appear, e.g. "Amo... 500".
   *
   * Kept separately from `rawText` so the patient can be shown exactly what the
   * reader struggled with, and so a partial reading can still seed a catalog
   * search without ever being treated as a name.
   */
  uncertainText: string | null;
}

/** Field names the schema allows in `uncertainFields`. Anything else is dropped. */
const UNCERTAIN_FIELD_NAMES = [
  'name', 'strength', 'dosageForm', 'dose', 'frequency', 'duration', 'route', 'instructions',
] as const;

/** What the model is asked to return. A subset of OpenAPI 3.0, which is what Gemini accepts. */
const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    medicines: {
      type: 'array',
      description:
        'Every medicine legibly written in the document, in the order they appear, across all pages. Empty when none can be read.',
      items: {
        type: 'object',
        properties: {
          rawText: {
            type: 'string',
            description: 'The medicine line exactly as written, including strength and directions.',
          },
          name: {
            type: 'string',
            nullable: true,
            description:
              'The medicine or brand name exactly as written. Do not correct, expand, translate or substitute it. ' +
              'Null when the handwriting cannot be read well enough to transcribe the name.',
          },
          strength: { type: 'string', nullable: true, description: 'e.g. "650 mg", "250mg/5ml". Null if not written.' },
          dosageForm: { type: 'string', nullable: true, description: 'e.g. "tablet", "syrup". Null if not written.' },
          dose: { type: 'string', nullable: true, description: 'e.g. "1 tablet". Null if not written.' },
          frequency: { type: 'string', nullable: true, description: 'e.g. "BD", "1-0-1". Null if not written.' },
          duration: { type: 'string', nullable: true, description: 'e.g. "5 days". Null if not written.' },
          route: { type: 'string', nullable: true, description: 'e.g. "oral". Null if not written.' },
          instructions: { type: 'string', nullable: true, description: 'e.g. "before food". Null if not written.' },
          isUncertain: {
            type: 'boolean',
            description:
              'True when any part of this line could not be read confidently — unclear handwriting, a smudge, ' +
              'an ambiguous digit. Prefer true over a confident guess.',
          },
          uncertainFields: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Which fields were unclear, by name: "name", "strength", "dosageForm", "dose", "frequency", ' +
              '"duration", "route", "instructions". Empty when the whole line was legible.',
          },
          uncertainText: {
            type: 'string',
            nullable: true,
            description:
              'The unclear glyphs transcribed as literally as possible, e.g. "Amo... 500" or "Dolo ?50". ' +
              'Null when nothing was unclear. Never a completed guess at what it might say.',
          },
        },
        required: ['rawText', 'isUncertain'],
      },
    },
  },
  required: ['medicines'],
} as const;

const PROMPT = [
  'You are extracting medication information from a prescription document.',
  'This may be a handwritten prescription.',
  '',
  'Transcribe only what is visibly readable. Extract only information present in',
  'the supplied document.',
  '',
  'Do not invent medicine names.',
  'Do not infer unreadable text.',
  'Do not infer the most likely medicine.',
  'Do not correct an unclear medicine into a medicine you think is likely.',
  'Do not expand an abbreviation into a medicine name unless the actual medicine',
  'text is readable. "Amox" stays "Amox" unless the page really says Amoxicillin.',
  'Do not add generic names, manufacturers or drug classes from your own knowledge.',
  '',
  'When handwriting is unclear:',
  '  - set isUncertain to true',
  '  - list the affected fields in uncertainFields',
  '  - put the unclear glyphs in uncertainText, as literally as you can read them',
  '    (for example "Amo... 500" or "Dolo ?50") — never a completed guess',
  '  - if the medicine name itself cannot be read, return name as null',
  '',
  'Preserve uncertain raw text exactly where possible. A line you are unsure of is',
  'more useful marked uncertain than transcribed confidently and wrongly: a human',
  'will be asked to confirm it, and nothing is dispensed from your answer.',
  '',
  'If a field cannot be read, return null for that field.',
  'Return every medicine visible in the prescription, including every page of a',
  'multi-page document.',
  'If nothing can be read at all, return an empty list rather than a guess.',
].join('\n');

/** Accepted inputs. Checked against sniffed bytes, never the filename. */
export const SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
] as const;

/** How long one document may spend at the provider before we give up on it. */
const REQUEST_TIMEOUT_MS = 60_000;

/**
 * A genuinely transient failure is retried this many times on the *same* model.
 *
 * One, not several. A network blip is worth a second attempt; anything the
 * provider has told us about the model itself is not, because the next model is
 * a better answer than the same model again.
 */
const SAME_MODEL_RETRIES = 1;

/** Backoff before that single same-model retry. */
const RETRY_DELAY_MS = 600;

/**
 * Total time the whole chain may take, across every model.
 *
 * The client gives up at 120s, so the backend stops short of that and answers
 * with its own safe message rather than letting the request die unexplained.
 */
const OVERALL_BUDGET_MS = 100_000;

/**
 * The model chain, tried in order.
 *
 * `gemini-3.5-flash` leads because it is the one verified against this
 * project's key end to end: a real prescription image and a two-page PDF both
 * came back complete and correctly shaped, in about six seconds. The other two
 * are there for the day its quota runs out — which is not hypothetical, it
 * happened during development and took the feature down with it.
 *
 * `gemini-3.8-flash` sits second rather than first for the same empirical
 * reason: it is permitted on this key but returned 503 "experiencing high
 * demand" on every attempt when it was tried as the primary.
 */
const DEFAULT_MODELS = ['gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite'] as const;

/**
 * What a failure means for the chain.
 *
 *   fatal        the request is wrong, or we are not allowed to make it. No
 *                other model will do better, so stop.
 *   exhausted    this model has no quota left. Moving on is the whole point of
 *                having a chain; retrying it would spend latency on a certainty.
 *   unavailable  this model cannot serve right now, or is not offered on this
 *                key. Also a model-specific condition, so also move on.
 *   transient    nothing model-specific — a network blip, an unattributed 5xx.
 *                Worth one more attempt on the same model before moving on.
 */
type FailureKind = 'fatal' | 'exhausted' | 'unavailable' | 'transient';

/**
 * Classify a provider failure.
 *
 * This reads the error's message, which is the one place that is allowed to:
 * the message can quote the request — and the request is a prescription — so it
 * is matched against here and never logged or returned. `describeFailure` is
 * what the logs get.
 */
function classify(err: unknown): FailureKind {
  const status = statusOf(err);

  // An explicit status is the provider's own verdict, so it is taken whole and
  // the message is not consulted at all. The message used to be able to
  // override it, which meant a genuine 429 reading "Quota exceeded for API key"
  // was classified fatal on the word "API key" — the one error the chain exists
  // to survive, turned into the one that stops it.
  if (status !== undefined) {
    if (status === 429) return 'exhausted';
    // A model this key cannot use is a chain problem, not a request problem:
    // skipping to the next one is right, failing the scan is not.
    if (status === 404 || status === 503) return 'unavailable';
    // A request timeout says nothing about the model.
    if (status === 408) return 'transient';
    if (status >= 400 && status < 500) return 'fatal';
    if (status >= 500) return 'transient';
    return 'transient';
  }

  // No structured status — fall back to the provider's own wording, which is
  // the only signal left. Matched against here and never logged or returned.
  const message = messageOf(err);
  if (!message) return 'transient';

  if (/\b(api[_ ]?key|unauthenticated|permission[_ ]denied|invalid[_ ]argument)\b/i.test(message)) {
    return 'fatal';
  }
  if (/resource[_ ]exhausted|quota|rate[_ ]?limit|per[- ]day/i.test(message)) return 'exhausted';
  if (/not[_ ]found|unsupported[_ ]model|model.*not.*available/i.test(message)) {
    return 'unavailable';
  }
  if (/unavailable|overloaded|high demand|capacity/i.test(message)) return 'unavailable';

  return 'transient';
}

/** Raised when the request's overall deadline has passed. Never reaches the client as-is. */
class DeadlineExceededError extends Error {
  constructor() {
    super('Prescription read deadline exceeded.');
    this.name = 'DeadlineExceededError';
  }
}

/**
 * Pull an HTTP status out of whatever the SDK threw.
 *
 * Deliberately narrow: the error's own message can quote the request, and the
 * request is a prescription. Only the status and the error's name are ever
 * taken from it.
 */
function statusOf(err: unknown): number | undefined {
  const e = err as {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  for (const value of [e?.status, e?.statusCode, e?.code, e?.response?.status]) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
      return value;
    }
    if (typeof value === 'string' && /^[1-5]\d{2}$/.test(value)) return Number(value);
  }
  // Deliberately nothing else. An earlier version scraped a three-digit number
  // out of the error message, which read prescription doses as status codes:
  // a provider error echoing "Trental 400 mg" became HTTP 400, was classified
  // fatal, and stopped the fallback chain for a medicine nobody could dispense.
  // A status is a structured field or it is absent.
  return undefined;
}

/** The error's message, for classification only — never for logging. */
function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message ?? '';
  if (typeof err === 'string') return err;
  const candidate = (err as { message?: unknown })?.message;
  return typeof candidate === 'string' ? candidate : '';
}

/**
 * A log-safe description of a failure.
 *
 * Provider errors routinely echo the request back, and the request is a
 * prescription — so the message is never logged. Type and status are what
 * actually help when reading logs anyway.
 */
function describeFailure(err: unknown): string {
  const name = err instanceof Error ? err.name : typeof err;
  const status = statusOf(err);
  return status === undefined ? name : `${name} (HTTP ${status})`;
}

/** A delay that does not, by itself, keep the process alive. */
const sleep = (ms: number) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // No-op in a browser; in Node it stops a pending backoff from holding the
    // event loop open, which is what leaves a test worker running after the
    // suite has finished.
    if (typeof timer === 'object' && timer && typeof timer.unref === 'function') timer.unref();
  });

@Injectable()
export class GeminiPrescriptionService {
  private readonly logger = new Logger(GeminiPrescriptionService.name);
  private client: GoogleGenAI | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Is prescription reading configured on this deployment? */
  availability(): { available: boolean; reason?: string } {
    const key = this.config.get<string>('GEMINI_API_KEY', '').trim();
    if (!key) {
      return {
        available: false,
        reason: 'Prescription scanning is not configured on this deployment.',
      };
    }
    return { available: true };
  }

  /**
   * The model chain, in the order it will be tried.
   *
   * `GEMINI_PRESCRIPTION_MODELS` (comma-separated) replaces the chain outright.
   * Otherwise `GEMINI_MODEL`, which already exists in deployments, becomes the
   * head of the default chain rather than pinning to one model — the point of
   * this change is that a single exhausted model stops taking the feature down.
   */
  models(): string[] {
    const configured = this.config.get<string>('GEMINI_PRESCRIPTION_MODELS', '').trim();
    if (configured) {
      const list = configured.split(',').map((name) => name.trim()).filter(Boolean);
      if (list.length) return [...new Set(list)];
    }

    const primary = this.config.get<string>('GEMINI_MODEL', '').trim();
    const chain = primary ? [primary, ...DEFAULT_MODELS] : [...DEFAULT_MODELS];
    return [...new Set(chain)];
  }

  /** The model tried first. Exposed so the status endpoint can report it to operators. */
  model(): string {
    return this.models()[0];
  }

  private getClient(): GoogleGenAI {
    if (!this.client) {
      const apiKey = this.config.get<string>('GEMINI_API_KEY', '').trim();
      if (!apiKey) {
        throw new ServiceUnavailableException(
          'Prescription scanning is not configured on this deployment.',
        );
      }
      this.client = new GoogleGenAI({
        apiKey,
        // Retries belong to this service, which knows that a 429 means "try the
        // next model" rather than "ask again". Left unset the SDK happens not
        // to retry, but that is an unpinned default (`DEFAULT_RETRY_ATTEMPTS`
        // is 5 the moment anything supplies a retryOptions object), and a
        // change to it would silently multiply every call count here by five.
        httpOptions: { retryOptions: { attempts: 1 } },
      });
    }
    return this.client;
  }

  /**
   * Read every medicine out of one prescription document.
   *
   * @param data      the document bytes, base64-encoded
   * @param mimeType  one of SUPPORTED_MIME_TYPES, sniffed from the bytes by the caller
   */
  async extract(data: string, mimeType: string): Promise<ExtractedMedicine[]> {
    const client = this.getClient();
    const models = this.models();
    const started = Date.now();

    // One deadline for the whole request, fixed here and never reset. Every
    // attempt and every retry, on every model, is bounded by what is left of
    // it — otherwise a single model's two 60s timeouts could spend the budget
    // twice over and the client would see a dead socket instead of an answer.
    const deadline = started + OVERALL_BUDGET_MS;

    let lastError: unknown;
    for (const [index, model] of models.entries()) {
      // A chain is only worth walking while anyone is still listening.
      if (Date.now() >= deadline) {
        this.logger.warn('Prescription read gave up: no time left to try another model.');
        lastError ??= new DeadlineExceededError();
        break;
      }

      try {
        const medicines = await this.extractWithModel(client, model, data, mimeType, deadline);
        this.logger.log(
          `Prescription read: ${mimeType}, ${medicines.length} medicine(s), ` +
            `${Date.now() - started}ms, model ${model}` +
            (index > 0 ? ` (fallback ${index} of ${models.length - 1})` : ''),
        );
        return medicines;
      } catch (err) {
        lastError = err;

        // Out of time: stop the chain rather than start a model that cannot
        // finish before the client gives up.
        if (err instanceof DeadlineExceededError) {
          this.logger.warn(`Prescription read ran out of time on ${model}.`);
          break;
        }

        const kind = classify(err);

        // Nothing another model can fix: a bad request stays bad, a bad key
        // stays bad. Failing now is faster and truer than failing three times.
        if (kind === 'fatal') break;

        const next = models[index + 1];
        this.logger.warn(
          `Prescription model ${kind}: ${model} (${describeFailure(err)})` +
            (next ? ` — trying fallback model: ${next}` : ' — no fallback models left'),
        );
      }
    }

    throw this.toHttpError(lastError, Date.now() - started);
  }

  /**
   * One model's turn.
   *
   * Retries here are only for failures that say nothing about the model —
   * a dropped connection, an unattributed 5xx. Quota exhaustion and model
   * unavailability are thrown straight back so the caller can move on, because
   * asking an exhausted model a second time spends latency to learn what the
   * provider already said.
   */
  private async extractWithModel(
    client: GoogleGenAI,
    model: string,
    data: string,
    mimeType: string,
    deadline: number,
  ): Promise<ExtractedMedicine[]> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= SAME_MODEL_RETRIES; attempt += 1) {
      // Every attempt, first or retry, is bounded by what is left of the
      // request's one deadline — so the chain can never start a 60-second call
      // with five seconds to go.
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new DeadlineExceededError();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
      if (typeof timer === 'object' && timer && typeof timer.unref === 'function') timer.unref();
      try {
        const response = await client.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [{ text: PROMPT }, { inlineData: { mimeType, data } }],
            },
          ],
          config: {
            // Identical for every model in the chain: same prompt, same schema,
            // same uncertainty rules. A fallback must not read a prescription
            // differently from the primary.
            //
            // `responseSchema` is marked deprecated in favour of
            // `response_format`, but it is what this project's key and model
            // were verified against — a live image and a two-page PDF both came
            // back schema-shaped. Moving to `response_format` is a change to
            // make deliberately, with the same verification, not as a side
            // effect of this work.
            responseMimeType: 'application/json',
            responseSchema: EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
            // The page says what it says. Nothing here benefits from sampling.
            temperature: 0,
            abortSignal: controller.signal,
          },
        });

        return this.parse(response.text ?? '');
      } catch (err) {
        lastError = err;
        if (classify(err) !== 'transient' || attempt === SAME_MODEL_RETRIES) throw err;

        // Only retry if the backoff plus a usable attempt still fit.
        if (deadline - Date.now() <= RETRY_DELAY_MS) throw new DeadlineExceededError();

        this.logger.warn(
          `Prescription read hiccup on ${model} (${describeFailure(err)}); retrying once.`,
        );
        await sleep(RETRY_DELAY_MS);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError;
  }

  /**
   * Turn a provider failure into something safe to show a patient.
   *
   * The upstream message never reaches the client: it can contain the request,
   * and the request is a prescription.
   */
  private toHttpError(err: unknown, elapsedMs: number): ServiceUnavailableException {
    const status = statusOf(err);
    this.logger.error(
      `Prescription read failed after ${elapsedMs}ms: ${describeFailure(err)}`,
    );

    if (status === 401 || status === 403) {
      return new ServiceUnavailableException(
        'Prescription scanning is not configured correctly. Please try again later.',
      );
    }
    if (status === 429) {
      return new ServiceUnavailableException(
        'Prescription scanning is busy right now. Please try again in a moment.',
      );
    }
    if (
      err instanceof DeadlineExceededError ||
      (err instanceof Error && err.name === 'AbortError')
    ) {
      return new ServiceUnavailableException(
        'Reading this prescription took too long. Try a smaller or clearer file.',
      );
    }
    return new ServiceUnavailableException(
      'Could not read this prescription right now. Please try again, or search by name.',
    );
  }

  /**
   * Parse and defensively re-validate the model's output.
   *
   * Schema-constrained output is a strong contract, not a guarantee: the field
   * could be absent, the JSON could be truncated by a token limit, a string
   * could arrive where a null was asked for. Anything that does not survive
   * this is dropped rather than passed on, because a half-read medicine is
   * worse than a missing one — the patient can rescan, but cannot tell that a
   * name was mangled.
   */
  private parse(raw: string): ExtractedMedicine[] {
    if (!raw.trim()) {
      this.logger.warn('Prescription read returned an empty body.');
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn('Prescription read returned unparseable output.');
      return [];
    }

    const list = (parsed as { medicines?: unknown })?.medicines;
    if (!Array.isArray(list)) {
      this.logger.warn('Prescription read returned no medicines array.');
      return [];
    }

    const out: ExtractedMedicine[] = [];
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      const row = entry as Record<string, unknown>;

      const name = text(row.name);
      const uncertainText = text(row.uncertainText);
      // `rawText` is the one thing a line cannot do without: it is what the
      // patient is shown when the name could not be read, and what seeds a
      // catalog search. A name is no longer required — an unreadable one is a
      // real answer, and dropping the row would silently lose a prescribed
      // medicine rather than asking about it.
      const rawText = text(row.rawText) ?? name ?? uncertainText;
      if (!rawText) continue;

      const uncertainFields = Array.isArray(row.uncertainFields)
        ? row.uncertainFields
            .map((field) => (typeof field === 'string' ? field.trim() : ''))
            .filter((field): field is (typeof UNCERTAIN_FIELD_NAMES)[number] =>
              (UNCERTAIN_FIELD_NAMES as readonly string[]).includes(field),
            )
        : [];

      // An unreadable name is uncertainty whether or not the model said so.
      // Trusting the flag alone would let a missing name through as confident.
      const isUncertain =
        row.isUncertain === true || uncertainFields.length > 0 || name === null;

      out.push({
        rawText,
        name,
        strength: text(row.strength),
        dosageForm: text(row.dosageForm),
        dose: text(row.dose),
        frequency: text(row.frequency),
        duration: text(row.duration),
        route: text(row.route),
        instructions: text(row.instructions),
        isUncertain,
        uncertainFields: name === null && !uncertainFields.includes('name')
          ? ['name', ...uncertainFields]
          : uncertainFields,
        uncertainText,
      });
    }
    return out;
  }
}

/** A trimmed string, or null for anything that is not usable text. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Models asked for "null if absent" sometimes write the word.
  if (/^(null|none|n\/a|unknown|not specified)$/i.test(trimmed)) return null;
  return trimmed;
}
