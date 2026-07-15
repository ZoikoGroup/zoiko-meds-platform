import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { QualityState } from '@prisma/client';

/** Request a governed quality-state transition for a medicine identity. */
export class TransitionStateDto {
  @IsEnum(QualityState)
  toState!: QualityState;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
