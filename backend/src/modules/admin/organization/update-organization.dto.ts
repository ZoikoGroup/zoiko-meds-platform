import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for PATCH /admin/organization.
 *
 * Every field optional, so the settings form can save one field without
 * blanking the rest. `slug` is absent on purpose: it is the workspace's stable
 * external handle, and renaming the organization must not change what it is.
 */
export class UpdateOrganizationDto {
  @ApiPropertyOptional({ description: 'Display name for this workspace.' })
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Workspace name cannot be empty.' })
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Where this deployment holds its data. Free text: it records a hosting decision made outside the application, which the application does not enforce.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  dataResidency?: string;

  @ApiPropertyOptional({ description: 'What kind of organization runs this deployment.' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  organizationType?: string;
}
