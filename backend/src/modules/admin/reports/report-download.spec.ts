import { inflateSync } from 'node:zlib';
import { NotImplementedException } from '@nestjs/common';
import { ReportFormat, ReportScope, ReportStatus, ReportType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { ReportsService, safeFilename } from './reports.service';

/**
 * The text a PDF actually draws.
 *
 * pdf-lib writes the page as a Flate-compressed content stream, with each run of
 * text as a hex string handed to a Tj operator. Inflating and decoding those is
 * enough to read the document back, and it needs nothing beyond Node's own zlib
 * — which matters, because the alternative parser wants Jest run with
 * --experimental-vm-modules for the whole suite.
 *
 * This is what separates a real document from a JSON dump inside a PDF wrapper:
 * the words have to come out again.
 */
function pdfText(body: Buffer): string {
  const raw = body.toString('latin1');
  const streams: string[] = [];
  const marker = /stream\r?\n/g;
  let match: RegExpExecArray | null;
  while ((match = marker.exec(raw))) {
    const start = match.index + match[0].length;
    const end = raw.indexOf('endstream', start);
    if (end === -1) continue;
    try {
      streams.push(inflateSync(Buffer.from(raw.slice(start, end), 'latin1')).toString('latin1'));
    } catch {
      // Not every stream is deflated; the ones that are not carry no text.
    }
  }
  return streams
    .join('\n')
    .replace(/<([0-9A-Fa-f]+)>\s*Tj/g, (_all, hex: string) =>
      Buffer.from(hex, 'hex').toString('utf8'),
    );
}

/**
 * Downloading a report (MSA-53).
 *
 * The table showed "PDF · Ready" and the download handed back a JSON envelope,
 * which the console then saved as .json. Nothing ever produced a PDF: the format
 * column described an artifact that did not exist.
 *
 * What is pinned here is that the stated format and the bytes agree — including
 * the file signature, because a JSON body renamed .pdf would pass every weaker
 * check.
 */

const report = (over: Record<string, unknown> = {}) => ({
  id: 'rep_1',
  name: 'Data quality report',
  type: ReportType.EXECUTIVE_BRIEFING,
  format: ReportFormat.PDF,
  scope: ReportScope.ALL,
  status: ReportStatus.READY,
  owner: 'tester_super_admin@gmail.com',
  createdBy: 'tester_super_admin@gmail.com',
  schedule: null,
  createdAt: new Date('2026-09-01T12:04:32Z'),
  updatedAt: new Date('2026-09-01T12:04:32Z'),
  ...over,
});

function buildService(row: Record<string, unknown> = report()) {
  const prisma = {
    report: { findUnique: jest.fn().mockResolvedValue(row) },
  };
  const audit = { write: jest.fn() };
  const service = new ReportsService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditWriter,
  );
  return { service, prisma, audit };
}

const download = (row?: Record<string, unknown>) =>
  buildService(row ?? report()).service.download('user_1', 'rep_1', '10.0.0.1');

/** The first bytes of a file, as text. */
const magic = (body: Buffer, length = 5) => body.subarray(0, length).toString('latin1');

describe('a PDF report', () => {
  it('answers with application/pdf', async () => {
    expect((await download()).contentType).toBe('application/pdf');
  });

  it('is named with a .pdf extension', async () => {
    expect((await download()).filename).toMatch(/\.pdf$/);
  });

  it('really is a PDF — the bytes say so', async () => {
    // The check that a renamed JSON body cannot pass.
    const { body } = await download();

    expect(magic(body)).toBe('%PDF-');
  });

  it('ends with the PDF end-of-file marker', async () => {
    const { body } = await download();

    expect(body.subarray(-1024).toString('latin1')).toContain('%%EOF');
  });

  it('is a document with substance, not a stub', async () => {
    const { body } = await download();

    expect(body.length).toBeGreaterThan(1000);
  });

  it('is not a JSON payload wearing a PDF name', async () => {
    const { body } = await download();

    expect(() => JSON.parse(body.toString('utf8'))).toThrow();
  });

  it('renders the report, readably, when parsed back', async () => {
    // Read with pdf-parse — already in the tree for prescription scanning. This
    // is what separates a real document from a JSON dump inside a PDF wrapper:
    // the text has to come back out.
    const { body } = await download();

    const text = pdfText(body);
    expect(text).toContain('Data quality report');
  });

  it('states the type, scope, owner and status', async () => {
    const { body } = await download();

    const text = pdfText(body);
    for (const expected of [
      'Executive Briefing',
      'All',
      'tester_super_admin@gmail.com',
      'Ready',
    ]) {
      expect(text).toContain(expected);
    }
  });

  it('states when it was generated', async () => {
    const { body } = await download();

    expect(pdfText(body)).toMatch(/Generated \d{4}-\d{2}-\d{2}/);
  });

  it('carries the governance statement', async () => {
    // The privacy rules travel with the artifact, not just the page.
    const { body } = await download();

    const text = pdfText(body);
    expect(text).toContain('Aggregate-only');
    expect(text).toMatch(/no exact stock counts/i);
  });

  it('contains no raw JSON punctuation dumped as text', async () => {
    const text = pdfText((await download()).body);

    expect(text).not.toContain('{"');
    expect(text).not.toContain('containsPhi');
  });
});

