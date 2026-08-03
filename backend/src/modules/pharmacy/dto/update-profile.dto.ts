import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

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

  @ApiPropertyOptional({ example: 'Hyderabad' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Telangana' })
  @IsOptional()
  @IsString()
  region?: string;

  @ApiPropertyOptional({ example: 'India' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '500014' })
  @IsOptional()
  @IsString()
  postalCode?: string;
}
