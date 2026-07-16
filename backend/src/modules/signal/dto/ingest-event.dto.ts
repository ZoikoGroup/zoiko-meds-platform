import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { SignalEventType } from '@prisma/client';
import { MAX_TERM_LENGTH } from '../signal.constants';

/**
 * Manual event ingestion (admin / backfill / testing). Production events are
 * emitted internally by the search, patient-portal and pharmacy domains via
 * SignalIngestService; this DTO exists so operators can backfill or replay.
 *
 * By policy it accepts NO user/patient identifier — only the governed
 * medicine/jurisdiction/pharmacy scope and, for zero-results, a search term.
 */
export class IngestEventDto {
  @IsEnum(SignalEventType)
  type!: SignalEventType;

  @IsOptional()
  @IsString()
  medicineId?: string;

  @IsOptional()
  @IsString()
  jurisdictionId?: string;

  @IsOptional()
  @IsString()
  pharmacyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TERM_LENGTH)
  searchTerm?: string;
}
