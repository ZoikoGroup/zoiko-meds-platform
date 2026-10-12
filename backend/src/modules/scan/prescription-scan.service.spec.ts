import {
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { PrescriptionScanService } from './prescription-scan.service';
import type { GeminiPrescriptionService } from './gemini-prescription.service';
import type { PrescriptionMatcherService } from './prescription-matcher.service';
import { sniffMimeType } from './file-type';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The upload edge, and the one decision made before anything is sent anywhere:
 * what this file actually is.
 *
 * The type is taken from the bytes, never the declared MIME and never the
 * filename, because both are the uploader's claim. Getting that wrong means
 * paying for a request that returns nonsense, or asserting a type upstream that
 * fails with an error the patient cannot act on.
 */

const extract = jest.fn();
const verifyAll = jest.fn();

const gemini = {
  extract,
  availability: () => ({ available: true }),
} as unknown as GeminiPrescriptionService;
const matcher = { verifyAll } as unknown as PrescriptionMatcherService;
const service = () => new PrescriptionScanService(gemini, matcher);

// Real magic numbers, so the sniffer is exercised rather than stubbed.
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(64),
]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(64)]);

const url = (bytes: Buffer, declared: string) =>
  `data:${declared};base64,${bytes.toString('base64')}`;

beforeEach(() => {
  extract.mockReset().mockResolvedValue([]);
  verifyAll.mockReset().mockResolvedValue([]);
});

