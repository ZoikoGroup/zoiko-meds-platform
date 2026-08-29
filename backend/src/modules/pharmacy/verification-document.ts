import { BadRequestException } from '@nestjs/common';

/**
 * Reading a licence document off the wire.
 *
 * Everything here distrusts the upload. A filename is a label the client chose,
 * a MIME type is a string the client typed, and neither says anything about
 * what the bytes actually are — so the type is decided by inspecting the file
 * itself, and the name is reduced to something that can only ever be displayed.
 */

/**
 * 5 MB.
 *
 * A licence scan is a page or two. The ceiling is what stops one upload from
 * putting an unbounded blob through the request pipeline and into a row.
 */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** Base64 is ~4/3 of the bytes; the parser cap allows for that plus the envelope. */
export const MAX_DOCUMENT_BASE64_CHARS = Math.ceil((MAX_DOCUMENT_BYTES * 4) / 3) + 2048;

export interface AcceptedDocument {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
}

/**
 * File types a reviewer can actually open, matched on their leading bytes.
 *
 * PDF and the two raster formats a phone camera produces. Anything else — an
 * executable renamed to .pdf being the case that matters — fails to match and
 * is refused.
 */
const SIGNATURES: Array<{ mimeType: string; label: string; matches: (b: Buffer) => boolean }> = [
  {
    mimeType: 'application/pdf',
    label: 'PDF',
    matches: (b) => b.length > 4 && b.subarray(0, 5).toString('latin1') === '%PDF-',
  },
  {
    mimeType: 'image/jpeg',
    label: 'JPEG',
    matches: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeType: 'image/png',
    label: 'PNG',
    matches: (b) =>
      b.length > 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
];

/**
 * Reduce a client-supplied filename to something safe to store and display.
 *
 * Only the basename survives, so "../../etc/passwd" cannot escape anything, and
 * the result is never used as a path in any case — the bytes live in a column.
 * It is a label, and it is treated as one.
 */
export function safeFilename(raw: string | null | undefined, fallbackExtension: string): string {
  const base = String(raw ?? '')
    // Take the last segment of either separator, so a path is discarded.
    .split(/[\\/]/)
    .pop()
    ?.trim();

  const cleaned = Array.from(base ?? '')
    // Drop control characters by code point rather than with a literal
    // control-character class, which is unreadable and a lint error.
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
    .join('')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    // A leading dot hides the file on unix-like systems and reads oddly here.
    .replace(/^\.+/, '')
    .slice(0, 120)
    .trim();

  if (!cleaned) return `licence-document${fallbackExtension}`;
  if (cleaned.includes('.')) return cleaned;
  // Truncating first and appending after would push the result past the cap;
  // leave room for the extension instead.
  return `${cleaned.slice(0, 120 - fallbackExtension.length)}${fallbackExtension}`;
}

const EXTENSION_FOR: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
};

/**
 * Decode and check an uploaded document.
 *
 * Accepts a bare base64 string or a data URL — the client sends whichever the
 * browser produced. The declared type in a data URL is read but never trusted:
 * the leading bytes decide, and a mismatch is simply a file we refuse.
 *
 * Throws BadRequestException with something the operator can act on. There is
 * no "unsupported but stored anyway" path.
 */
export function readVerificationDocument(input: {
  filename?: string | null;
  content?: string | null;
}): AcceptedDocument {
  const raw = String(input.content ?? '').trim();
  if (!raw) {
    throw new BadRequestException('Select a licence document to upload.');
  }

  const base64 = raw.startsWith('data:') ? raw.slice(raw.indexOf(',') + 1) : raw;
  // A zero-byte file reaches us as a data URL with nothing after the comma.
  // "That file is empty" is what happened; "could not be read" is not.
  if (!base64) {
    throw new BadRequestException('That file is empty. Choose a licence document and retry.');
  }
  if (!/^[A-Za-z0-9+/\r\n]+={0,2}$/.test(base64)) {
    throw new BadRequestException('That file could not be read. Choose the file again and retry.');
  }

  let data: Buffer;
  try {
    data = Buffer.from(base64, 'base64');
  } catch {
    throw new BadRequestException('That file could not be read. Choose the file again and retry.');
  }

  if (data.length === 0) {
    throw new BadRequestException('That file is empty. Choose a licence document and retry.');
  }
  if (data.length > MAX_DOCUMENT_BYTES) {
    const mb = (data.length / (1024 * 1024)).toFixed(1);
    throw new BadRequestException(
      `That file is ${mb} MB. Licence documents must be under ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`,
    );
  }

  const signature = SIGNATURES.find((candidate) => candidate.matches(data));
  if (!signature) {
    throw new BadRequestException(
      'Upload the licence as a PDF, JPG or PNG. The file you chose is not one of those.',
    );
  }

  return {
    filename: safeFilename(input.filename, EXTENSION_FOR[signature.mimeType]),
    mimeType: signature.mimeType,
    sizeBytes: data.length,
    data,
  };
}
