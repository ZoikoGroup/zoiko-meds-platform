import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/**
 * Body for PATCH /me/saved/:medicineId/alerts.
 *
 * Previously the controller pulled `alertsEnabled` straight off the body with
 * `@Body('alertsEnabled')`, which bypasses the global ValidationPipe — that
 * only validates parameters typed as a DTO class. A non-boolean therefore
 * reached Prisma and failed against the Boolean column at the database layer.
 */
export class UpdateSavedAlertsDto {
  @ApiProperty({
    description: 'Whether availability alerts are enabled for this saved medicine.',
  })
  @IsBoolean()
  alertsEnabled!: boolean;
}
