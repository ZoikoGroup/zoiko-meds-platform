import { ApiPropertyOptional } from '@nestjs/swagger';
import { AuditSeverity } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ListAuditLogsQuery {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Filter by system module / entity type (e.g. Inventory, Pharmacy, User)' })
  @IsOptional()
  @IsString()
  module?: string;

  @ApiPropertyOptional({ description: 'Filter by action (e.g. Create, Update, Delete, Import, or action key)' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter or search by actor email/name/ID' })
  @IsOptional()
  @IsString()
  user?: string;

  @ApiPropertyOptional({ description: 'Filter by pharmacy name or pharmacy ID' })
  @IsOptional()
  @IsString()
  pharmacy?: string;

  @ApiPropertyOptional({ description: 'General search keyword' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Start date filter (ISO string, e.g. 2026-07-01)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date filter (ISO string, e.g. 2026-07-31)' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ enum: AuditSeverity, description: 'Filter by severity level' })
  @IsOptional()
  @IsEnum(AuditSeverity)
  severity?: AuditSeverity;
}
