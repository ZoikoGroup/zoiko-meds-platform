import { IsString, MinLength } from 'class-validator';

export class SaveMedicineDto {
  @IsString()
  @MinLength(1)
  medicineId!: string;
}
