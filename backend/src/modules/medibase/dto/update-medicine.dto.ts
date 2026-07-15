import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PrescriptionCategory } from '@prisma/client';

/**
 * Partial update of a medicine identity's descriptive fields. Quality-state
 * changes go through the dedicated transition endpoint, not this DTO, so state
 * governance is never bypassed by a generic field edit.
 */
export class UpdateMedicineDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  canonicalName?: string;

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
  @IsBoolean()
  isControlled?: boolean;

  @IsOptional()
  @IsString()
  jurisdictionId?: string;
}
