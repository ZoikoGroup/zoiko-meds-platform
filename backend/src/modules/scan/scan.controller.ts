import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { VisionExtractDto } from './dto/vision-extract.dto';
import { VisionService } from './vision.service';

/**
 * Prescription scan support endpoints.
 *
 * OCR itself runs in the browser (frontend: features/scan). This controller
 * exists only for the AI/Vision fallback, which must stay server-side so the
 * model API key is never shipped to the SPA.
 *
 * Authenticated: the scan surface lives inside the patient portal, and gating
 * on a JWT keeps an expensive, key-backed endpoint off the open internet.
 */
@ApiTags('scan')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('scan')
export class ScanController {
  constructor(private readonly vision: VisionService) {}

  @Get('vision-status')
  @ApiOperation({ summary: 'Is the AI/Vision prescription fallback configured?' })
  status() {
    return { available: this.vision.isEnabled() };
  }

  @Post('vision-extract')
  @HttpCode(200)
  // Vision calls are billed per image and are a fallback, not a hot path.
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Read medicine names from prescription page images' })
  async extract(@Body() dto: VisionExtractDto) {
    const medicines = await this.vision.extractMedicines(dto.images);
    return { medicines };
  }
}
