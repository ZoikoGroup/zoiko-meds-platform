import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  BillingChannel,
  BillingInterval,
  CommercialOffer,
} from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class CreatePriceEntryDto {
  @ApiProperty({ enum: CommercialOffer })
  @IsEnum(CommercialOffer)
  offer!: CommercialOffer;

  /** ISO-3166-1 alpha-2. */
  @ApiProperty({ example: 'IN' })
  @IsString()
  @Length(2, 2)
  market!: string;

  /** ISO-4217. */
  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ enum: BillingInterval })
  @IsEnum(BillingInterval)
  interval!: BillingInterval;

  /**
   * Minor units — 19900 is $199.00. Money is never a float, and the exact figure
   * must come from an approved commercial decision, not from a published range.
   */
  @ApiProperty({ example: 19900 })
  @IsInt()
  @Min(0)
  amountMinor!: number;

  @ApiProperty({ enum: BillingChannel })
  @IsEnum(BillingChannel)
  channel!: BillingChannel;

  @ApiProperty({ example: '2026-08-launch' })
  @IsString()
  catalogVersion!: string;

  /** Traceable approval — a price cannot enter the catalog without one. */
  @ApiProperty({ example: 'ZM-PRICE-APPROVAL-2026-08-01' })
  @IsString()
  approvalReference!: string;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerProductId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  providerPriceId?: string;

  /** Jurisdiction-specific; never a hard-coded rate. */
  @ApiPropertyOptional({ example: 'EXCLUSIVE' })
  @IsOptional()
  @IsString()
  taxBehavior?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  legalTermsVersion?: string;
}
