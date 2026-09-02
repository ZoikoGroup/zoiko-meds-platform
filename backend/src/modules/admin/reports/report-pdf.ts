import { Report } from '@prisma/client';
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';

/**
 * Rendering a governed report as an actual PDF.
 *
 * The Reports table has always shown "PDF · Ready", and nothing ever produced
 * one: the download endpoint answered with a JSON envelope and the browser
 * saved it as .json. So the format column described an artifact that did not
 * exist (MSA-53).
 *
 * Laid out rather than dumped. A JSON blob inside a PDF wrapper would satisfy
 * the file signature and still be unreadable, which is the same failure wearing
 * a different extension.
 */

/** A4 in points, and the margin every line is measured from. */
const PAGE = { width: 595.28, height: 841.89 };
const MARGIN = 56;
const INK = rgb(0.13, 0.15, 0.19);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);

/** One labelled fact on the summary sheet. */
export interface ReportField {
  label: string;
  value: string;
}

/** What the export says about itself, beyond the stored row. */
export interface ReportPdfContext {
  generatedAt: Date;
  /** Aggregate figures, when the report has any to state. */
  metrics?: ReportField[];
  governance: string[];
}

/** Title case for an enum stored as SCREAMING_SNAKE. */
export function humanise(value: string): string {
  return value
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Wrap text to a width, measured in the font it will be drawn in.
 *
 * A word longer than the line is left to overhang rather than broken: report
 * names are the only long tokens here, and a hyphenated identifier is harder to
 * read back than one that runs slightly wide.
 */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** A cursor that draws down the page and reports where it got to. */
class Cursor {
  constructor(
    private readonly page: PDFPage,
    private y: number,
  ) {}

  gap(points: number) {
    this.y -= points;
  }

  text(value: string, font: PDFFont, size: number, color = INK, lineGap = 4) {
    const maxWidth = PAGE.width - MARGIN * 2;
    for (const line of wrap(value, font, size, maxWidth)) {
      this.y -= size;
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color });
      this.y -= lineGap;
    }
  }

  rule() {
    this.y -= 8;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE,
    });
    this.y -= 12;
  }

  /** A label above its value, as the console shows them. */
  field(field: ReportField, label: PDFFont, body: PDFFont) {
    this.text(field.label.toUpperCase(), label, 8, MUTED, 3);
    this.text(field.value || '—', body, 11, INK, 8);
  }
}

/**
 * Build the PDF for a report.
 *
 * Returns the bytes, so the caller decides whether they are streamed, stored or
 * attached — nothing here touches the response.
 */
export async function renderReportPdf(
  report: Report,
  context: ReportPdfContext,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(report.name);
  pdf.setSubject(`${humanise(report.type)} — ${humanise(report.scope)}`);
  pdf.setProducer('ZoikoMeds');
  pdf.setCreator('ZoikoMeds');
  pdf.setCreationDate(context.generatedAt);

  const page = pdf.addPage([PAGE.width, PAGE.height]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const body = await pdf.embedFont(StandardFonts.Helvetica);

  const cursor = new Cursor(page, PAGE.height - MARGIN);

  cursor.text('ZoikoMeds', bold, 10, MUTED, 2);
  cursor.text(report.name, bold, 22, INK, 6);
  cursor.text(
    `Generated ${context.generatedAt.toISOString().replace('T', ' ').slice(0, 19)} UTC`,
    body,
    10,
    MUTED,
    4,
  );
  cursor.rule();

  for (const field of [
    { label: 'Report type', value: humanise(report.type) },
    { label: 'Scope', value: humanise(report.scope) },
    { label: 'Owner', value: report.owner },
    { label: 'Status', value: humanise(report.status) },
    ...(report.schedule ? [{ label: 'Schedule', value: report.schedule }] : []),
  ]) {
    cursor.field(field, bold, body);
  }

  cursor.rule();
  cursor.text('Summary', bold, 13, INK, 8);
  if (context.metrics?.length) {
    for (const metric of context.metrics) cursor.field(metric, bold, body);
  } else {
    // Said plainly rather than left blank: an empty section reads as a broken
    // export, and inventing figures to fill it would be worse than either.
    cursor.text(
      'No aggregate figures are attached to this export yet. The report records what was requested, by whom, and under which governance rules.',
      body,
      11,
      MUTED,
      8,
    );
  }

  cursor.rule();
  cursor.text('Governance', bold, 13, INK, 8);
  for (const line of context.governance) {
    cursor.text(`•  ${line}`, body, 10, MUTED, 6);
  }

  page.drawText(
    'Aggregate-only export — contains no patient data and no exact stock counts.',
    { x: MARGIN, y: MARGIN - 16, size: 8, font: body, color: MUTED },
  );

  // Without object streams the page content stays inspectable — a reader can
  // confirm what the export says without decompressing it, and so can a test.
  // These documents are a page of text; the saving is not worth the opacity.
  return pdf.save({ useObjectStreams: false });
}
