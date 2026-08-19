import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** A Google Maps share link whose coordinates the client could not read itself. */
export class ResolveMapLinkDto {
  @ApiProperty({ example: 'https://maps.app.goo.gl/AbCdEfGhIjK' })
  @IsString()
  @IsNotEmpty()
  // Long enough for a full place URL, short enough that nothing silly gets
  // handed to the fetch below.
  @MaxLength(2048)
  url: string;
}
