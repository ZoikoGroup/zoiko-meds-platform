import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { MedibaseController } from './medibase.controller';
import { MedibaseAdminController } from './medibase-admin.controller';
import { MedibaseCatalogController } from './medibase-catalog.controller';
import { MedibaseService } from './medibase.service';
import { MedibaseChangeLogWriter } from './medibase-changelog.writer';

@Module({
  imports: [AdminModule], // GatewayTelemetryInterceptor (ZoikoAvail request telemetry)
  controllers: [MedibaseController, MedibaseAdminController, MedibaseCatalogController],
  providers: [MedibaseService, MedibaseChangeLogWriter],
  exports: [MedibaseService],
})
export class MedibaseModule {}
