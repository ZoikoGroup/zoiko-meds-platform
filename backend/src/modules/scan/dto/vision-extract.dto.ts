import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength } from 'class-validator';

/** Largest single page image accepted, as a base64 data URL (~6 MB of base64). */
const MAX_IMAGE_CHARS = 6_000_000;

/** Only raster formats the vision model accepts. */
const DATA_URL_RE = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export class VisionExtractDto {
  @ApiProperty({
    description:
      'Prescription page images as base64 data URLs (image/jpeg, png, webp or gif). Max 4 pages.',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(MAX_IMAGE_CHARS, {
    each: true,
    message: 'Each page image must be under ~4 MB. Reduce the resolution and try again.',
  })
  @Matches(DATA_URL_RE, {
    each: true,
    message: 'Each image must be a base64 data URL of type image/jpeg, image/png, image/webp or image/gif.',
  })
  images!: string[];
}
