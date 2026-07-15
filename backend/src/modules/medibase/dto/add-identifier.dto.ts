import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { QualityState } from '@prisma/client';
import { SUPPORTED_IDENTIFIER_SYSTEMS } from '../identifier-systems';

/** Attach an external identifier mapping to a medicine identity. */
export class AddIdentifierDto {
  @IsString()
  @IsIn(SUPPORTED_IDENTIFIER_SYSTEMS)
  system!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  value!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  licenseScope?: string;

  @IsOptional()
  @IsIn([
    QualityState.VERIFIED,
    QualityState.PARTNER_SUPPLIED,
    QualityState.MAPPED,
    QualityState.INFERRED,
    QualityState.NEEDS_REVIEW,
  ])
  qualityState?: QualityState;
}
