import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCapability } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString } from 'class-validator';

export class GrantCapabilityDto {
  @ApiProperty()
  @IsString()
  userId!: string;

  @ApiProperty({ enum: BillingCapability })
  @IsEnum(BillingCapability)
  capability!: BillingCapability;

  /** Omit for a platform-wide grant; set to scope it to one organization. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  billingProfileId?: string;

  @ApiPropertyOptional({ example: 'Finance lead for the India launch' })
  @IsOptional()
  @IsString()
  reason?: string;

  /**
   * Required to grant financial authority to an operational role. Forces the
   * separation-of-duties trade-off to be a deliberate, audited choice.
   */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  acknowledgeSeparationOfDutiesConflict?: boolean;
}
