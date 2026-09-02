import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Largest single page image accepted, as a base64 data URL.
 *
 * 2.8 M characters is roughly a 2.1 MB JPEG — comfortably above what the client
 * produces (it renders pages at a 2000 px long edge, q0.85) and, at the 4-page
 * maximum below, inside the 12 MB ceiling main.ts gives this route. The two
 * numbers are deliberately kept in step: a DTO that admits more than the parser
 * accepts means the request dies before validation can explain why.
 */
const MAX_IMAGE_CHARS = 2_800_000;

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
    message:
      'Each page image must be under ~2 MB. Use a lower-resolution photo, or send fewer pages.',
  })
  @Matches(DATA_URL_RE, {
    each: true,
    message: 'Each image must be a base64 data URL of type image/jpeg, image/png, image/webp or image/gif.',
  })
  images!: string[];
}
