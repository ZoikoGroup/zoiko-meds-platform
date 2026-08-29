import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IntegrationDirection } from '@prisma/client';

/**
 * Create or update the pharmacy's POS / ERP feed.
 *
 * Cross-field rules (a pull feed needs a URL; a header value needs a header
 * name) are enforced in PharmacyIntegrationService, where the stored record is
 * visible — this class only says what a single field may contain. Validated by
 * the global ValidationPipe with forbidNonWhitelisted, so an unknown property
 * is rejected rather than quietly ignored.
 */
export class SaveIntegrationDto {
  @ApiProperty({
    description: 'Name of the system being connected, e.g. "Marg ERP".',
    example: 'Marg ERP',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  provider!: string;

  @ApiPropertyOptional({
    enum: IntegrationDirection,
    default: IntegrationDirection.PULL,
    description:
      'PULL: ZoikoMeds fetches feedUrl on a schedule. PUSH: your system posts stock to us with an issued key.',
  })
  @IsOptional()
  @IsEnum(IntegrationDirection)
  direction?: IntegrationDirection;

  @ApiPropertyOptional({
    description:
      'Public http(s) URL of the CSV or JSON stock file. Required for PULL.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  feedUrl?: string;

  @ApiPropertyOptional({
    description: 'Header the feed expects for auth, e.g. "Authorization".',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  // A header name, not a header line: no colon, no newline, nothing that could
  // append a second header to the request this value ends up in.
  @Matches(/^[A-Za-z0-9-]+$/, {
    message: 'authHeaderName may contain only letters, numbers and hyphens.',
  })
  authHeaderName?: string;

  @ApiPropertyOptional({
    description:
      'Value for that header. Encrypted at rest and never returned. Omit to keep the stored value.',
  })
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    return value.trim().length > 0 ? value : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  authHeaderValue?: string;

  @ApiPropertyOptional({
    enum: ['merge', 'replace'],
    default: 'merge',
    description:
      'merge keeps medicines the feed does not mention; replace prunes them, making the feed the whole truth about your stock.',
  })
  @IsOptional()
  @IsIn(['merge', 'replace'])
  syncMode?: 'merge' | 'replace';

  @ApiPropertyOptional({
    description: 'Minutes between automatic syncs (15–1440).',
    default: 60,
  })
  @IsOptional()
  @IsInt()
  intervalMinutes?: number;

  @ApiPropertyOptional({
    description: 'Pause automatic syncing without losing the configuration.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
