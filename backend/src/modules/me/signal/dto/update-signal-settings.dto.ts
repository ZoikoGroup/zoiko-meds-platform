import { IsBoolean, IsOptional } from 'class-validator';

/**
 * Patch for the patient ZoikoSignal™ notification settings. Every field is
 * optional so the UI can toggle a single switch at a time.
 */
export class UpdateSignalSettingsDto {
  @IsOptional()
  @IsBoolean()
  runningLow?: boolean;

  @IsOptional()
  @IsBoolean()
  backInStock?: boolean;

  @IsOptional()
  @IsBoolean()
  nearbyRestock?: boolean;

  @IsOptional()
  @IsBoolean()
  recall?: boolean;

  @IsOptional()
  @IsBoolean()
  safety?: boolean;

  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @IsOptional()
  @IsBoolean()
  sms?: boolean;
}
