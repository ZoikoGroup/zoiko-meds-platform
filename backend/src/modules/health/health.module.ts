import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MigrationStatusService } from './migration-status.service';

@Module({
  controllers: [HealthController],
  providers: [MigrationStatusService],
  exports: [MigrationStatusService],
})
export class HealthModule {}
