import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class EvaluationBackfillDto {
  /**
   * True unless explicitly false. Starting trials is a commercial decision with
   * a date attached, so the request that makes it has to say so.
   */
  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** Grant to at most this many pharmacies, for a staged rollout. */
  @ApiPropertyOptional({ minimum: 1, maximum: 1000 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
}
