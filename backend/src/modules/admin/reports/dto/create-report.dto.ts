import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  ReportFormat,
  ReportScope,
  ReportStatus,
  ReportType,
} from '@prisma/client';

export class CreateReportDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsEnum(ReportType)
  type!: ReportType;

  @IsEnum(ReportFormat)
  format!: ReportFormat;

  // Which intelligence surface the report draws from. Defaults to ALL.
  @IsOptional()
  @IsEnum(ReportScope)
  scope?: ReportScope;

  // Defaults to READY, or SCHEDULED when a schedule is provided.
  @IsOptional()
  @IsEnum(ReportStatus)
  status?: ReportStatus;

  // Human-readable cadence for scheduled reports, e.g. "Daily · 06:00".
  @IsOptional()
  @IsString()
  @MaxLength(120)
  schedule?: string;
}
