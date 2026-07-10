import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import {
  NotificationStatus,
  NotificationTarget,
  NotificationType,
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
}
