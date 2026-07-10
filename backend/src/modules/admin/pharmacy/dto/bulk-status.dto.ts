import { ArrayNotEmpty, IsArray, IsEnum, IsString } from 'class-validator';
import { VerificationStatus } from '@prisma/client';

export class BulkStatusDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  ids!: string[];

  @IsEnum(VerificationStatus)
  status!: VerificationStatus;
}
