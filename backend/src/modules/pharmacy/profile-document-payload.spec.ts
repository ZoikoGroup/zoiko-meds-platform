import { ValidationPipe } from '@nestjs/common';
import { UpdatePharmacyProfileDto } from './dto/update-profile.dto';
import { MAX_DOCUMENT_BASE64_CHARS } from './verification-document';

/**
 * Saving a pharmacy profile that already has a licence document attached.
 *
 * The profile page held the GET response in one state object, and the save sent
 * that object back. GET describes the file on record — filename, mimeType,
 * sizeBytes, uploadedAt — and the upload DTO takes filename + content, so the
 * description of the stored file arrived as an upload of a new one. A pharmacy
 * changing only its licence number was told, about a 31 KB screenshot it had not
 * touched, that the file was over 5 MB.
 *
 * The "too large" line came from @MaxLength failing on `content: undefined` —
 * nothing had measured anything. That is what these tests pin: the size rule
 * only speaks about strings that really are too long.
 */

// The exact ValidationPipe the app runs, so whitelist behaviour is real here.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

const meta = {
  type: 'body' as const,
  metatype: UpdatePharmacyProfileDto,
  data: '',
};

/** Validate a body, returning the messages the API would answer with. */
async function validate(body: Record<string, unknown>): Promise<string[]> {
  try {
    await pipe.transform(body, meta);
    return [];
  } catch (err: unknown) {
    const res = (err as { getResponse?: () => unknown }).getResponse?.() as {
      message?: string | string[];
    };
    const message = res?.message ?? [];
    return Array.isArray(message) ? message : [message];
  }
}

/** What GET /pharmacies/me returns about the file already on record. */
const ATTACHED_METADATA = {
  filename: 'Screenshot 2026-06-16 132925.png',
  mimeType: 'image/png',
  sizeBytes: 31 * 1024,
  uploadedAt: '2026-06-16T13:29:25.000Z',
};

/** A real 31 KB PNG, base64, as the browser produces it. */
const PNG_31KB = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(31 * 1024, 7),
]).toString('base64');

const PROFILE_EDIT = { name: 'testerpharma', licenseNumber: 'LC-1234567' };

const mentions = (messages: string[], pattern: RegExp) =>
  messages.some((m) => pattern.test(m));

describe('a profile-only save, with a document already attached', () => {
  it('is accepted when the document is left out entirely', async () => {
    // The fixed frontend payload: the attached file is not described at all.
    expect(await validate(PROFILE_EDIT)).toEqual([]);
  });

  it('skips document validation completely when there is no document key', async () => {
    const messages = await validate(PROFILE_EDIT);

    expect(mentions(messages, /document/i)).toBe(false);
  });

  it('accepts a save that touches only one field', async () => {
    expect(await validate({ licenseNumber: 'LC-9999999' })).toEqual([]);
  });
});

describe('the reported failure, reproduced', () => {
  // Exactly what the page used to send.
  const REPLAYED = { ...PROFILE_EDIT, document: ATTACHED_METADATA };

  it('still refuses response-only metadata as an upload', async () => {
    // Refusing it is correct: those fields are the server's to determine, and
    // the whitelist is a deliberate posture. What must change is the reason.
    expect(await validate(REPLAYED)).not.toEqual([]);
  });

  it('no longer claims a 31 KB file is too large', async () => {
    // The line that sent the operator looking at a file that was never the
    // problem. Nothing in this request carries a file at all.
    const messages = await validate(REPLAYED);

    expect(mentions(messages, /too large/i)).toBe(false);
    expect(mentions(messages, /5 MB/)).toBe(false);
  });

  it('names the properties that do not belong', async () => {
    const messages = await validate(REPLAYED);

    for (const field of ['mimeType', 'sizeBytes', 'uploadedAt']) {
      expect(mentions(messages, new RegExp(`${field} should not exist`))).toBe(true);
    }
  });
});

describe('a genuine upload', () => {
  it('accepts filename plus content', async () => {
    const body = {
      ...PROFILE_EDIT,
      document: { filename: 'licence.png', content: PNG_31KB },
    };

    expect(await validate(body)).toEqual([]);
  });

  it('accepts a 31 KB file — the size in the report', async () => {
    const body = { document: { filename: 'licence.png', content: PNG_31KB } };

    expect(await validate(body)).toEqual([]);
  });

  it('accepts a data URL, which is what the browser produces', async () => {
    const body = {
      document: { filename: 'licence.png', content: `data:image/png;base64,${PNG_31KB}` },
    };

    expect(await validate(body)).toEqual([]);
  });

  it('accepts content just inside the wire limit', async () => {
    const body = { document: { filename: 'big.pdf', content: 'A'.repeat(MAX_DOCUMENT_BASE64_CHARS) } };

    expect(await validate(body)).toEqual([]);
  });
});

describe('the size rule only speaks about oversized strings', () => {
  it('rejects content past the wire limit, and says so', async () => {
    const body = {
      document: { filename: 'big.pdf', content: 'A'.repeat(MAX_DOCUMENT_BASE64_CHARS + 1) },
    };

    const messages = await validate(body);

    expect(mentions(messages, /too large/i)).toBe(true);
    expect(mentions(messages, /under 5 MB/)).toBe(true);
  });

  it('says "select a document" for an empty one, not "too large"', async () => {
    const messages = await validate({ document: { filename: 'licence.pdf', content: '' } });

    expect(mentions(messages, /Select a licence document/i)).toBe(true);
    expect(mentions(messages, /too large/i)).toBe(false);
  });

  it('says nothing about size when content is missing', async () => {
    const messages = await validate({ document: { filename: 'licence.pdf' } });

    expect(mentions(messages, /content must be a string/i)).toBe(true);
    expect(mentions(messages, /too large/i)).toBe(false);
  });

  it('says nothing about size when content is the wrong type', async () => {
    const messages = await validate({ document: { filename: 'licence.pdf', content: 12345 } });

    expect(mentions(messages, /too large/i)).toBe(false);
  });
});
