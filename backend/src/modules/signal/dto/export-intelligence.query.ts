import { IsEnum, IsOptional } from 'class-validator';
import { QueryIntelligenceQuery } from './query-intelligence.query';

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
}

/**
 * Export query for approved enterprise / public-sector consumers. Same
 * selection semantics as an intelligence query, plus an output format. Exports
 * carry only k-anonymity-safe cells — masked (suppressed) cells are omitted.
 */
export class ExportIntelligenceQuery extends QueryIntelligenceQuery {
  @IsOptional()
  @IsEnum(ExportFormat)
  format?: ExportFormat;
}
