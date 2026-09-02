import { IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Stock posted by a pharmacy's own system to /pharmacies/integration/push.
 *
 * Deliberately the same shape as ImportInventoryDto — rows or csvText, plus a
 * mode — because it is the same operation, arriving over a different door. It
 * carries no pharmacy id: the API key in the request header is what says which
 * pharmacy this is, so there is nothing here to point at somebody else's
 * inventory.
 */
export class PushInventoryDto {
  @ApiPropertyOptional({
    description: 'Medicines as objects, e.g. [{ "name": "Amoxicillin 500mg", "status": "available" }].',
    type: [Object],
  })
  @IsOptional()
  @IsArray()
  rows?: Record<string, string>[];

  @ApiPropertyOptional({
    description: 'Raw CSV text with a header row containing at least a "name" column.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1_000_000)
  csvText?: string;

  @ApiPropertyOptional({
    enum: ['merge', 'replace'],
    description: "Overrides the integration's stored sync mode for this push.",
  })
  @IsOptional()
  @IsIn(['merge', 'replace'])
  mode?: 'merge' | 'replace';
}
