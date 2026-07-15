import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { PrescriptionCategory, QualityState } from '@prisma/client';

/** Admin listing query — unlike the public surface, may include suppressed entities. */
export class ListMedicinesQuery {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsEnum(QualityState)
  qualityState?: QualityState;

  @IsOptional()
  @IsEnum(PrescriptionCategory)
  prescriptionCategory?: PrescriptionCategory;

  @IsOptional()
  @IsString()
  jurisdiction?: string;

  // Default false: suppressed entities are hidden unless explicitly requested.
  @IsOptional()
  @Type(() => Boolean)
  includeSuppressed?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}
