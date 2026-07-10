import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Public self-registration payload. Roles are never accepted here — new
 * accounts are always created as PUBLIC and elevated only by a SUPER_ADMIN.
 */
export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}
