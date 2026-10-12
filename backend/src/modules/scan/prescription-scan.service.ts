import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { GeminiPrescriptionService } from './gemini-prescription.service';
import { PrescriptionMatcherService, type VerifiedMedicine } from './prescription-matcher.service';
import { isPdf, sniffMimeType } from './file-type';
import { MAX_FILE_BYTES } from './dto/scan-prescription.dto';

/**
 * One prescription, read and then verified.
 *
 * The two halves are deliberately separate services: reading is a call to an
 * outside provider that may fail, be slow, or return nonsense, and verification
 * is a local catalog decision that must happen the same way no matter where the
 * text came from. Keeping them apart is what lets the catalog layer be tested
 * without a provider and the provider layer be swapped without touching the
 * catalog rules.
 *
 * Nothing is persisted. The bytes exist for the life of the request and are
 * never written to disk, never logged, and never sent anywhere but the model.
 */

export interface PrescriptionScanResult {
  success: true;
  source: { type: 'image' | 'pdf' };
  medicines: VerifiedMedicine[];
  message?: string;
}

/** What the patient is told when the page could not be read. Never a guess. */
const NOTHING_READ =
  "We couldn't confidently identify any medicines from this prescription.";

@Injectable()
export class PrescriptionScanService {
  private readonly logger = new Logger(PrescriptionScanService.name);

  constructor(
    private readonly gemini: GeminiPrescriptionService,
    private readonly matcher: PrescriptionMatcherService,
  ) {}

  availability(): { available: boolean; reason?: string } {
    return this.gemini.availability();
  }

  async scan(dataUrl: string): Promise<PrescriptionScanResult> {
    const started = Date.now();
    const bytes = decode(dataUrl);

    if (!bytes.length) {
      throw new BadRequestException('That file is empty.');
    }
    if (bytes.length > MAX_FILE_BYTES) {
      throw new PayloadTooLargeException(
        'That file is larger than 10 MB. Try a smaller photo, or a single-prescription PDF.',
      );
    }

    // The bytes decide, not the declared type and not the filename.
    const mimeType = sniffMimeType(bytes);
    if (!mimeType) {
      throw new UnsupportedMediaTypeException(
        'That file is not a JPG, PNG, WebP or PDF, or it is damaged. Try uploading it again.',
      );
    }

    // Operational metadata only: type, size, timing, counts. Never the bytes,
    // never the extracted text, never anything off the prescription itself.
    this.logger.log(`Prescription scan started: ${mimeType}, ${bytes.length} bytes`);

    const readStarted = Date.now();
    const extracted = await this.gemini.extract(bytes.toString('base64'), mimeType);
    const readMs = Date.now() - readStarted;

    const matchStarted = Date.now();
    const medicines = await this.matcher.verifyAll(extracted);
    const matchMs = Date.now() - matchStarted;

    const counts = medicines.reduce<Record<string, number>>((acc, m) => {
      acc[m.verification.status] = (acc[m.verification.status] ?? 0) + 1;
      return acc;
    }, {});
    this.logger.log(
      `Prescription scan done: read ${readMs}ms, match ${matchMs}ms, total ${Date.now() - started}ms, ` +
        `${medicines.length} medicine(s) ${JSON.stringify(counts)}`,
    );

    return {
      success: true,
      source: { type: isPdf(mimeType) ? 'pdf' : 'image' },
      medicines,
      ...(medicines.length ? {} : { message: NOTHING_READ }),
    };
  }
}

/** Bytes out of a `data:<mime>;base64,<payload>` envelope. */
function decode(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) throw new BadRequestException('That upload is not a readable file.');
  try {
    return Buffer.from(dataUrl.slice(comma + 1), 'base64');
  } catch {
    throw new BadRequestException('That upload is not a readable file.');
  }
}
