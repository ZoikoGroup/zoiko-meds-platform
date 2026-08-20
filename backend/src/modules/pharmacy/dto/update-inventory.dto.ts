import { IsString, IsOptional, IsIn, IsNotEmpty } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for editing an inventory item.
 *
 * Every field the Edit Medicine dialog offers is accepted. Omitted fields are
 * left as they are, so the one-tap status toggle can keep posting `{ status }`
 * alone. The global ValidationPipe runs with `forbidNonWhitelisted`, so a field
 * missing here is not merely ignored — the whole request is rejected.
 */
export class UpdateInventoryDto {
  /**
   * Re-point this row at a MediBase™ identity by id.
   *
   * Takes precedence over `name`/`strength` resolution: the identity is taken
   * as given, which is the unambiguous way to move a row onto the identity
   * patients are actually searching. Omit it to keep the name-based resolution
   * the Edit Medicine dialog uses.
   */
  @ApiPropertyOptional({ example: 'cmryk4tno000i6u3dvl2q2x6s' })
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'medicineId cannot be blank' })
  medicineId?: string;

  @ApiPropertyOptional({ example: 'Asthalin' })
  @IsString()
  @IsOptional()
  @IsNotEmpty({ message: 'Medicine name cannot be blank' })
  name?: string;

  @ApiPropertyOptional({ example: 'Salbutamol' })
  @IsString()
  @IsOptional()
  generic?: string;

  @ApiPropertyOptional({ example: '200 mcg' })
  @IsString()
  @IsOptional()
  strength?: string;

  @ApiPropertyOptional({ example: 'Tablet' })
  @IsString()
  @IsOptional()
  dosageForm?: string;

  /** Lower-case alias accepted for parity with AddInventoryDto and CSV import. */
  @ApiPropertyOptional({ example: 'Tablet' })
  @IsString()
  @IsOptional()
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
