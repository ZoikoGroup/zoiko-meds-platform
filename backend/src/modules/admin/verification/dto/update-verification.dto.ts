import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { VerificationRequestStatus } from '@prisma/client';

export class UpdateVerificationDto {
  @IsOptional()
  @IsEnum(VerificationRequestStatus)
  status?: VerificationRequestStatus;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reviewer?: string;

  // Free-text note appended to the request's running notes.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
