import { IsEnum } from 'class-validator';
import { MedicinePriority } from '@prisma/client';

/** Set the patient-assigned priority for a saved medicine. */
export class SetPriorityDto {
  @IsEnum(MedicinePriority)
  priority!: MedicinePriority;
}
