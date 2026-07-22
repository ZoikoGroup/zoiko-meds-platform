import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for bulk inventory import. The caller supplies EITHER raw CSV text or an
 * array of already-parsed row objects (never both required). `mode` controls
 * whether unlisted inventory is pruned. Validated by the global ValidationPipe
 * so unknown top-level properties are rejected rather than trusted.
 */
export class ImportInventoryDto {
  @ApiPropertyOptional({
    description: 'Raw CSV text with a header row containing at least a "name" column.',
  })
  @ValidateIf((o) => o.rows === undefined)
  @IsString()
  @MaxLength(1_000_000) // ~1 MB guard against oversized payloads
  csvText?: string;

  @ApiPropertyOptional({
    description: 'Pre-parsed CSV rows as key/value objects.',
    type: [Object],
  })
  @ValidateIf((o) => o.csvText === undefined)
  @IsArray()
  rows?: Record<string, string>[];

  @ApiPropertyOptional({ enum: ['merge', 'replace'], default: 'merge' })
  @IsOptional()
  @IsIn(['merge', 'replace'])
  mode?: 'merge' | 'replace';
}
