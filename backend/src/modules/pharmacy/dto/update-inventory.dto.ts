import { IsString, IsOptional, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO for updating availability status of an inventory item.
 */
export class UpdateInventoryDto {
  @ApiPropertyOptional({
    example: 'available',
    enum: ['available', 'limited', 'out-of-stock'],
  })
  @IsString()
  @IsOptional()
  @IsIn(['available', 'limited', 'out-of-stock'])
  status?: string;
}
