import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for adding a medicine to a pharmacy's inventory.
 */
export class AddInventoryDto {
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

  @ApiPropertyOptional({
    example: 'available',
    enum: ['available', 'limited', 'out-of-stock'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['available', 'limited', 'out-of-stock'])
  status?: string;
}
