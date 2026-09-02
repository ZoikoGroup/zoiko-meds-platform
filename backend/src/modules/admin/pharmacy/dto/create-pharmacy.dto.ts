import {
  IsInt,
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Trim before validating, so whitespace cannot pass for an answer — IsNotEmpty
 * rejects "" but accepts "   ", which would otherwise satisfy every rule below
 * and be stored as a blank city or country.
 */
const Trimmed = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

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

  // City and country are required (MSA-33): without them geocoding has
  // nothing to resolve, so the pharmacy is created with no coordinates and is
  // invisible to every distance-bounded patient search — a silently broken
  // record rather than a rejected submission.
  @Trimmed()
  @IsString()
  @IsNotEmpty({ message: 'City is required: without it the pharmacy cannot be located on the map.' })
  @MaxLength(120)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  postalCode?: string;

  @Trimmed()
  @IsString()
  @IsNotEmpty({ message: 'Country is required: without it the pharmacy cannot be located on the map.' })
  @MaxLength(120)
  country!: string;

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
