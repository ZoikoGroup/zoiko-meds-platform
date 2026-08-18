import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../../admin/audit.writer';

/**
 * The largest logo accepted, in bytes.
 *
 * Small on purpose. These bytes live in the database, and a brand mark rendered
 * at 64px needs nothing like a megabyte — a cap is what keeps storing images in
 * Postgres a reasonable decision rather than a slow leak into the hot backup path.
 */
export const MAX_LOGO_BYTES = 256 * 1024;

/** A file as it arrives from the upload interceptor. */
export interface UploadedLogo {
  buffer: Buffer;
  size: number;
  mimetype?: string;
  originalname?: string;
}

/**
 * Image types accepted, each recognised by its own leading bytes.
 *
 * The declared content type of an upload is written by the client and means
 * nothing: a request can claim image/png and carry an HTML document or a script.
 * The signature is read from the file itself and it is the stored mime type, so
 * what the download route replays can only ever be what was actually verified.
 *
 * SVG is deliberately absent. It is a document, not a raster image: it can carry
 * script and external references, and serving one from this origin would hand any
 * pharmacy a way to run code in a patient's browser.
 */
const SIGNATURES: Array<{ mimeType: string; matches: (b: Buffer) => boolean }> = [
  {
    mimeType: 'image/png',
    matches: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mimeType: 'image/jpeg',
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/webp',
    matches: (b) =>
      b.length > 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP',
  },
];

/** What a caller needs to render the logo, without the bytes. */
export interface StoredLogoMeta {
  mimeType: string;
  byteSize: number;
  updatedAt: Date;
}

/**
 * Pharmacy logo storage (MP-22).
 *
 * This service is the entire storage seam. It holds the image in Postgres because
 * that works on every deployment of this repo with no bucket, credentials or
 * mounted volume to provision. Replacing it with object storage means changing
 * save/find/remove here to write a URL instead of bytes; the upload route, the
 * download route, the DTOs and the portal are all written against this interface
 * and would not change.
 */
@Injectable()
export class PharmacyLogoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * Store or replace a pharmacy's logo, returning what the client needs to show it.
   *
   * The row and the pharmacy's logoUpdatedAt move together in one transaction: the
   * timestamp is what every list response reads to decide a logo exists, so a
   * committed image with no timestamp would be invisible, and a timestamp with no
   * image would render as a broken picture on the patient's screen.
   */
  async save(
    pharmacyId: string,
    file: UploadedLogo | undefined,
    actorId?: string,
    ipAddress?: string,
  ): Promise<StoredLogoMeta> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Choose an image file to upload.');
    }
    // Also enforced by the route's own limit; repeated here because this service
    // is the thing that guarantees what reaches the database.
    if (file.size > MAX_LOGO_BYTES || file.buffer.length > MAX_LOGO_BYTES) {
      throw new BadRequestException(
        `That image is too large. The maximum logo size is ${Math.floor(MAX_LOGO_BYTES / 1024)} KB.`,
      );
    }

    const signature = SIGNATURES.find((candidate) => candidate.matches(file.buffer));
    if (!signature) {
      throw new BadRequestException(
        'That file is not a PNG, JPEG or WebP image. SVG files are not accepted.',
      );
    }

    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { id: true },
    });
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');

    const updatedAt = new Date();
    const stored = {
      data: file.buffer,
      mimeType: signature.mimeType,
      byteSize: file.buffer.length,
    };

    await this.prisma.$transaction([
      this.prisma.pharmacyLogo.upsert({
        where: { pharmacyId },
        create: { pharmacyId, ...stored },
        update: stored,
      }),
      this.prisma.pharmacy.update({
        where: { id: pharmacyId },
        data: { logoUpdatedAt: updatedAt },
      }),
    ]);

    await this.audit.write(
      actorId ?? null,
      'pharmacy.logo.upload',
      'Pharmacy',
      pharmacyId,
      {
        module: 'Pharmacy',
        action: 'Logo Upload',
        mimeType: signature.mimeType,
        byteSize: stored.byteSize,
        declaredMimeType: file.mimetype ?? null,
      },
      ipAddress,
    );

    return { mimeType: signature.mimeType, byteSize: stored.byteSize, updatedAt };
  }

  /** The bytes and their type, or null when this pharmacy has no logo. */
  async find(
    pharmacyId: string,
  ): Promise<{ data: Buffer; mimeType: string; updatedAt: Date } | null> {
    const row = await this.prisma.pharmacyLogo.findUnique({ where: { pharmacyId } });
    if (!row) return null;
    return { data: Buffer.from(row.data), mimeType: row.mimeType, updatedAt: row.updatedAt };
  }

  /**
   * Remove the logo. Idempotent: a pharmacy with no logo is already in the state
   * the caller asked for, so this reports success rather than a missing row.
   */
  async remove(pharmacyId: string, actorId?: string, ipAddress?: string): Promise<void> {
    const { count } = await this.prisma.pharmacyLogo.deleteMany({ where: { pharmacyId } });
    // Cleared whatever the row said, so a stale timestamp cannot outlive the image.
    await this.prisma.pharmacy.updateMany({
      where: { id: pharmacyId },
      data: { logoUpdatedAt: null },
    });

    if (count > 0) {
      await this.audit.write(
        actorId ?? null,
        'pharmacy.logo.remove',
        'Pharmacy',
        pharmacyId,
        { module: 'Pharmacy', action: 'Logo Removed' },
        ipAddress,
      );
    }
  }
}

/**
 * The path a client fetches a logo from, relative to the API base — the same base
 * every other path in this API is relative to.
 *
 * Not an absolute URL: this API is reached through more than one origin (the SPA
 * proxies it under /internal), so a host baked in here would be wrong for someone.
 * The query string is the logo's own timestamp, which lets the download route be
 * cached hard while a replacement still appears immediately.
 */
export function logoUrlFor(
  pharmacyId: string,
  logoUpdatedAt: Date | null | undefined,
): string | null {
  if (!logoUpdatedAt) return null;
  return `/pharmacies/${pharmacyId}/logo?v=${logoUpdatedAt.getTime()}`;
}

/**
 * Replace a selected `logoUpdatedAt` with the URL a client should fetch.
 *
 * For the patient-facing reads that embed a pharmacy: they select the timestamp
 * rather than the image, and callers want a URL rather than a timestamp they would
 * have to know how to turn into one.
 */
export function withLogoUrl<T extends { id: string; logoUpdatedAt: Date | null }>(
  pharmacy: T,
): Omit<T, 'logoUpdatedAt'> & { logoUrl: string | null } {
  const { logoUpdatedAt, ...rest } = pharmacy;
  return { ...rest, logoUrl: logoUrlFor(pharmacy.id, logoUpdatedAt) };
}
