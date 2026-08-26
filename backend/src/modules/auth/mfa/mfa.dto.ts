import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

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
