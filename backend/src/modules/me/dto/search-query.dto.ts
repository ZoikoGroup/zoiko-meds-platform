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

  // Distance ceiling in km — the client's radius selector is in km and the
  // value is sent through unconverted. The 1..100 range leaves headroom above
  // the 50 km selector maximum (which is also the Google Places circle cap).
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
