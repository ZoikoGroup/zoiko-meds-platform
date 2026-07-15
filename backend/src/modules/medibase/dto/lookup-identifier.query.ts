import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { SUPPORTED_IDENTIFIER_SYSTEMS } from '../identifier-systems';

/** Query params for looking a medicine up by an external identifier. */
export class LookupIdentifierQuery {
  @IsString()
  @IsIn(SUPPORTED_IDENTIFIER_SYSTEMS)
  system!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  value!: string;
}
