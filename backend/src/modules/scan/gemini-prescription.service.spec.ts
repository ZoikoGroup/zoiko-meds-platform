import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GeminiPrescriptionService } from './gemini-prescription.service';

/**
 * The prescription reader.
 *
 * Two things are load-bearing. It must be *off*, and say so, when the
 * deployment has no key, because the scan UI decides whether to offer the
 * feature from that answer. And it must never let a provider error reach a
 * response body or a log line: those errors routinely echo the request back,
 * and the request is somebody's prescription.
 *
 * Everything here mocks the SDK. No test in this suite spends real quota.
 */

const generateContent = jest.fn();
jest.mock('@google/genai', () => ({
  __esModule: true,
  GoogleGenAI: class {
    models = { generateContent: (...args: unknown[]) => generateContent(...args) };
  },
}));

const configWith = (env: Record<string, string>) =>
  ({ get: (key: string, fallback = '') => env[key] ?? fallback }) as unknown as ConfigService;

const KEY = 'not-a-real-key';
const service = () => new GeminiPrescriptionService(configWith({ GEMINI_API_KEY: KEY }));

/** The models the chain actually asked, in order. */
const modelsTried = () =>
  generateContent.mock.calls.map((call) => (call[0] as { model: string }).model);

/** A provider reply carrying `body` as the model's JSON answer. */
const reply = (body: unknown) => ({ text: JSON.stringify(body) });

const ONE = {
  medicines: [
    { rawText: 'Dolo 650 mg Tablet', name: 'Dolo', strength: '650 mg', dosageForm: 'tablet',
      dose: '1 tablet', frequency: 'BD', duration: '3 days', route: null, instructions: null },
  ],
};

beforeEach(() => {
  jest.restoreAllMocks();
  generateContent.mockReset();
});

