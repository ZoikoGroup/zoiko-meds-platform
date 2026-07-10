import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Self-service profile edits. Email and role are intentionally NOT editable here. */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}
