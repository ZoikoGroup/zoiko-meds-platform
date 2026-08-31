import { Transform } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const toNum = ({ value }: { value: unknown }) =>
  value === '' || value == null ? undefined : Number(value);

/**
 * Where the caller is, for the saved-medicines list.
 *
 * Saved medicines answer "can I get this near me?", so the pharmacies attached
 * to each one have to be measured from the patient. All fields are optional:
 * with no location the list still returns, carrying every verified pharmacy
 * that stocks the medicine and no distances — which is the honest answer, and
 * what the page used to fake by measuring from a fixed demo address.
 */
export class SavedQueryDto {
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

  // Distance ceiling in km, matching the search radius selector.
  @IsOptional()
  @Transform(toNum)
  @IsNumber()
  @Min(1)
  @Max(100)
  maxDistance?: number;
}
