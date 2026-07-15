import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const toNum = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

/**
 * Public medicine search query. `q` is the medicine term; the optional
 * location fields drive the internet (nearby-pharmacy) part of the response.
 * Provide either lat+lng, or a city string to be geocoded.
 */
export class PublicSearchQuery {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @IsOptional()
  @Transform(toNum)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Transform(toNum)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  city?: string;

  // Search radius ceiling in km for internet pharmacies (1..50).
  @IsOptional()
  @Transform(toNum)
  @IsNumber()
  @Min(1)
  @Max(50)
  maxDistance?: number;
}
