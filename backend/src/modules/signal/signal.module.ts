import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { SignalController } from './signal.controller';
import { SignalAdminController } from './signal-admin.controller';
import { SignalService } from './signal.service';
import { SignalIngestService } from './signal-ingest.service';
import { SignalAggregationService } from './signal-aggregation.service';
import { SignalScheduler } from './signal.scheduler';

/**
 * ZoikoSignal™ — aggregated, anonymized demand & shortage intelligence.
 *
 * Exposes:
 *  - a contract-scoped query/summary/export surface (SignalController),
 *  - an ADMIN operations surface (SignalAdminController),
 *  - the internal ingestion service other domains emit events into
 *    (SignalIngestService — exported), and
 *  - the aggregation job + scheduled recompute.
 */
@Module({
  imports: [AdminModule], // AuditWriter for admin action logging
  controllers: [SignalController, SignalAdminController],
  providers: [
    SignalService,
    SignalIngestService,
    SignalAggregationService,
    SignalScheduler,
  ],
  exports: [SignalIngestService],
})
export class SignalModule {}
