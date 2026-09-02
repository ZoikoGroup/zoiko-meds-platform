import { Module } from '@nestjs/common';
import { ScanController } from './scan.controller';
import { VisionService } from './vision.service';

/**
 * Prescription scan support. Browser-side OCR needs no backend; this module
 * hosts only the AI/Vision fallback, which is disabled unless
 * ANTHROPIC_API_KEY is set.
 */
@Module({
  controllers: [ScanController],
  providers: [VisionService],
  exports: [VisionService],
})
export class ScanModule {}
