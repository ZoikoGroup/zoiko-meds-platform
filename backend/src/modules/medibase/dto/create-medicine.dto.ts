import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PrescriptionCategory, QualityState } from '@prisma/client';
import { AddIdentifierDto } from './add-identifier.dto';

export class CreateMedicineDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  canonicalName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  genericName?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  brandNames?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  manufacturer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  activeIngredient?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  strength?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dosageForm?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  presentation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  atcCode?: string;

  @IsOptional()
  @IsEnum(PrescriptionCategory)
  prescriptionCategory?: PrescriptionCategory;

  @IsOptional()
  @IsEnum(QualityState)
  qualityState?: QualityState;

  @IsOptional()
  @IsBoolean()
  isControlled?: boolean;

  @IsOptional()
  @IsString()
  jurisdictionId?: string;

  // Optional identifier mappings to attach at creation time.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddIdentifierDto)
  @ArrayMaxSize(50)
  identifiers?: AddIdentifierDto[];
}
