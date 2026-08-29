import { Injectable, NotFoundException } from '@nestjs/common';
import { Report, ReportScope, ReportStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { CreateReportDto } from './dto/create-report.dto';

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
  async download(actorId: string, id: string, ipAddress?: string) {
    const report = await this.require(id);
    await this.audit.write(
      actorId,
      'admin.report.download',
      'Report',
      id,
      { format: report.format },
      ipAddress,
    );
    return {
      report: this.toDto(report),
      generatedAt: new Date().toISOString(),
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
