import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsLatitude,
  IsLongitude,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { MAX_DOCUMENT_BASE64_CHARS } from '../verification-document';

/**
 * The licence document sent with a verification submission.
 *
 * Base64 rather than multipart, matching how the prescription scan endpoint
 * already accepts a file — one transport for uploads, and no second body
 * parser to configure. The length cap here only bounds what reaches the
 * validator; the bytes are checked properly in readVerificationDocument.
 */
export class VerificationDocumentDto {
  @ApiPropertyOptional({ example: 'pharmacy-licence.pdf' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;

  @ApiPropertyOptional({ description: 'Base64, or a data: URL of the file.' })
  @IsString()
  @IsNotEmpty({ message: 'Select a licence document to upload.' })
  @MaxLength(MAX_DOCUMENT_BASE64_CHARS, {
    message: 'That file is too large. Licence documents must be under 5 MB.',
  })
  content!: string;
}

export class UpdatePharmacyProfileDto {
  @ApiPropertyOptional({ example: 'Apollo Pharmacy' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ example: 'LIC-HYD-01' })
  @IsOptional()
  @IsString()
  licenseNumber?: string;

  /**
   * Local or international form, both accepted: it is read against the pharmacy's
   * country and stored in E.164. A number that is not valid for that country is
   * rejected rather than saved, because a number nobody can ring still looks like
   * a way to reach the pharmacy.
   */
  @ApiPropertyOptional({
    example: '+91 40 2345 6789',
    description: 'Local or international form. Stored as E.164.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiPropertyOptional({ example: 'Kompally Main Rd' })
  @IsOptional()
  @IsString()
  addressLine1?: string;

  @ApiPropertyOptional({ example: 'Near Metro Station' })
  @IsOptional()
  @IsString()
  addressLine2?: string;

  @ApiPropertyOptional({ example: 'Hyderabad' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: 'Telangana' })
  @IsOptional()
  @IsString()
  region?: string;

  /**
   * A country name or its ISO-3166 alpha-2 code — "India" and "IN" are both
   * accepted. Stored as the code, because billing and the payment provider are
   * keyed on it.
   */
  @ApiPropertyOptional({ example: 'India', description: 'Country name or ISO alpha-2 code.' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: '500014' })
  @IsOptional()
  @IsString()
  postalCode?: string;

  /**
   * Where the pharmacy actually is, as a coordinate pair.
   *
   * Patient search is distance-bounded, so a pharmacy without coordinates can
   * never appear in it however well its inventory matches. The portal lets an
   * operator set these by pasting a Google Maps link; the columns are the same
   * ones admin geocoding and the nearby search already use.
   */
  @ApiPropertyOptional({ example: 17.5561 })
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @ApiPropertyOptional({ example: 78.4181 })
  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  /**
   * The licence document, sent with the same save that submits for review.
   *
   * One request, so an unreadable file fails the whole submission rather than
   * leaving a profile filed for verification with nothing attached to it.
   * Omitted on a save that is not changing the document — the stored one stays.
   */
  @ApiPropertyOptional({ type: VerificationDocumentDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => VerificationDocumentDto)
  document?: VerificationDocumentDto;
}
