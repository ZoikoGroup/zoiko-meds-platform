import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Trim before validating, so whitespace cannot pass for an answer.
 *
 * IsNotEmpty rejects an empty string but accepts "   ", which would otherwise
 * satisfy every rule below and then be stored as a blank strength.
 */
const Trimmed = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  );

/**
 * DTO for adding a medicine to a pharmacy's inventory.
 *
 * Generic name, strength and dosage form are required, not courtesy fields. This
 * request does not only record stock: when the name and strength match nothing in
 * MediBase it creates the medicine identity itself, and everything left blank here
 * is blank in the catalog every patient then searches (MP-46).
 *
 * They are required on that path only. A request carrying `medicineId` names an
 * identity that already exists and creates nothing, so there is no catalog entry
 * for a missing field to land in.
 *
 * Strength and form are also what tell two medicines apart. "Dolo" with no
 * strength is not a medicine — it is three of them — and a patient looking for
 * 650 mg should not be sent to a pharmacy holding 500 mg.
 */
export class AddInventoryDto {
  /**
   * MediBase™ identity id, when the caller has one.
   *
   * This is the primary way to say which medicine a row is about: the identity
   * is taken as given and no name matching happens at all, so the pharmacy's
   * signal and the identity patients search are guaranteed to be the same row.
   * `name` remains accepted for the portal form, which types a name rather than
   * picking an id.
   */
  @ApiPropertyOptional({ example: 'cmryk4tno000i6u3dvl2q2x6s' })
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'medicineId cannot be blank' })
  medicineId?: string;

  @ApiProperty({ example: 'Dolo 650' })
  @Trimmed()
  @ValidateIf((dto: AddInventoryDto) => !dto.medicineId)
  @IsString()
  @IsNotEmpty({ message: 'Medicine name is required.' })
  @MaxLength(200)
  name: string;

  @ApiProperty({ example: 'Paracetamol' })
  @Trimmed()
  @ValidateIf((dto: AddInventoryDto) => !dto.medicineId)
  @IsString()
  @IsNotEmpty({
    message: 'Generic name is required: it is what lets patients find equivalents.',
  })
  @MaxLength(200)
  generic: string;

  @ApiProperty({ example: '650 mg' })
  @Trimmed()
  @ValidateIf((dto: AddInventoryDto) => !dto.medicineId)
  @IsString()
  @IsNotEmpty({
    message: 'Strength is required: it is part of which medicine this is, not a detail.',
  })
  @MaxLength(60)
  strength: string;

  /**
   * Required, but accepted under either spelling. `dosageform` predates this DTO
   * and the global pipe rejects unknown properties, so dropping it would turn an
   * older client's request into a validation error instead of a stored medicine.
   */
  @ApiPropertyOptional({ example: 'Tablet', description: 'Required unless dosageform is given.' })
  @Trimmed()
  @ValidateIf((dto: AddInventoryDto) => !dto.medicineId && !dto.dosageform?.trim())
  @IsString()
  @IsNotEmpty({ message: 'Dosage form is required, e.g. Tablet, Syrup or Injection.' })
  @MaxLength(60)
  dosageForm?: string;

  @ApiPropertyOptional({ example: 'Tablet', description: 'Accepted alias of dosageForm.' })
  @Trimmed()
  @ValidateIf((dto: AddInventoryDto) => !dto.medicineId && !dto.dosageForm?.trim())
  @IsString()
  @IsNotEmpty({ message: 'Dosage form is required, e.g. Tablet, Syrup or Injection.' })
  @MaxLength(60)
  dosageform?: string;

  @ApiPropertyOptional({
    example: 'available',
    enum: ['available', 'limited', 'out-of-stock'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['available', 'limited', 'out-of-stock'])
  status?: string;
}
