import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Body for PATCH /admin/security.
 *
 * Every field optional so one control can be changed without restating the
 * rest.
 */
export class UpdateSecurityPolicyDto {
  @ApiPropertyOptional({ description: 'Require a second factor on every password sign-in.' })
  @IsOptional()
  @IsBoolean()
  requireMfa?: boolean;

  @ApiPropertyOptional({ description: 'Whether members may sign in through an identity provider.' })
  @IsOptional()
  @IsBoolean()
  allowOauthSignIn?: boolean;
}
