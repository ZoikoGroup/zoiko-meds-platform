import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ImportCsvRowDto {
  @ApiProperty({ example: 'Paracetamol 500' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Paracetamol' })
  @IsString()
  @IsOptional()
  generic?: string;

  @ApiPropertyOptional({ example: '500 mg' })
  @IsString()
  @IsOptional()
  strength?: string;

  @ApiPropertyOptional({ example: 'Tablet' })
  @IsString()
  @IsOptional()
  dosageform?: string;

  @ApiPropertyOptional({ example: 'Tablet' })
  @IsString()
  @IsOptional()
  dosageForm?: string;

  @ApiPropertyOptional({ example: 'available' })
  @IsString()
  @IsOptional()
  status?: string;
}

export class ImportCsvDto {
  @ApiProperty({ type: [ImportCsvRowDto] })
  @IsArray()
  rows: ImportCsvRowDto[];

  @ApiPropertyOptional({ example: 'merge', enum: ['merge', 'replace'] })
  @IsString()
  @IsOptional()
  mode?: 'merge' | 'replace';
}
