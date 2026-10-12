/**
 * What a file actually is, decided by its bytes.
 *
 * A filename is a claim the uploader makes; the magic number is the file. The
 * difference matters here because the bytes are forwarded to a model that will
 * try to interpret whatever MIME type we assert — sending a renamed .exe as
 * application/pdf wastes a request and returns nonsense, and sending a PDF
 * labelled image/png fails upstream with an error the patient cannot act on.
 */

/** MIME types the prescription reader accepts. */
export const SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;

export type SupportedMimeType = (typeof SUPPORTED_MIME_TYPES)[number];

/**
 * Identify a buffer, or null when it is not one of the supported types.
 *
 * Only the four accepted formats are detected; anything else is rejected rather
 * than guessed at.
 */
export function sniffMimeType(bytes: Buffer): SupportedMimeType | null {
  if (bytes.length < 12) return null;

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  // WebP: "RIFF" .... "WEBP"
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  // PDF: "%PDF-". Some producers emit leading whitespace or a UTF-8 BOM, so the
  // marker is looked for near the start rather than only at offset 0 — the spec
  // itself allows the header not to be the very first byte.
  const head = bytes.toString('ascii', 0, Math.min(bytes.length, 1024));
  if (head.includes('%PDF-')) return 'application/pdf';

  return null;
}

/** True for a type the reader treats as a document rather than a picture. */
export function isPdf(mimeType: string): boolean {
  return mimeType === 'application/pdf';
}
