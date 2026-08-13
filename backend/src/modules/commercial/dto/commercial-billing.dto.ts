import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreditNoteReason } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

export class CreateBillingProfileDto {
  @ApiProperty({ example: 'Apollo Pharmacy Retail Pvt Ltd' })
  @IsString()
  legalName!: string;

  @ApiProperty({ example: 'billing@apollo.example' })
  @IsString()
  billingEmail!: string;

  /** Required: tax cannot be determined without a jurisdiction. */
  @ApiProperty({ example: 'IN' })
  @IsString()
  @Length(2, 2)
  country!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() merchantEntity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() addressLine2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() taxExempt?: boolean;
}

export class RecordTaxDeterminationDto {
  @ApiProperty()
  @IsString()
  billingProfileId!: string;

  @ApiProperty({ example: 'IN' })
  @IsString()
  @Length(2, 2)
  customerCountry!: string;

  /**
   * Basis points, an OUTPUT of the approved determination — 1800 is 18%. Never a
   * constant chosen by the platform.
   */
  @ApiProperty({ example: 1800 })
  @IsInt()
  @Min(0)
  rateBasisPoints!: number;

  @ApiProperty({ example: 19900, description: 'Amount the rate applies to, in minor units' })
  @IsInt()
  @Min(0)
  taxableAmountMinor!: number;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({
    example: 'STANDARD_RATED',
    description: 'STANDARD_RATED | ZERO_RATED | REVERSE_CHARGE | EXEMPT | NOT_REGISTERED',
  })
  @IsString()
  treatment!: string;

  @ApiProperty({ example: 'finance-manual', description: 'Engine or approver that determined this' })
  @IsString()
  determinedBy!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() customerRegion?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerPostalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() taxId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() taxExempt?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() productTaxCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() determinationRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() jurisdictionNote?: string;
}

export class DraftInvoiceDto {
  @ApiProperty()
  @IsString()
  billingProfileId!: string;

  @ApiProperty({ example: 'Zoiko Healthcare Inc.' })
  @IsString()
  supplierLegalEntity!: string;

  @ApiProperty({ example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ example: '2026-10-01T00:00:00.000Z' })
  @IsDateString()
  periodEnd!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiProperty({ example: 19900 })
  @IsInt()
  @Min(0)
  subtotalMinor!: number;

  @ApiPropertyOptional() @IsOptional() @IsString() subscriptionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) discountMinor?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) locationCount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() catalogVersion?: string;
}

export class IssueCreditNoteDto {
  @ApiProperty({ enum: CreditNoteReason })
  @IsEnum(CreditNoteReason)
  reason!: CreditNoteReason;

  @ApiProperty({ example: 1000 })
  @IsInt()
  @Min(1)
  amountMinor!: number;

  /** Required: credits post through an approved Finance workflow. */
  @ApiProperty({ example: 'FIN-CREDIT-2026-08-01' })
  @IsString()
  approvalReference!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() incidentReference?: string;
}

export class RefundDto {
  @ApiProperty({ example: 'pi_123' })
  @IsString()
  providerPaymentIntentId!: string;

  /** Required: a refund is a Finance decision, not an engineering action. */
  @ApiProperty({ example: 'FIN-REFUND-2026-08-01' })
  @IsString()
  approvalReference!: string;

  @ApiPropertyOptional({ description: 'Omit for a full refund' })
  @IsOptional()
  @IsInt()
  @Min(1)
  amountMinor?: number;
}
