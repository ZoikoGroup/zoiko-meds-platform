import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { AggregateBucket } from '@prisma/client';

/**
 * Admin trigger for the aggregation job. Buckets pending SignalEvents into
 * SignalAggregate cells at the requested granularity and re-applies the
 * k-anonymity suppression gate.
 */
export class RunAggregationDto {
  @IsOptional()
  @IsEnum(AggregateBucket)
  bucket?: AggregateBucket;

  /** Also prune raw events older than the retention window after aggregating. */
  @IsOptional()
  @Type(() => Boolean)
  prune?: boolean;

  /** Cap on how many pending events to process in this pass. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50_000)
  batchSize?: number;
}
