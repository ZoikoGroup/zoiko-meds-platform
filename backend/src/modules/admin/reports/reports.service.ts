import { Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Report, ReportFormat, ReportScope, ReportStatus } from '@prisma/client';
import { renderReportPdf, humanise } from './report-pdf';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { CreateReportDto } from './dto/create-report.dto';

/** A downloadable export: what it is, what to call it, and its bytes. */
export interface ReportArtifact {
  filename: string;
  contentType: string;
  body: Buffer;
}

/** Stated on every export, in whichever format it is written. */
const GOVERNANCE_STATEMENT = [
  'Aggregate-only: this export contains no patient data.',
  'No exact stock counts are included — availability is a confidence band.',
  'Scoped to the requesting role and jurisdiction.',
  'The request is recorded in the platform audit log.',
];

/**
 * A report name reduced to something safe in a Content-Disposition header.
 *
 * Quotes and newlines would end the header early or add a second one, and a
 * path separator would be read as a directory by some clients.
 */
export function safeFilename(name: string): string {
  const cleaned = String(name ?? '')
    .replace(/[\\\/:*?"<>|]/g, '-')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || 'report';
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async list() {
    const rows = await this.prisma.report.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string) {
    return this.toDto(await this.require(id));
  }

  async create(
    actorId: string,
    actorEmail: string,
    dto: CreateReportDto,
    ipAddress?: string,
  ) {
    // A report with a schedule is SCHEDULED by default; one-off exports are READY.
    const status =
      dto.status ?? (dto.schedule ? ReportStatus.SCHEDULED : ReportStatus.READY);

    const report = await this.prisma.report.create({
      data: {
        name: dto.name,
        type: dto.type,
        format: dto.format,
        scope: dto.scope ?? ReportScope.ALL,
        status,
        schedule: dto.schedule ?? null,
        owner: actorEmail,
        createdBy: actorEmail,
      },
    });
    await this.audit.write(
      actorId,
      'admin.report.create',
      'Report',
      report.id,
      { name: report.name, format: report.format, scope: report.scope },
      ipAddress,
    );
    return this.toDto(report);
  }

  async duplicate(actorId: string, actorEmail: string, id: string, ipAddress?: string) {
    const src = await this.require(id);
    const report = await this.prisma.report.create({
      data: {
        name: `${src.name} (copy)`,
        type: src.type,
        format: src.format,
        scope: src.scope,
        status: ReportStatus.READY,
        schedule: src.schedule,
        owner: actorEmail,
        createdBy: actorEmail,
      },
    });
    await this.audit.write(
      actorId,
      'admin.report.duplicate',
      'Report',
      report.id,
      { sourceId: id },
      ipAddress,
    );
    return this.toDto(report);
  }

  async remove(actorId: string, id: string, ipAddress?: string) {
    await this.require(id);
    await this.prisma.report.delete({ where: { id } });
    await this.audit.write(actorId, 'admin.report.delete', 'Report', id, undefined, ipAddress);
    return { id, deleted: true };
  }

  /**
   * Produce the downloadable payload for a report. It is governed and
   * aggregate-only — never PHI or exact stock. The `data` block is a placeholder
   * that real per-scope generators plug into.
   */
  /**
   * The artifact a download answers with.
   *
   * Built here so the format the report claims and the bytes the browser
   * receives are decided in one place. They were not: the endpoint returned a
   * JSON envelope whatever the format said, and the console saved it as .json,
   * so a report labelled PDF downloaded as JSON (MSA-53).
   */
  async download(
    actorId: string,
    id: string,
    ipAddress?: string,
  ): Promise<ReportArtifact> {
    const report = await this.require(id);
    const generatedAt = new Date();

    // Written before the artifact, so an export that fails to render is still
    // recorded as having been asked for.
    await this.audit.write(
      actorId,
      'admin.report.download',
      'Report',
      id,
      { format: report.format },
      ipAddress,
    );

    const base = safeFilename(report.name);
    switch (report.format) {
      case ReportFormat.PDF:
        return {
          filename: `${base}.pdf`,
          contentType: 'application/pdf',
          body: Buffer.from(
            await renderReportPdf(report, {
              generatedAt,
              metrics: [],
              governance: GOVERNANCE_STATEMENT,
            }),
          ),
        };

      case ReportFormat.CSV:
        return {
          filename: `${base}.csv`,
          contentType: 'text/csv; charset=utf-8',
          body: Buffer.from(this.summaryCsv(report, generatedAt), 'utf8'),
        };

      case ReportFormat.JSON:
        return {
          filename: `${base}.json`,
          contentType: 'application/json; charset=utf-8',
          body: Buffer.from(
            JSON.stringify(this.envelope(report, generatedAt), null, 2),
            'utf8',
          ),
        };

      default:
        // XLSX is offered by the console but nothing writes a workbook. Saying
        // so is the honest answer; handing back a JSON body named .xlsx is the
        // bug this endpoint is being fixed for.
        throw new NotImplementedException(
          `${report.format} exports are not available yet. Choose PDF, CSV or JSON.`,
        );
    }
  }

  /** The report's own facts, as a spreadsheet-readable summary. */
  private summaryCsv(report: Report, generatedAt: Date): string {
    const rows: [string, string][] = [
      ['Report', report.name],
      ['Generated (UTC)', generatedAt.toISOString()],
      ['Type', humanise(report.type)],
      ['Scope', humanise(report.scope)],
      ['Owner', report.owner],
      ['Status', humanise(report.status)],
      ...GOVERNANCE_STATEMENT.map((line): [string, string] => ['Governance', line]),
    ];
    const escape = (value: string) =>
      /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    return ['Field,Value', ...rows.map(([k, v]) => `${escape(k)},${escape(v)}`)].join('\n');
  }

  /** The payload a JSON export carries. */
  private envelope(report: Report, generatedAt: Date) {
    return {
      report: this.toDto(report),
      generatedAt: generatedAt.toISOString(),
      governance: {
        aggregateOnly: true,
        containsPhi: false,
        containsExactStock: false,
      },
      data: [],
    };
  }

  private async require(id: string): Promise<Report> {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) throw new NotFoundException('Report not found');
    return report;
  }

  private toDto(r: Report) {
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      format: r.format,
      scope: r.scope,
      status: r.status,
      owner: r.owner,
      schedule: r.schedule,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
