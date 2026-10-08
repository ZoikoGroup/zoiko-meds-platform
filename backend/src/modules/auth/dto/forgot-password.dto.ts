import { IsEmail, IsIn, IsOptional } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;

  /**
   * Where the reset was asked for. 'app' (the Android shell) makes the emailed
   * link come back to the app on its custom scheme instead of the website —
   * the same marker the OAuth sign-in uses. Anything else, or absent, keeps the
   * link on the web, so a reset started on the platform stays on the platform.
   */
  @IsOptional()
  @IsIn(['app'])
  client?: 'app';
}
