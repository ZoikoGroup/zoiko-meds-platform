import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Query params for the public MediBase™ match endpoint. */
export class MatchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @IsOptional()
  @IsString()
  jurisdiction?: string; // jurisdiction code, e.g. "GB", "US-CA"

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeIdentifiers?: boolean;
}
