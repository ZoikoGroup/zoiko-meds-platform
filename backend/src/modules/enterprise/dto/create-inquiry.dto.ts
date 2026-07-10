import { IsEmail, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { InquiryType } from '@prisma/client';

/**
 * Enterprise inquiry payload (MediBase briefing, ZoikoAvail API access, etc.).
 * Governance: never accept patient identifiers, PHI, prescription data,
 * exact stock, or API secrets through this public-facing form.
 */
export class CreateInquiryDto {
  @IsEmail()
  workEmail!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(200)
  organizationName!: string;

  @IsString()
  @MaxLength(120)
  organizationType!: string;

  @IsOptional()
  @IsEnum(InquiryType)
  type?: InquiryType;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  primaryInterest?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  requestSource?: string;
}
