import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateVerificationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  pharmacyName!: string;

  @IsString()
  @MaxLength(120)
  licenseNumber!: string;

  @IsString()
  @MaxLength(200)
  submittedBy!: string;

  @IsOptional()
  @IsString()
  pharmacyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  docName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  docUrl?: string;
}
