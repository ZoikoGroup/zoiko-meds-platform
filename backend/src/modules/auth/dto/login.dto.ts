import { IsEmail, IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  /**
   * The authenticator code, when the account has a second factor.
   *
   * Optional in the DTO rather than required, because the client cannot know
   * whether this account is enrolled until it has tried: a first attempt without
   * one is answered with mfaRequired, and the same call is repeated with the
   * code. Spacing is allowed through because authenticator apps display it.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[\d\s]{6,8}$/, { message: 'Enter the 6-digit code from your authenticator app.' })
  mfaCode?: string;
}
