import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  // Distance ceiling in km (matches the patient filter: 2 / 5 / 10).
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsIn([2, 5, 10, 25, 100])
  maxDistance?: number;

  @IsOptional()
  @IsIn(['all', 'generic', 'brand'])
  type?: 'all' | 'generic' | 'brand';
}
