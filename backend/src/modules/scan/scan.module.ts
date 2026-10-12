import { Module } from '@nestjs/common';
import { MedibaseModule } from '../medibase/medibase.module';
import { ScanController } from './scan.controller';
import { VisionService } from './vision.service';
import { GeminiPrescriptionService } from './gemini-prescription.service';
import { PrescriptionMatcherService } from './prescription-matcher.service';
import { PrescriptionScanService } from './prescription-scan.service';

/**
 * Prescription scanning.
 *
 * Reading is a Gemini call and identity is a MediBase decision, so the module
 * imports the catalog rather than calling its own HTTP route: it is the same
 * application, and a loopback request would add a hop, a second auth path and a
 * timeout for nothing.
 *
 * Everything here is inert unless GEMINI_API_KEY is set; the client asks
 * /scan/prescription-status first and simply does not offer the feature when it
 * is not configured.
 */
@Module({
  imports: [MedibaseModule],
  controllers: [ScanController],
  providers: [
    GeminiPrescriptionService,
    PrescriptionMatcherService,
    PrescriptionScanService,
    // Superseded by the services above; still provided because its route and
    // tests are intact (see scan.controller.ts).
    VisionService,
  ],
  exports: [PrescriptionScanService, VisionService],
})
export class ScanModule {}
