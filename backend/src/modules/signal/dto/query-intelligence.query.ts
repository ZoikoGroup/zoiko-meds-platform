import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { AggregateBucket } from '@prisma/client';

/**
 * Contract-scoped intelligence query. Selects time-bucketed, jurisdiction-
 * scoped aggregate cells. Consumers never receive user- or patient-level data,
 * and cells below the k-anonymity threshold are masked before release.
 */
export class QueryIntelligenceQuery {
  @IsOptional()
  @IsString()
  medicineId?: string;

  @IsOptional()
  @IsString()
  jurisdictionId?: string;

  @IsOptional()
  @IsEnum(AggregateBucket)
  bucket?: AggregateBucket;

  /** Inclusive lower bound on periodStart (ISO-8601). */
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** Exclusive upper bound on periodStart (ISO-8601). */
  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