describe('what the file is', () => {
  it.each([
    ['image/png', 'image', PNG],
    ['image/jpeg', 'image', JPEG],
    ['image/webp', 'image', WEBP],
    ['application/pdf', 'pdf', PDF],
  ])('accepts %s and reports it as a %s source', async (mime, sourceType, bytes) => {
    const result = await service().scan(url(bytes, mime));

    expect(result.source.type).toBe(sourceType);
    expect(extract).toHaveBeenCalledWith(bytes.toString('base64'), mime);
  });

  it('believes the bytes, not the declared type', async () => {
    // A PDF announced as a PNG is still read as a PDF. The alternative is
    // asserting image/png upstream for a document, which fails unhelpfully.
    await service().scan(url(PDF, 'image/png'));

    expect(extract).toHaveBeenCalledWith(expect.any(String), 'application/pdf');
  });

  it('rejects a file that is none of the supported types', async () => {
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(64)]);

    await expect(service().scan(url(gif, 'image/png'))).rejects.toBeInstanceOf(
      UnsupportedMediaTypeException,
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it('rejects an empty file before sending anything', async () => {
    await expect(service().scan('data:image/png;base64,')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it('rejects a file over the 10 MB ceiling before sending anything', async () => {
    const huge = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]);

    await expect(service().scan(url(huge, 'image/png'))).rejects.toBeInstanceOf(
      PayloadTooLargeException,
    );
    expect(extract).not.toHaveBeenCalled();
  });

  it('rejects an envelope that is not a data URL at all', async () => {
    await expect(service().scan('not-a-data-url')).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('sniffMimeType', () => {
  it('identifies each supported format from its magic number', () => {
    expect(sniffMimeType(PNG)).toBe('image/png');
    expect(sniffMimeType(JPEG)).toBe('image/jpeg');
    expect(sniffMimeType(WEBP)).toBe('image/webp');
    expect(sniffMimeType(PDF)).toBe('application/pdf');
  });

  it('returns null for anything else', () => {
    expect(sniffMimeType(Buffer.from('GIF89a........'))).toBeNull();
    expect(sniffMimeType(Buffer.alloc(32))).toBeNull();
  });

  it('is not fooled by a short buffer', () => {
    expect(sniffMimeType(Buffer.from([0xff, 0xd8]))).toBeNull();
  });

  it('finds a PDF header that is not at the very first byte', () => {
    // Producers emit a BOM or leading whitespace; the spec allows it.
    expect(sniffMimeType(Buffer.concat([Buffer.from('\n\n'), PDF]))).toBe('application/pdf');
  });
});

describe('the result it returns', () => {
  it('passes the verified medicines straight through', async () => {
    const verified = [
      { extracted: { name: 'Dolo' }, verification: { status: 'MATCHED' } },
    ];
    extract.mockResolvedValue([{ name: 'Dolo' }]);
    verifyAll.mockResolvedValue(verified);

    const result = await service().scan(url(PNG, 'image/png'));

    expect(result.success).toBe(true);
    expect(result.medicines).toBe(verified);
    expect(result.message).toBeUndefined();
  });

  it('says so plainly when nothing could be read, rather than guessing', async () => {
    extract.mockResolvedValue([]);
    verifyAll.mockResolvedValue([]);

    const result = await service().scan(url(PNG, 'image/png'));

    expect(result.success).toBe(true);
    expect(result.medicines).toEqual([]);
    expect(result.message).toMatch(/couldn't confidently identify any medicines/i);
  });

  it('verifies whatever was read, every time', async () => {
    const read = [{ name: 'Dolo' }, { name: 'Pantop' }];
    extract.mockResolvedValue(read);

    await service().scan(url(PDF, 'application/pdf'));

    expect(verifyAll).toHaveBeenCalledWith(read);
  });
});

describe('what it writes to the log', () => {
  it('records operational metadata and nothing off the prescription', async () => {
    const logged: string[] = [];
    const svc = service();
    jest
      .spyOn((svc as unknown as { logger: { log: (m: string) => void } }).logger, 'log')
      .mockImplementation((message: string) => {
        logged.push(String(message));
      });

    extract.mockResolvedValue([
      { name: 'Amoxicillin', rawText: 'PATIENT NAME — Amoxicillin 500mg' },
    ]);
    verifyAll.mockResolvedValue([
      { extracted: { name: 'Amoxicillin' }, verification: { status: 'MATCHED' } },
    ]);

    await svc.scan(url(PDF, 'application/pdf'));

    const all = logged.join(' ');
    expect(all).not.toContain('PATIENT NAME');
    expect(all).not.toContain('Amoxicillin');
    expect(all).not.toContain(PDF.toString('base64'));
    // Still enough to operate on: type, size, timing, counts.
    expect(all).toMatch(/application\/pdf/);
    expect(all).toMatch(/bytes/);
    expect(all).toMatch(/MATCHED/);
  });
});

/**
 * Nothing is kept.
 *
 * The strongest version of "we do not retain the file" is that there is no code
 * path that could: no database client, no filesystem write, no cache. That is a
 * property of the module, so it is checked against the module rather than
 * against one request.
 */
describe('the scan path cannot persist anything', () => {
  const sourceOf = (file: string) =>
    readFileSync(join(__dirname, file), 'utf8');

  const SCAN_SOURCES = [
    'prescription-scan.service.ts',
    'gemini-prescription.service.ts',
    'prescription-matcher.service.ts',
    'file-type.ts',
    'scan.controller.ts',
  ];

  it('never reaches the database with prescription content', () => {
    // The matcher reads the catalog, but through MedibaseService — it holds no
    // Prisma client of its own, so there is nothing here that could write a row.
    for (const file of SCAN_SOURCES) {
      expect(sourceOf(file)).not.toMatch(/PrismaService|prisma\./);
    }
  });

  it('never writes the upload to disk', () => {
    for (const file of SCAN_SOURCES) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/writeFile|createWriteStream|mkdtemp|tmpdir/);
      expect(source).not.toMatch(/from\s+['"]node:fs['"]/);
    }
  });

  it('keeps no module-level cache of what it read', () => {
    const source = sourceOf('prescription-scan.service.ts');

    expect(source).not.toMatch(/new Map\(|new Set\(|cache/i);
  });

  it('holds the bytes only for the call', async () => {
    // The buffer is decoded, handed to the reader and dropped: the service
    // returns verified medicines, never the document it was given.
    extract.mockResolvedValue([{ name: 'Dolo' }]);
    verifyAll.mockResolvedValue([
      { extracted: { name: 'Dolo' }, verification: { status: 'MATCHED' } },
    ]);

    const result = await service().scan(url(PDF, 'application/pdf'));

    expect(JSON.stringify(result)).not.toContain(PDF.toString('base64'));
    expect(Object.keys(result)).toEqual(['success', 'source', 'medicines']);
  });
});
