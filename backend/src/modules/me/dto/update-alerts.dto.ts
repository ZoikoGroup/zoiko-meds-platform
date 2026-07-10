import { IsBoolean, IsOptional } from 'class-validator';

/** Patient alert toggles — all optional so the client can patch one at a time. */
export class UpdateAlertsDto {
  @IsOptional()
  @IsBoolean()
  backToHigh?: boolean;

  @IsOptional()
  @IsBoolean()
  nearby?: boolean;

  @IsOptional()
  @IsBoolean()
  confidenceChange?: boolean;

  @IsOptional()
  @IsBoolean()
  shortage?: boolean;
}
