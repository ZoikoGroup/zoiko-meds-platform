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
