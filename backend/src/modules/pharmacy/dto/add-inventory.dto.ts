import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for adding a medicine to a pharmacy's inventory.
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
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Paracetamol' })
  @IsString()
  @IsOptional()
  generic?: string;

  @ApiPropertyOptional({ example: '650 mg' })
  @IsString()
  @IsOptional()
  strength?: string;

  @ApiPropertyOptional({ example: 'Tablet' })
  @IsString()
  @IsOptional()
  dosageForm?: string;

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
