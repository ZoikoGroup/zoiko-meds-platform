import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

/**
 * AI/Vision fallback for prescription reading.
 *
 * On-device Tesseract OCR runs first in the browser; this service is the
 * second attempt for prescriptions it could not read — handwriting, low
 * contrast scans, unusual layouts. It is deliberately server-side: the API key
 * must never reach the SPA bundle.
 *
 * GOVERNANCE: images are held in memory for the duration of one request and
 * never written to disk or the database. The response carries medicine
 * candidates only; the caller still resolves them against MediBase and still
 * asks the patient to confirm. This service never claims a medicine is
 * dispensable, available, or correct.
 */

/** One medicine as read off the prescription image. */
export interface VisionMedicine {
  name: string;
  genericName?: string;
  strength?: string;
  form?: string;
  frequency?: string;
  duration?: string;
  /** The model's own certainty for this line, 0..1. */
  confidence: number;
}

const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    medicines: {
      type: 'array',
      description:
        'Every medicine legibly written on the prescription, in the order they appear. Empty when none can be read.',
      items: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description:
              'The medicine name exactly as written (brand or generic). Do not correct, expand or substitute it.',
          },
          genericName: {
            type: 'string',
            description: 'Generic/active ingredient, only if it is written on the prescription. Otherwise an empty string.',
          },
          strength: { type: 'string', description: 'e.g. "500 mg", "250mg/5ml". Empty string if absent.' },
          form: { type: 'string', description: 'e.g. "tablet", "syrup", "injection". Empty string if absent.' },
          frequency: { type: 'string', description: 'e.g. "BD", "1-0-1", "twice daily". Empty string if absent.' },
          duration: { type: 'string', description: 'e.g. "5 days". Empty string if absent.' },
          confidence: {
            type: 'number',
            description:
              'How legible this specific line was, from 0 to 1. Use a low value when the handwriting is ambiguous.',
          },
        },
        required: ['name', 'genericName', 'strength', 'form', 'frequency', 'duration', 'confidence'],
        additionalProperties: false,
      },
    },
  },
  required: ['medicines'],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = [
  'You transcribe medicine names from a photographed or scanned prescription for a medicine-availability search.',
  '',
  'Transcribe only what is legibly written. Report the name as written — do not correct spelling, expand',
  'abbreviations into a different product, or substitute a generic for a brand. If a line is ambiguous, transcribe',
  'your best reading and give it a low confidence rather than guessing between two candidates.',
  '',
  'Never invent a medicine. If nothing is legible, return an empty list — an empty result is correct and useful.',
  '',
  'Ignore everything that is not a prescribed medicine: patient and prescriber details, hospital or clinic names,',
  'addresses, dates, registration numbers, vital signs, diagnoses and general advice.',
  '',
  'You are transcribing, not advising. Do not comment on dosage appropriateness, interactions, or whether the',
  'prescription is valid.',
].join('\n');

@Injectable()
export class VisionService {
  private readonly logger = new Logger(VisionService.name);
  private client: Anthropic | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Configured and usable? Drives the UI's decision to offer the fallback. */
  isEnabled(): boolean {
    const key = this.config.get<string>('ANTHROPIC_API_KEY', '').trim();
    const enabled = this.config.get<string>('SCAN_VISION_ENABLED', 'true').trim().toLowerCase();
    return key.length > 0 && enabled !== 'false';
  }

  private getClient(): Anthropic {
    if (!this.client) {
      const apiKey = this.config.get<string>('ANTHROPIC_API_KEY', '').trim();
      if (!apiKey) {
        throw new ServiceUnavailableException('Assisted reading is not configured on this deployment.');
      }
      this.client = new Anthropic({ apiKey });
    }
    return this.client;
  }

  /**
   * Read medicines off one or more prescription page images.
   * Returns an empty array when nothing legible was found — never throws for
   * "no medicines", only for a genuine service failure.
   */
  async extractMedicines(images: string[]): Promise<VisionMedicine[]> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Assisted reading is not configured on this deployment.');
    }

    const client = this.getClient();
    const model = this.config.get<string>('SCAN_VISION_MODEL', 'claude-opus-5').trim() || 'claude-opus-5';

    const imageBlocks = images.map((dataUrl) => {
      const [header, data] = dataUrl.split(',', 2);
      const mediaType = header.slice('data:'.length, header.indexOf(';'));
      return {
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data },
      };
    });

    try {
      const response = await client.messages.create({
        model,
        max_tokens: 8000,
        system: SYSTEM_PROMPT,
        output_config: {
          // Extraction is a perception task, not a reasoning one — low effort
          // keeps latency down without costing accuracy.
          effort: 'low',
          format: { type: 'json_schema', schema: EXTRACTION_SCHEMA },
        },
        messages: [
          {
            role: 'user',
            content: [
              ...imageBlocks,
              {
                type: 'text',
                text:
                  'List every medicine legibly written on this prescription. ' +
                  'Return an empty list if none can be read.',
              },
            ],
          },
        ],
      });

      // Safety classifiers can decline; `content` is then empty or partial.
      if (response.stop_reason === 'refusal') {
        this.logger.warn('Vision extraction declined by safety classifiers.');
        throw new ServiceUnavailableException(
          'Assisted reading could not process this image. Please enter the medicine name manually.',
        );
      }

      const text = response.content.find((block) => block.type === 'text');
      if (!text || text.type !== 'text') return [];

      return this.parseMedicines(text.text);
    } catch (err) {
      if (err instanceof ServiceUnavailableException) throw err;
      // Never leak the upstream error body — it can echo request content.
      this.logger.error(
        `Vision extraction failed: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
      throw new ServiceUnavailableException(
        'Assisted reading is temporarily unavailable. Please try again or enter the medicine name manually.',
      );
    }
  }

  /** Parse and defensively re-validate the model's structured output. */
  private parseMedicines(raw: string): VisionMedicine[] {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.logger.warn('Vision extraction returned unparseable output.');
      return [];
    }

    const medicines = (parsed as { medicines?: unknown })?.medicines;
    if (!Array.isArray(medicines)) return [];

    return medicines
      .map((entry): VisionMedicine | null => {
        const item = entry as Record<string, unknown>;
        const name = typeof item.name === 'string' ? item.name.trim() : '';
        if (name.length < 2 || name.length > 120) return null;
        const confidence = typeof item.confidence === 'number' ? item.confidence : 0.5;
        return {
          name,
          genericName: typeof item.genericName === 'string' ? item.genericName.trim() : '',
          strength: typeof item.strength === 'string' ? item.strength.trim() : '',
          form: typeof item.form === 'string' ? item.form.trim() : '',
          frequency: typeof item.frequency === 'string' ? item.frequency.trim() : '',
          duration: typeof item.duration === 'string' ? item.duration.trim() : '',
          confidence: Math.min(1, Math.max(0, confidence)),
        };
      })
      .filter((entry): entry is VisionMedicine => entry !== null)
      .slice(0, 40);
  }
}
