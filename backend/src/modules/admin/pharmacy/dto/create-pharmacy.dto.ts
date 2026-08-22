import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePharmacyDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  licenseNumber?: string;

  // The pharmacy's own street address. Coordinates are geocoded from all of it
  // when the admin does not supply a pin: geocoding city + country alone
  // returns the city centroid, which places every branch in town on one point.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine1?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine2?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  // This branch's own contact number, shown on its patient-search card.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  // 0..100 reliability/availability score shown in the console.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  availabilityScore?: number;

  // Coordinates place the pharmacy on the patient-facing map and are what
  // every distance-bounded search filters on — a pharmacy without them can
  // never appear in "Availability near you". Optional here: when omitted, the
  // service geocodes the address instead.
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}
