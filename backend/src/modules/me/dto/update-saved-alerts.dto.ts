import { IsBoolean } from 'class-validator';

/** DTO for toggling alert preference on a specific saved medicine. */
export class UpdateSavedAlertsDto {
  @IsBoolean()
  alertsEnabled: boolean;
}
