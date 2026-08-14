import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

/**
 * Save a medicine to the patient's list.
 *
 * Either identifier works:
 *  - `medicineId` — a governed MediBase identity (the normal path from search
 *    results and the medicine detail page).
 *  - `name` — a medicine MediBase does not contain yet. The row is stored by
 *    name and linked to an identity the first time a verified pharmacy adds it.
 *
 * `name` is accepted alongside `medicineId` too, so the caller can record what
 * the patient actually saw on screen.
 */
export class SaveMedicineDto {
  @ApiPropertyOptional({ description: 'MediBase medicine id, when the medicine is in the catalog.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  medicineId?: string;

  @ApiPropertyOptional({ description: 'Medicine name, required when no medicineId is supplied.' })
  // Required only when there is no medicineId, so one of the two must be present.
  @ValidateIf((dto: SaveMedicineDto) => !dto.medicineId)
  @IsString()
  @MinLength(2, { message: 'Provide a medicineId, or a medicine name of at least 2 characters.' })
  @MaxLength(120)
  name?: string;
}
