import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from '@prisma/client';

/** SUPER_ADMIN-created account. Unlike self-registration, any role may be assigned. */
export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  // Optional: when omitted (or when sendInvite is true) the account is created
  // without a password and the user sets one via an emailed invite link.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @IsEnum(UserRole)
  role!: UserRole;

  // If true, email a set-password invite link instead of using `password`.
  @IsOptional()
  @IsBoolean()
  sendInvite?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @IsOptional()
  @IsString()
  pharmacyId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
