import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Query for the generic-identity listing behind the MediBase catalog table.
 *
 * Deliberately narrower than ListMedicinesQuery: that one pages over stored
 * medicine records, this one pages over the generic roots they group into.
 */
export class ListIdentitiesQuery {
  /** Matches the generic root or any of its trade names. */
  @IsOptional()
  @IsString()
  search?: string;

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
