import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingChannel, BillingInterval } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export class ActivateProDto {
  @ApiProperty()
  @IsString()
  billingProfileId!: string;

  @ApiProperty()
  @IsString()
  pharmacyId!: string;

  @ApiProperty({ example: 'IN' })
  @IsString()
  @Length(2, 2)
  market!: string;

  @ApiProperty({ example: 'USD' })
  @IsString()
  @Length(3, 3)
  currency!: string;

  @ApiPropertyOptional({ enum: BillingInterval })
  @IsOptional()
  @IsEnum(BillingInterval)
  interval?: BillingInterval;

  @ApiPropertyOptional({ enum: BillingChannel })
  @IsOptional()
  @IsEnum(BillingChannel)
  channel?: BillingChannel;

  /**
   * The conversion preconditions, passed explicitly rather than inferred. Each one
   * is a separate gate that must be affirmatively true before a live charge exists.
   */
  @ApiProperty({ description: 'An Organization Owner or Billing Admin selected the offer' })
  @IsBoolean()
  hasAuthorizedPayer!: boolean;

  @ApiProperty({ description: 'Tax has been determined for this customer and jurisdiction' })
  @IsBoolean()
  hasTaxDetermination!: boolean;

  @ApiProperty({ description: 'Commercial terms were accepted by the payer' })
  @IsBoolean()
  termsAccepted!: boolean;
}
