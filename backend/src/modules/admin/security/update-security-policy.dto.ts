import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for PATCH /admin/security.
 *
 * Every field optional so one control can be changed without restating the
 * rest. The entries themselves are checked in the service rather than here: a
 * string can be well-formed and still be a range that matches nothing, and the
 * refusal has to name which entry was wrong.
 */
export class UpdateSecurityPolicyDto {
  @ApiPropertyOptional({ description: 'Require a second factor on every password sign-in.' })
  @IsOptional()
  @IsBoolean()
  requireMfa?: boolean;

  @ApiPropertyOptional({ description: 'Restrict the API to the addresses below.' })
  @IsOptional()
  @IsBoolean()
  ipAllowlistEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'Addresses or CIDR ranges, IPv4 or IPv6.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  // A bound, because this list is read on every request through the guard.
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  ipAllowlist?: string[];

  @ApiPropertyOptional({ description: 'Whether members may sign in through an identity provider.' })
  @IsOptional()
  @IsBoolean()
  allowOauthSignIn?: boolean;
}
