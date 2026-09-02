import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { API_KEY_SCOPES } from './platform-api-key.service';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'What this key is for, so it can be recognised later.' })
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label!: string;

  @ApiProperty({ enum: API_KEY_SCOPES, description: 'What the key may read.' })
  // Closed set: a scope nothing enforces is a label, and the console must not
  // offer one the API does not honour.
  @IsIn(API_KEY_SCOPES as unknown as string[])
  scope!: string;
}
