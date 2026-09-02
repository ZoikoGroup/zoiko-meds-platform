import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';

@Module({
  imports: [AdminModule], // GatewayTelemetryInterceptor (ZoikoAvail request telemetry)
  controllers: [AvailabilityController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