describe('availability', () => {
  it('is unavailable, with a reason, when no key is configured', () => {
    expect(new GeminiPrescriptionService(configWith({})).availability()).toEqual({
      available: false,
      reason: expect.stringMatching(/not configured/i),
    });
  });

  it('is available once a key is set', () => {
    expect(service().availability()).toEqual({ available: true });
  });

  it('never puts the key in the availability answer', () => {
    const answer = JSON.stringify(service().availability());

    expect(answer).not.toContain(KEY);
  });

  it('does not call the provider at all without a key', async () => {
    const unconfigured = new GeminiPrescriptionService(configWith({}));

    await expect(unconfigured.extract('AAAA', 'image/png')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(generateContent).not.toHaveBeenCalled();
  });
});

describe('the request it builds', () => {
  it('sends the document inline, under the type it was given', async () => {
    generateContent.mockResolvedValue(reply({ medicines: [] }));

    await service().extract('QkFTRTY0', 'application/pdf');

    const [request] = generateContent.mock.calls[0] as [Record<string, any>];
    const parts = request.contents[0].parts;
    expect(parts[1].inlineData).toEqual({ mimeType: 'application/pdf', data: 'QkFTRTY0' });
  });

  it('asks for schema-shaped JSON rather than prose', async () => {
    generateContent.mockResolvedValue(reply({ medicines: [] }));

    await service().extract('AAAA', 'image/png');

    const [request] = generateContent.mock.calls[0] as [Record<string, any>];
    expect(request.config.responseMimeType).toBe('application/json');
    expect(request.config.responseSchema).toBeDefined();
    // The page says what it says; sampling would only invent variation.
    expect(request.config.temperature).toBe(0);
  });

  it('instructs the model to transcribe, not to identify', async () => {
    generateContent.mockResolvedValue(reply({ medicines: [] }));

    await service().extract('AAAA', 'image/png');

    const [request] = generateContent.mock.calls[0] as [Record<string, any>];
    const prompt = request.contents[0].parts[0].text as string;
    expect(prompt).toMatch(/do not invent/i);
    expect(prompt).toMatch(/do not add generic names, manufacturers or drug classes/i);
    expect(prompt).toMatch(/handwritten/i);
    expect(prompt).toMatch(/do not infer the most likely medicine/i);
    expect(prompt).toMatch(/return name as null/i);
    expect(prompt).toMatch(/every page/i);
  });

  it('leads with a verified model and keeps the rest as fallbacks', () => {
    expect(service().models()).toEqual([
      'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite',
    ]);
    expect(service().model()).toBe('gemini-3.5-flash');
  });

  it('lets GEMINI_MODEL lead the chain without disabling the fallbacks', () => {
    // The point of the chain is that one exhausted model does not take the
    // feature down, so naming a primary reorders it rather than pinning to it.
    const chain = new GeminiPrescriptionService(
      configWith({ GEMINI_API_KEY: KEY, GEMINI_MODEL: 'gemini-3.8-flash' }),
    ).models();

    expect(chain[0]).toBe('gemini-3.8-flash');
    expect(chain).toContain('gemini-3.5-flash');
    expect(new Set(chain).size).toBe(chain.length);
  });

  it('lets GEMINI_PRESCRIPTION_MODELS replace the chain outright', () => {
    expect(
      new GeminiPrescriptionService(
        configWith({ GEMINI_API_KEY: KEY, GEMINI_PRESCRIPTION_MODELS: ' a , b ,, a ' }),
      ).models(),
    ).toEqual(['a', 'b']);
  });
});

describe('reading a document', () => {
  it('returns one medicine from a single-medicine page', async () => {
    generateContent.mockResolvedValue(reply(ONE));

    const out = await service().extract('AAAA', 'image/png');

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ name: 'Dolo', strength: '650 mg', frequency: 'BD' });
  });

  it('returns every medicine from a page carrying several', async () => {
    generateContent.mockResolvedValue(
      reply({
        medicines: [
          { rawText: 'Dolo 650', name: 'Dolo', strength: '650 mg' },
          { rawText: 'Pantop 40', name: 'Pantop', strength: '40 mg' },
          { rawText: 'Azithral 500', name: 'Azithral', strength: '500 mg' },
        ],
      }),
    );

    const out = await service().extract('AAAA', 'image/png');

    expect(out.map((m) => m.name)).toEqual(['Dolo', 'Pantop', 'Azithral']);
  });

  it('returns nothing, rather than a guess, when the page cannot be read', async () => {
    generateContent.mockResolvedValue(reply({ medicines: [] }));

    expect(await service().extract('AAAA', 'image/png')).toEqual([]);
  });

  it('fills absent fields with null instead of inventing them', async () => {
    generateContent.mockResolvedValue(
      reply({ medicines: [{ rawText: 'Dolo', name: 'Dolo' }] }),
    );

    const [medicine] = await service().extract('AAAA', 'image/png');

    expect(medicine.strength).toBeNull();
  });

  it('cannot carry a canonical identity, whatever the model returns', async () => {
    // The reader transcribes; MediBase identifies. Nothing it emits may claim a
    // generic name, a manufacturer or a catalog id — not even when the model
    // volunteers them, which a model asked about medicines will do.
    //
    // ExtractedMedicine has no such fields, so TypeScript rejects reading them
    // at all; this holds the same line at runtime, where the provider's JSON is
    // the untyped thing actually arriving.
    generateContent.mockResolvedValue(
      reply({
        medicines: [
          {
            rawText: 'Dolo 650',
            name: 'Dolo',
            genericName: 'Paracetamol',
            manufacturer: 'Micro Labs Ltd',
            medicineId: 'spoofed-id',
          },
        ],
      }),
    );

    const [medicine] = await service().extract('AAAA', 'image/png');

    expect(Object.keys(medicine).sort()).toEqual([
      'dosageForm', 'dose', 'duration', 'frequency', 'instructions', 'isUncertain',
      'name', 'rawText', 'route', 'strength', 'uncertainFields', 'uncertainText',
    ]);
    const asRecord = medicine as unknown as Record<string, unknown>;
    expect(asRecord.genericName).toBeUndefined();
    expect(asRecord.manufacturer).toBeUndefined();
    expect(asRecord.medicineId).toBeUndefined();
  });

  it('treats the word "null" as absence, which models write when asked for null', async () => {
    generateContent.mockResolvedValue(
      reply({ medicines: [{ rawText: 'Dolo', name: 'Dolo', strength: 'N/A', route: 'null' }] }),
    );

    const [medicine] = await service().extract('AAAA', 'image/png');

    expect(medicine.strength).toBeNull();
    expect(medicine.route).toBeNull();
  });

  it('keeps a row whose name could not be read, marked uncertain', async () => {
    // This used to be dropped. Dropping it loses a prescribed medicine without
    // saying so; keeping it sends the line to the patient to confirm, which is
    // the whole point of handwriting support.
    generateContent.mockResolvedValue(
      reply({ medicines: [{ rawText: 'Amo... 500', name: '' }, { rawText: 'Dolo', name: 'Dolo' }] }),
    );

    const out = await service().extract('AAAA', 'image/png');

    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      rawText: 'Amo... 500',
      name: null,
      isUncertain: true,
      uncertainFields: ['name'],
    });
    expect(out[1]).toMatchObject({ name: 'Dolo', isUncertain: false });
  });

  it('drops a row with nothing readable on it at all', async () => {
    generateContent.mockResolvedValue(reply({ medicines: [{ rawText: '', name: '' }] }));

    expect(await service().extract('AAAA', 'image/png')).toEqual([]);
  });
});

