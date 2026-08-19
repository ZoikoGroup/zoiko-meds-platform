import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsOptional, IsString } from 'class-validator';

export class UpdatePharmacyProfileDto {
  @ApiPropertyOptional({ example: 'Apollo Pharmacy' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'LIC-HYD-01' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  @ApiPropertyOptional({ example: '+91 40 2345 6789' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Kompally Main Rd' })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional({ example: 'Near Metro Station' })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional({ example: 'Hyderabad' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Telangana' })
  @IsOptional()
  @IsString()
  region?: string;

  /**
   * A country name or its ISO-3166 alpha-2 code — "India" and "IN" are both
   * accepted. Stored as the code, because billing and the payment provider are
   * keyed on it.
   */
  @ApiPropertyOptional({ example: 'India', description: 'Country name or ISO alpha-2 code.' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '500014' })
  @IsOptional()
  @IsString()
  postalCode?: string;

  /**
   * Where the pharmacy actually is, as a coordinate pair.
   *
   * Patient search is distance-bounded, so a pharmacy without coordinates can
   * never appear in it however well its inventory matches. The portal lets an
   * operator set these by pasting a Google Maps link; the columns are the same
   * ones admin geocoding and the nearby search already use.
   */
  @ApiPropertyOptional({ example: 17.5561 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 78.4181 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}
