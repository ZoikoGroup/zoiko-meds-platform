import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VisionExtractDto } from './dto/vision-extract.dto';
import { ScanPrescriptionDto } from './dto/scan-prescription.dto';
import { VisionService } from './vision.service';
import { PrescriptionScanService } from './prescription-scan.service';

/**
 * Prescription scan endpoints.
 *
 * Reading happens here rather than in the browser: the model API key must never
 * reach the SPA, and a document model reads a prescription — handwriting,
 * tables, multi-page PDFs — far better than anything that fits in a page.
 *
 * Authenticated: the scan surface lives inside the patient portal, and gating on
 * a JWT keeps an expensive, key-backed endpoint off the open internet.
 */
@ApiTags('scan')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('scan')
export class ScanController {
  constructor(
    private readonly vision: VisionService,
    private readonly prescriptions: PrescriptionScanService,
  ) {}

  @Get('prescription-status')
  @ApiOperation({ summary: 'Is prescription scanning configured on this deployment?' })
  prescriptionStatus() {
    // `reason` is present only when unavailable, and describes the configuration
    // rather than quoting it. The client keys off `available` alone.
    return this.prescriptions.availability();
  }

  @Post('prescription')
  @HttpCode(200)
  // Reading is billed per document and is not a hot path. The limit is per user
  // and deliberately low: a patient scans a prescription, not a filing cabinet.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Read a prescription and verify every medicine against MediBase',
    description:
      'Accepts a JPG, PNG, WebP or PDF as a base64 data URL. Returns one entry per medicine found, ' +
      'each carrying the raw reading and a MediBase verification of MATCHED, AMBIGUOUS or NOT_FOUND. ' +
      'Medicine identity always comes from MediBase; the reader only transcribes.',
  })
  async scanPrescription(@Body() dto: ScanPrescriptionDto) {
    return this.prescriptions.scan(dto.file);
  }

  // --- Legacy image-only vision route ---------------------------------------
  // Superseded by POST /scan/prescription, which reads PDFs natively and returns
  // MediBase-verified identities rather than bare candidates. Kept because it is
  // a published, tested route with its own contract; it is not called by this
  // application any more.

  @Get('vision-status')
  @ApiOperation({ summary: 'Is the AI/Vision prescription fallback configured?', deprecated: true })
  status() {
    return this.vision.availability();
  }

  @Post('vision-extract')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Read medicine names from prescription page images', deprecated: true })
  async extract(@Body() dto: VisionExtractDto) {
    const medicines = await this.vision.extractMedicines(dto.images);
    return { medicines };
  }
}
