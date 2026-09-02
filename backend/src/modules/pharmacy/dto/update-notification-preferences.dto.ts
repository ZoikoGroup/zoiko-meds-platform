import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/**
 * A change to the pharmacy-portal notification switches.
 *
 * Every field is optional because the settings page saves one switch at a time.
 * Omitted fields keep their stored value — this is a patch, not a replace.
 */
export class UpdateNotificationPreferencesDto {
  @ApiPropertyOptional({ description: 'Notify when a medicine drops to out of stock.' })
  @IsOptional()
  @IsBoolean()
  inventoryAlerts?: boolean;

  @ApiPropertyOptional({ description: 'Notify on licence and verification status changes.' })
  @IsOptional()
  @IsBoolean()
  verificationUpdates?: boolean;

  @ApiPropertyOptional({ description: 'Notify on CSV import success or failure.' })
  @IsOptional()
  @IsBoolean()
  uploadResults?: boolean;

  @ApiPropertyOptional({ description: 'Receive maintenance and platform announcements.' })
  @IsOptional()
  @IsBoolean()
  systemMessages?: boolean;
}
