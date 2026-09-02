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
/** Room kept clear above the bottom margin for the standing footer line. */
const FOOTER_SPACE = 22;
const INK = rgb(0.13, 0.15, 0.19);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.85, 0.87, 0.9);

/** One labelled fact on the summary sheet. */
export interface ReportField {
  label: string;
  value: string;
}

/** A titled block of aggregate figures. */
export interface ReportPdfSection {
  heading: string;
  metrics: ReportField[];
}

/** What the export says about itself, beyond the stored row. */
export interface ReportPdfContext {
  generatedAt: Date;
  /** Why anyone would read this report, from its own type and scope. */
  purpose?: string[];
  /** Prose built only from the figures below it. */
  summary?: string[];
  /** The figures that lead the report. */
  keyMetrics?: ReportField[];
  /** The detailed breakdown, one block per aggregate area. */
  sections?: ReportPdfSection[];
  /** Stated when the report type has no analytics source at all. */
  unavailable?: string;
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

/**
 * A cursor that draws down the page, starting a new one when it runs out.
 *
 * Paging is the whole reason this exists. The report used to be a fixed single
 * page carrying its own metadata and four governance bullets, which always fit;
 * now that it states real aggregate figures it does not, and text drawn below
 * the bottom margin is silently lost rather than wrapped — a report missing its
 * last section with no sign of it is worse than a longer one.
 */
class Cursor {
  private page: PDFPage;
  private y: number;

  constructor(
    private readonly pdf: PDFDocument,
    private readonly footer: (page: PDFPage) => void,
  ) {
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
    this.footer(this.page);
  }

  /** Start a new page when `needed` points will not fit above the margin. */
  private reserve(needed: number) {
    if (this.y - needed >= MARGIN + FOOTER_SPACE) return;
    this.page = this.pdf.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
    this.footer(this.page);
  }

  gap(points: number) {
    this.y -= points;
  }

  text(value: string, font: PDFFont, size: number, color = INK, lineGap = 4) {
    const maxWidth = PAGE.width - MARGIN * 2;
    for (const line of wrap(value, font, size, maxWidth)) {
      this.reserve(size + lineGap);
      this.y -= size;
      this.page.drawText(line, { x: MARGIN, y: this.y, size, font, color });
      this.y -= lineGap;
    }
  }

  rule() {
    this.reserve(20);
    this.y -= 8;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE.width - MARGIN, y: this.y },
      thickness: 0.75,
      color: RULE,
    });
    this.y -= 12;
  }

  /** A section title, kept with at least its first row beneath it. */
  heading(value: string, font: PDFFont) {
    this.reserve(52);
    this.text(value, font, 13, INK, 8);
  }

  /** A label above its value, as the console shows them. */
  field(field: ReportField, label: PDFFont, body: PDFFont) {
    this.reserve(30);
    this.text(field.label.toUpperCase(), label, 8, MUTED, 3);
    this.text(field.value || '—', body, 11, INK, 8);
  }

  /**
   * A figure on one line, label left and value right.
   *
   * Aggregate blocks run to five or eight rows each, and the stacked
   * label-above-value form the metadata header uses would run them over three
   * pages for no gain in legibility.
   */
  row(field: ReportField, label: PDFFont, body: PDFFont) {
    this.reserve(18);
    this.y -= 11;
    this.page.drawText(field.label, {
      x: MARGIN,
      y: this.y,
      size: 10,
      font: label,
      color: INK,
    });
    const value = field.value || '—';
    const width = body.widthOfTextAtSize(value, 10);
    this.page.drawText(value, {
      x: PAGE.width - MARGIN - width,
      y: this.y,
      size: 10,
      font: body,
      color: INK,
    });
    this.y -= 7;
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

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const body = await pdf.embedFont(StandardFonts.Helvetica);

  // Drawn on every page as it is created, so the aggregate-only statement
  // travels with any sheet somebody prints or forwards on its own.
  const footer = (page: PDFPage) =>
    page.drawText(
      'Aggregate-only export — contains no patient data and no exact stock counts.',
      { x: MARGIN, y: MARGIN - 16, size: 8, font: body, color: MUTED },
    );

  const cursor = new Cursor(pdf, footer);

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

  cursor.heading('Report details', bold);
  for (const field of [
    { label: 'Report type', value: humanise(report.type) },
    { label: 'Scope', value: humanise(report.scope) },
    { label: 'Owner', value: report.owner },
    { label: 'Status', value: humanise(report.status) },
    ...(report.schedule ? [{ label: 'Schedule', value: report.schedule }] : []),
  ]) {
    cursor.row(field, bold, body);
  }

  // Why anyone would read this. A generated export used to carry its metadata
  // and its governance rules and nothing about its purpose, so the reader had
  // to infer it from the title.
  if (context.purpose?.length) {
    cursor.rule();
    cursor.heading('Purpose / intended use', bold);
    for (const paragraph of context.purpose) {
      cursor.text(paragraph, body, 10, MUTED, 7);
    }
  }

  if (context.summary?.length) {
    cursor.rule();
    cursor.heading('Executive summary', bold);
    for (const paragraph of context.summary) {
      cursor.text(paragraph, body, 10, INK, 7);
    }
  }

  if (context.keyMetrics?.length) {
    cursor.rule();
    cursor.heading('Key metrics', bold);
    for (const metric of context.keyMetrics) cursor.row(metric, bold, body);
  }

  if (context.sections?.length) {
    cursor.rule();
    cursor.heading('Detailed breakdown', bold);
    for (const section of context.sections) {
      cursor.gap(6);
      cursor.heading(section.heading, bold);
      for (const metric of section.metrics) cursor.row(metric, bold, body);
    }
  }

  // Said plainly rather than left blank or filled in. An empty section reads as
  // a broken export; a modelled figure the reader would take for a measurement
  // is worse than either.
  if (context.unavailable) {
    cursor.rule();
    cursor.heading('Detailed analytics', bold);
    cursor.text(context.unavailable, body, 10, MUTED, 7);
  }

  cursor.rule();
  cursor.heading('Governance', bold);
  for (const line of context.governance) {
    cursor.text(`•  ${line}`, body, 10, MUTED, 6);
  }

  // Without object streams the page content stays inspectable — a reader can
  // confirm what the export says without decompressing it, and so can a test.
  // These documents are a page of text; the saving is not worth the opacity.
  return pdf.save({ useObjectStreams: false });
}