describe('the other formats still work', () => {
  it('writes CSV as text/csv with a .csv name', async () => {
    const artifact = await download(report({ format: ReportFormat.CSV }));

    expect(artifact.contentType).toContain('text/csv');
    expect(artifact.filename).toMatch(/\.csv$/);
  });

  it('writes a CSV with a header row and the report facts', async () => {
    const { body } = await download(report({ format: ReportFormat.CSV }));
    const text = body.toString('utf8');

    expect(text.split('\n')[0]).toBe('Field,Value');
    expect(text).toContain('Data quality report');
    expect(text).toContain('Executive Briefing');
  });

  it('writes JSON as application/json with a .json name', async () => {
    const artifact = await download(report({ format: ReportFormat.JSON }));

    expect(artifact.contentType).toContain('application/json');
    expect(artifact.filename).toMatch(/\.json$/);
  });

  it('keeps the JSON envelope parseable, with its governance block', async () => {
    const { body } = await download(report({ format: ReportFormat.JSON }));

    const parsed = JSON.parse(body.toString('utf8'));
    expect(parsed.governance).toMatchObject({ aggregateOnly: true, containsPhi: false });
    expect(parsed.report.name).toBe('Data quality report');
  });

  it('refuses XLSX rather than handing back JSON named .xlsx', async () => {
    // The console offers the format and nothing writes a workbook. Saying so is
    // the honest answer; a mislabelled body is the bug being fixed.
    await expect(download(report({ format: ReportFormat.XLSX }))).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });
});

describe('the format the row states is the format that downloads', () => {
  it.each([
    [ReportFormat.PDF, 'application/pdf', /\.pdf$/],
    [ReportFormat.CSV, 'text/csv', /\.csv$/],
    [ReportFormat.JSON, 'application/json', /\.json$/],
  ])('%s downloads as %s', async (format, contentType, extension) => {
    const artifact = await download(report({ format }));

    expect(artifact.contentType).toContain(contentType);
    expect(artifact.filename).toMatch(extension);
  });
});

describe('the download is recorded', () => {
  it('writes an audit entry naming the format', async () => {
    const { service, audit } = buildService();

    await service.download('user_1', 'rep_1', '10.0.0.1');

    expect(audit.write).toHaveBeenCalledWith(
      'user_1',
      'admin.report.download',
      'Report',
      'rep_1',
      { format: ReportFormat.PDF },
      '10.0.0.1',
    );
  });
});

describe('safeFilename', () => {
  it('keeps an ordinary name', () => {
    expect(safeFilename('Q3 data quality')).toBe('Q3 data quality');
  });

  it('removes what would break a Content-Disposition header', () => {
    // A quote closes the filename early; a newline starts a second header.
    expect(safeFilename('re"port')).toBe('re-port');
    expect(safeFilename('re\r\nport')).toBe('report');
  });

  it('discards path separators, so nothing reads as a directory', () => {
    expect(safeFilename('../../etc/passwd')).toBe('..-..-etc-passwd');
    expect(safeFilename('a\\b')).toBe('a-b');
  });

  it('falls back when nothing usable is left', () => {
    expect(safeFilename('')).toBe('report');
    expect(safeFilename('///')).toBe('---');
  });

  it('bounds the length', () => {
    expect(safeFilename('a'.repeat(400)).length).toBeLessThanOrEqual(80);
  });
});