describe('output it cannot trust', () => {
  it('returns nothing when the reply is not JSON', async () => {
    generateContent.mockResolvedValue({ text: 'Sorry, I could not read that.' });

    expect(await service().extract('AAAA', 'image/png')).toEqual([]);
  });

  it('returns nothing when the reply has no medicines array', async () => {
    generateContent.mockResolvedValue(reply({ result: 'ok' }));

    expect(await service().extract('AAAA', 'image/png')).toEqual([]);
  });

  it('returns nothing when the reply is empty', async () => {
    generateContent.mockResolvedValue({ text: '' });

    expect(await service().extract('AAAA', 'image/png')).toEqual([]);
  });

  it('skips entries that are not objects rather than failing the whole scan', async () => {
    generateContent.mockResolvedValue(
      reply({ medicines: ['Dolo 650', null, { rawText: 'Pantop 40', name: 'Pantop' }] }),
    );

    const out = await service().extract('AAAA', 'image/png');

    expect(out.map((m) => m.name)).toEqual(['Pantop']);
  });
});

describe('provider failures', () => {
  const failWith = (status: number, name = 'ApiError') =>
    Object.assign(new Error(`${status} upstream`), { status, name });

  it('does not retry a 401 — the key is wrong, and trying again will not fix it', async () => {
    generateContent.mockRejectedValue(failWith(401));

    await expect(service().extract('AAAA', 'image/png')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('does not retry a 403', async () => {
    generateContent.mockRejectedValue(failWith(403));

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('walks the whole chain on 429, then gives up with a message about being busy', async () => {
    // One call per model, not three at the first one: the provider already said
    // the quota is gone, and asking again only spends latency.
    generateContent.mockRejectedValue(failWith(429));

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow(/busy/i);
    expect(generateContent).toHaveBeenCalledTimes(3);
    expect(modelsTried()).toEqual([
      'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite',
    ]);
  });

  it('moves to the next model on a 503 and succeeds there', async () => {
    // 503 is the model saying it cannot serve, so the next model is a better
    // answer than the same one again.
    generateContent
      .mockRejectedValueOnce(failWith(503))
      .mockResolvedValueOnce(reply(ONE));

    const out = await service().extract('AAAA', 'image/png');

    expect(out).toHaveLength(1);
    expect(generateContent).toHaveBeenCalledTimes(2);
    expect(modelsTried()).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
  });

  it('retries once on the same model for a failure that says nothing about it', async () => {
    // A dropped connection is not the model's fault, so it gets a second go
    // before the chain moves on.
    generateContent
      .mockRejectedValueOnce(Object.assign(new Error('socket hang up'), { name: 'FetchError' }))
      .mockResolvedValueOnce(reply(ONE));

    const out = await service().extract('AAAA', 'image/png');

    expect(out).toHaveLength(1);
    expect(modelsTried()).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash']);
  });

  it('reports a timeout as something the patient can act on', async () => {
    generateContent.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow(/too long/i);
  });

  it('never leaks the upstream error to the client', async () => {
    // Provider errors can echo the request back — a prescription, here.
    generateContent.mockRejectedValue(
      new Error('400 invalid_request: image data "PATIENT NAME, Amoxicillin 500mg"'),
    );

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow(
      /could not read this prescription/i,
    );
  });

  it('never writes the prescription, or the key, into a log line', async () => {
    const logged: string[] = [];
    const svc = service();
    for (const level of ['error', 'warn', 'log'] as const) {
      jest
        .spyOn((svc as unknown as { logger: Record<string, (m: string) => void> }).logger, level)
        .mockImplementation((message: string) => {
          logged.push(String(message));
        });
    }
    generateContent.mockRejectedValue(
      Object.assign(new Error('400: image data "PATIENT NAME, Amoxicillin 500mg"'), {
        name: 'BadRequestError',
        status: 400,
      }),
    );

    await expect(svc.extract('AAAA', 'image/png')).rejects.toThrow();

    const all = logged.join(' ');
    expect(all).not.toContain('PATIENT NAME');
    expect(all).not.toContain('Amoxicillin');
    expect(all).not.toContain(KEY);
    // Still says enough to debug with.
    expect(all).toContain('BadRequestError');
    expect(all).toContain('400');
  });
});

/**
 * Handwriting, at the reader.
 *
 * The reader's job here is to be *allowed* to fail. Everything downstream can
 * cope with "I could not read this"; nothing downstream can detect "I guessed".
 */
describe('uncertainty', () => {
  it('carries the uncertainty the model reported', async () => {
    generateContent.mockResolvedValue(
      reply({
        medicines: [
          {
            rawText: 'Amo... 500', name: null, strength: '500 mg',
            isUncertain: true, uncertainFields: ['name'], uncertainText: 'Amo... 500',
          },
        ],
      }),
    );

    const [medicine] = await service().extract('AAAA', 'image/png');

    expect(medicine).toMatchObject({
      name: null, strength: '500 mg', isUncertain: true,
      uncertainFields: ['name'], uncertainText: 'Amo... 500',
    });
  });

  it('treats a missing name as uncertain even when the model says otherwise', async () => {
    // Trusting the flag alone would let a nameless line through as confident.
    generateContent.mockResolvedValue(
      reply({ medicines: [{ rawText: '???? 500', name: null, isUncertain: false, uncertainFields: [] }] }),
    );

    const [medicine] = await service().extract('AAAA', 'image/png');

    expect(medicine.isUncertain).toBe(true);
    expect(medicine.uncertainFields).toContain('name');
  });

  it('infers uncertainty from a populated uncertainFields list', async () => {
    generateContent.mockResolvedValue(
      reply({ medicines: [{ rawText: 'Dolo ?50', name: 'Dolo', isUncertain: false, uncertainFields: ['strength'] }] }),
    );

    const [medicine] = await service().extract('AAAA', 'image/png');

    expect(medicine.isUncertain).toBe(true);
    expect(medicine.uncertainFields).toEqual(['strength']);
  });

  it('discards field names it does not recognise', async () => {
    generateContent.mockResolvedValue(
      reply({
        medicines: [{ rawText: 'Dolo 650', name: 'Dolo', isUncertain: true, uncertainFields: ['strength', 'colour', 42, null] }],
      }),
    );

    const [medicine] = await service().extract('AAAA', 'image/png');

    expect(medicine.uncertainFields).toEqual(['strength']);
  });

  it('defaults to certain when the model says nothing about it', async () => {
    generateContent.mockResolvedValue(reply({ medicines: [{ rawText: 'Dolo 650', name: 'Dolo' }] }));

    const [medicine] = await service().extract('AAAA', 'image/png');

    expect(medicine.isUncertain).toBe(false);
    expect(medicine.uncertainFields).toEqual([]);
    expect(medicine.uncertainText).toBeNull();
  });

  it('asks the schema for uncertainty, so it is not left to prose', async () => {
    generateContent.mockResolvedValue(reply({ medicines: [] }));

    await service().extract('AAAA', 'image/png');

    const [request] = generateContent.mock.calls[0] as [Record<string, any>];
    const item = request.config.responseSchema.properties.medicines.items;
    expect(item.properties.isUncertain).toBeDefined();
    expect(item.properties.uncertainFields).toBeDefined();
    expect(item.properties.uncertainText).toBeDefined();
    expect(item.properties.name.nullable).toBe(true);
    expect(item.required).toContain('isUncertain');
  });
});

/**
 * The model chain.
 *
 * A single model running out of quota used to take the whole feature down —
 * that is not hypothetical, it happened during development. The chain exists so
 * that an exhausted model costs one wasted call, not the scan.
 *
 * The rule underneath every test here: move on for anything the provider says
 * about *this model*, stay put for anything it says about *this request*.
 */
describe('falling back to the next model', () => {
  const failWith = (status: number, name = 'ApiError', message = `${status} upstream`) =>
    Object.assign(new Error(message), { status, name });

  const resourceExhausted = () =>
    Object.assign(new Error('RESOURCE_EXHAUSTED: quota exceeded for this model'), {
      name: 'ApiError',
    });

  it('never reaches the fallbacks when the first model answers', async () => {
    generateContent.mockResolvedValue(reply(ONE));

    await service().extract('AAAA', 'image/png');

    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(modelsTried()).toEqual(['gemini-3.5-flash']);
  });

  it('moves to the second model on a 429', async () => {
    generateContent.mockRejectedValueOnce(failWith(429)).mockResolvedValueOnce(reply(ONE));

    const out = await service().extract('AAAA', 'image/png');

    expect(out).toHaveLength(1);
    expect(modelsTried()).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
  });

  it('moves on for RESOURCE_EXHAUSTED even without an HTTP status', async () => {
    // The SDK does not always attach a status; the provider's own wording is
    // enough to know this model has nothing left.
    generateContent.mockRejectedValueOnce(resourceExhausted()).mockResolvedValueOnce(reply(ONE));

    await service().extract('AAAA', 'image/png');

    expect(modelsTried()).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
  });

  it('extracts normally once a fallback succeeds', async () => {
    generateContent.mockRejectedValueOnce(failWith(429)).mockResolvedValueOnce(reply(ONE));

    const [medicine] = await service().extract('AAAA', 'image/png');

    // Same contract from a fallback as from the primary — nothing about the
    // medicine depends on which model read it.
    expect(medicine).toMatchObject({ name: 'Dolo', strength: '650 mg', isUncertain: false });
  });

  it('reaches the third model when the first two are exhausted', async () => {
    generateContent
      .mockRejectedValueOnce(failWith(429))
      .mockRejectedValueOnce(resourceExhausted())
      .mockResolvedValueOnce(reply(ONE));

    await service().extract('AAAA', 'image/png');

    expect(modelsTried()).toEqual([
      'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-3.1-flash-lite',
    ]);
  });

  it('gives the patient the existing safe message when every model is spent', async () => {
    generateContent.mockRejectedValue(failWith(429));

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow(/busy/i);
    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('spends exactly one call per exhausted model', async () => {
    // The whole point of not retrying a quota error: three models, three calls.
    generateContent.mockRejectedValue(resourceExhausted());

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow();

    expect(generateContent).toHaveBeenCalledTimes(3);
  });

  it('does not fall back on a 400 — a bad request stays bad', async () => {
    generateContent.mockRejectedValue(failWith(400));

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow();
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(modelsTried()).toEqual(['gemini-3.5-flash']);
  });

  it('does not fall back on an authentication failure', async () => {
    generateContent.mockRejectedValue(failWith(401, 'ApiError', 'API key not valid'));

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('does not fall back on a permission error', async () => {
    generateContent.mockRejectedValue(failWith(403, 'ApiError', 'PERMISSION_DENIED'));

    await expect(service().extract('AAAA', 'image/png')).rejects.toThrow();
    expect(generateContent).toHaveBeenCalledTimes(1);
  });

  it('skips a model this key cannot use rather than failing the scan', async () => {
    generateContent
      .mockRejectedValueOnce(failWith(404, 'ApiError', 'models/x is not found'))
      .mockResolvedValueOnce(reply(ONE));

    await service().extract('AAAA', 'image/png');

    expect(modelsTried()).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
  });

  it('sends every model the same prompt and schema', async () => {
    generateContent.mockRejectedValueOnce(failWith(429)).mockResolvedValueOnce(reply(ONE));

    await service().extract('AAAA', 'image/png');

    const [first, second] = generateContent.mock.calls as Array<[Record<string, any>]>;
    expect(second[0].contents[0].parts[0].text).toBe(first[0].contents[0].parts[0].text);
    expect(second[0].config.responseSchema).toBe(first[0].config.responseSchema);
    expect(second[0].config.temperature).toBe(0);
    expect(second[0].contents[0].parts[1].inlineData).toEqual(
      first[0].contents[0].parts[1].inlineData,
    );
  });

  it('names models in the log but never the prescription', async () => {
    const logged: string[] = [];
    const svc = service();
    for (const level of ['error', 'warn', 'log'] as const) {
      jest
        .spyOn((svc as unknown as { logger: Record<string, (m: string) => void> }).logger, level)
        .mockImplementation((message: string) => {
          logged.push(String(message));
        });
    }
    generateContent
      .mockRejectedValueOnce(
        Object.assign(new Error('429 quota exceeded; image data "PATIENT NAME, Amoxicillin 500mg"'), {
          status: 429, name: 'ApiError',
        }),
      )
      .mockResolvedValueOnce(reply(ONE));

    await svc.extract('AAAA', 'image/png');

    const all = logged.join(' ');
    expect(all).toContain('gemini-3.5-flash');
    expect(all).toContain('gemini-3.8-flash');
    expect(all).not.toContain('PATIENT NAME');
    expect(all).not.toContain('Amoxicillin');
    expect(all).not.toContain(KEY);
  });
});

/**
 * Regressions from the production audit.
 *
 * Three defects, all of which disabled the fallback chain in exactly the
 * situations it exists for, and none of which the original tests could catch —
 * they were written around the behaviour intended rather than the inputs a
 * provider actually produces.
 */
describe('audit regressions', () => {
  const E = (message: string, extra: Record<string, unknown> = {}) =>
    Object.assign(new Error(message), extra);

  describe('a prescription dose is not an HTTP status', () => {
    // The original statusOf() scraped a three-digit number out of the error
    // message. Provider errors echo the request, and prescriptions are full of
    // three-digit doses, so "Trental 400 mg" became HTTP 400 — fatal — and the
    // chain stopped for a medicine nobody could dispense.
    it('does not read "Trental 400 mg" as a 400 and stop the chain', async () => {
      generateContent
        .mockRejectedValueOnce(E('upstream failure: Trental 400 mg'))
        .mockResolvedValueOnce(reply(ONE));

      const out = await service().extract('AAAA', 'image/png');

      expect(out).toHaveLength(1);
      // Treated as transient: one same-model retry, which succeeded.
      expect(modelsTried()).toEqual(['gemini-3.5-flash', 'gemini-3.5-flash']);
    });

    it('does not read "Amoxicillin 500 mg" as a 500', async () => {
      generateContent
        .mockRejectedValueOnce(E('upstream failure: Amoxicillin 500 mg'))
        .mockResolvedValueOnce(reply(ONE));

      await expect(service().extract('AAAA', 'image/png')).resolves.toHaveLength(1);
    });

    it('does not read "403 mg" as a 403', async () => {
      generateContent
        .mockRejectedValueOnce(E('odd dose 403 mg'))
        .mockResolvedValueOnce(reply(ONE));

      // A 403 would have been fatal and ended the request on the first call.
      await expect(service().extract('AAAA', 'image/png')).resolves.toHaveLength(1);
      expect(generateContent).toHaveBeenCalledTimes(2);
    });
  });

  describe('an explicit status outranks the message', () => {
    it('falls back on a 429 that happens to mention the API key', async () => {
      // The quota error the chain exists to survive, previously classified
      // fatal on the words "API key".
      generateContent
        .mockRejectedValueOnce(E('Quota exceeded for API key', { status: 429 }))
        .mockResolvedValueOnce(reply(ONE));

      await expect(service().extract('AAAA', 'image/png')).resolves.toHaveLength(1);
      expect(modelsTried()).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
    });

    it('falls back on "quota exceeded for API key" with a 429', async () => {
      generateContent
        .mockRejectedValueOnce(E('quota exceeded for API key abc123', { status: 429 }))
        .mockResolvedValueOnce(reply(ONE));

      await expect(service().extract('AAAA', 'image/png')).resolves.toHaveLength(1);
      expect(generateContent).toHaveBeenCalledTimes(2);
    });

    it('stays fatal on a 401 whose message says quota', async () => {
      generateContent.mockRejectedValue(E('quota exceeded', { status: 401 }));

      await expect(service().extract('AAAA', 'image/png')).rejects.toThrow();
      expect(generateContent).toHaveBeenCalledTimes(1);
    });

    it('stays fatal on a 400 whose message says rate limit', async () => {
      generateContent.mockRejectedValue(E('rate limit mentioned in user text', { status: 400 }));

      await expect(service().extract('AAAA', 'image/png')).rejects.toThrow();
      expect(generateContent).toHaveBeenCalledTimes(1);
    });

    it('reads a statusCode field as well as status', async () => {
      generateContent
        .mockRejectedValueOnce(E('something', { statusCode: 429 }))
        .mockResolvedValueOnce(reply(ONE));

      await expect(service().extract('AAAA', 'image/png')).resolves.toHaveLength(1);
      expect(modelsTried()).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
    });
  });

  describe('the overall deadline actually bounds the request', () => {
    /**
     * Freeze the clock, then jump it forward once `heldFor` readings have been
     * taken. `extract()` reads the clock to stamp the start, to check the
     * deadline before a model, and again to size that model's attempt — so
     * holding for two readings puts the jump inside the first attempt, and
     * holding for three puts it between the first model and the second.
     */
    const clockThatJumpsTo = (elapsedMs: number, heldFor = 2) => {
      const t0 = 1_000_000;
      let reads = 0;
      return jest.spyOn(Date, 'now').mockImplementation(() => {
        reads += 1;
        return reads <= heldFor ? t0 : t0 + elapsedMs;
      });
    };

    /** Delays handed to setTimeout during the call — the abort timers. */
    const captureTimeouts = () => {
      const delays: number[] = [];
      const real = global.setTimeout;
      jest.spyOn(global, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
        if (typeof ms === 'number') delays.push(ms);
        return real(fn, 0);
      }) as unknown as typeof setTimeout);
      return delays;
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('gives an attempt only the time that is left, not the full 60s', async () => {
      // 95s gone of a 100s budget: the next call must be bounded at ~5s, never
      // at the 60s per-attempt ceiling.
      clockThatJumpsTo(95_000);
      const delays = captureTimeouts();
      generateContent.mockResolvedValue(reply(ONE));

      await service().extract('AAAA', 'image/png');

      const abortDelays = delays.filter((ms) => ms > 0);
      expect(abortDelays.length).toBeGreaterThan(0);
      expect(Math.max(...abortDelays)).toBeLessThanOrEqual(5_000);
    });

    it('does not start another model once the deadline has passed', async () => {
      // The first model gets its turn and reports quota exhausted; by the time
      // the chain would move on, the budget is gone.
      clockThatJumpsTo(200_000, 3);
      generateContent.mockRejectedValue(Object.assign(new Error('429'), { status: 429 }));

      await expect(service().extract('AAAA', 'image/png')).rejects.toThrow();

      // One call, not three: the chain stopped instead of walking models that
      // could not finish in time.
      expect(generateContent).toHaveBeenCalledTimes(1);
      expect(modelsTried()).toEqual(['gemini-3.5-flash']);
    });

    it('does not call the provider at all if the budget is already gone', async () => {
      clockThatJumpsTo(200_000, 2);
      generateContent.mockResolvedValue(reply(ONE));

      await expect(service().extract('AAAA', 'image/png')).rejects.toThrow(/too long/i);

      expect(generateContent).not.toHaveBeenCalled();
    });

    it('will not spend the last of the budget on a same-model retry', async () => {
      clockThatJumpsTo(99_900);
      generateContent.mockRejectedValue(new Error('socket hang up'));

      await expect(service().extract('AAAA', 'image/png')).rejects.toThrow(/too long/i);

      expect(generateContent).toHaveBeenCalledTimes(1);
    });
  });

  it('never lets a provider error carrying prescription text reach a log', async () => {
    const logged: string[] = [];
    const svc = service();
    for (const level of ['error', 'warn', 'log'] as const) {
      jest
        .spyOn((svc as unknown as { logger: Record<string, (m: string) => void> }).logger, level)
        .mockImplementation((message: string) => {
          logged.push(String(message));
        });
    }
    // Carries a dose, a patient name and no status — the exact shape that used
    // to be misread as an HTTP status as well as risk being leaked.
    generateContent.mockRejectedValue(new Error('PATIENT NAME, Amoxicillin 500mg'));

    await expect(svc.extract('AAAA', 'image/png')).rejects.toThrow();

    const all = logged.join(' ');
    expect(all).not.toContain('PATIENT NAME');
    expect(all).not.toContain('Amoxicillin');
    expect(all).not.toContain(KEY);
  });
});
