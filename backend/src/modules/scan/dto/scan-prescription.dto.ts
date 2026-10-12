import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Largest prescription accepted, in bytes.
 *
 * 10 MB is what the upload surface already tells the patient ("JPG, PNG, PDF,
 * HEIC — max 10 MB"), so this is that promise enforced rather than a new limit.
 * Comfortably inside Gemini's own 50 MB / 1000-page document ceiling.
 */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

/**
 * The same limit expressed in base64 characters, which is what actually arrives.
 *
 * base64 is 4 characters per 3 bytes, plus the `data:…;base64,` prefix. Kept in
 * step with the route's body limit in main.ts on purpose: a DTO that admits more
 * than the parser accepts means the request dies before validation can explain
 * why.
 */
export const MAX_DATA_URL_CHARS = Math.ceil((MAX_FILE_BYTES * 4) / 3) + 128;

/**
 * Accepted envelope.
 *
 * The declared type is checked here only to reject obvious rubbish cheaply; the
 * authoritative decision is made from the bytes themselves (see file-type.ts),
 * because the client controls this string and a filename proves nothing.
 */
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp)|application\/pdf);base64,[A-Za-z0-9+/]+={0,2}$/;

export class ScanPrescriptionDto {
  @ApiProperty({
    description:
      'The prescription as a base64 data URL — image/jpeg, image/png, image/webp or application/pdf. Max 10 MB.',
    example: 'data:application/pdf;base64,JVBERi0xLjQK…',
  })
  @IsString()
  @MinLength(32, { message: 'The file appears to be empty.' })
  @MaxLength(MAX_DATA_URL_CHARS, {
    message: 'That file is larger than 10 MB. Try a smaller photo, or a single-prescription PDF.',
  })
  @Matches(DATA_URL_RE, {
    message:
      'Upload a JPG, PNG, WebP or PDF. Other formats cannot be read — on iPhone, choose "Take a photo" so the picture is saved as JPEG.',
  })
  file!: string;
}
