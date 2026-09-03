import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  NotificationStatus,
  NotificationTarget,
  NotificationType,
  SafetyAlertKind,
} from '@prisma/client';

export class CreateNotificationDto {
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  message!: string;

  @IsEnum(NotificationType)
  type!: NotificationType;

  @IsEnum(NotificationTarget)
  target!: NotificationTarget;

  // Defaults to DISPATCHED (broadcast) unless explicitly saved as DRAFT.
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;

  /**
   * Which patient safety category an emergency broadcast belongs to.
   *
   * Required on an EMERGENCY_ALERT and validated here, not only in the modal:
   * ZoikoSignal used to derive this from `/recall/i` against the title, so
   * "Urgent product withdrawal" reached patients as a government advisory and
   * the toggle that governed a broadcast depended on its wording. A client that
   * skips the field must be refused rather than quietly guessed at.
   *
   * ValidateIf skips every rule below it when the type is not an emergency, so
   * the field is simply not part of the contract for the other three broadcast
   * types — the service drops anything sent there.
   */
  @ValidateIf((dto: CreateNotificationDto) => dto.type === NotificationType.EMERGENCY_ALERT)
  @IsEnum(SafetyAlertKind, {
    message:
      'An emergency alert needs a Safety Alert Type: MEDICINE_RECALL or GOVERNMENT_SAFETY.',
  })
  safetyKind?: SafetyAlertKind;
}
