import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsString, Length, Matches } from 'class-validator';

/**
 * A code from an authenticator app.
 *
 * Spacing is allowed through because apps and password managers display the six
 * digits as two groups, and the value is normally pasted rather than retyped.
 */
export class MfaCodeDto {
  @ApiProperty({ description: 'The 6-digit code currently shown by your authenticator app.' })
  @IsString()
  @Matches(/^[\d\s]{6,8}$/, {
    message: 'Enter the 6-digit code from your authenticator app.',
  })
  code!: string;
}

/**
 * The token from an emailed sign-in link (MSA-42).
 *
 * Opaque and long, so no format beyond "not empty and not enormous" can be
 * asserted without coupling this to how `createToken` happens to mint them.
 */
export class EmailSecondFactorTokenDto {
  @ApiProperty({ description: 'The token from the sign-in link that was emailed to you.' })
  @IsString()
  @Length(16, 256)
  token!: string;
}

/** Whether this account wants the emailed sign-in link as its second factor. */
export class EmailSecondFactorPreferenceDto {
  @ApiProperty({ description: 'Turn the emailed sign-in link on or off for this account.' })
  @IsBoolean()
  enabled!: boolean;
}
