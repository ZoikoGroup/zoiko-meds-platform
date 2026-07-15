import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const toNum = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  // Distance ceiling in km. Accepts any 1..100 value so the client can send a
  // radius derived from a miles selector (e.g. 15 mi ≈ 24 km).
  @IsOptional()
  @Transform(toNum)
  @IsNumber()
  @Min(1)
  @Max(100)
  maxDistance?: number;

  @IsOptional()
  @IsIn(['all', 'generic', 'brand'])
  type?: 'all' | 'generic' | 'brand';

  // Caller location for internet (nearby-pharmacy) discovery. Provide lat+lng
  // (from the browser's geolocation) or a city string to be geocoded.
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
}
