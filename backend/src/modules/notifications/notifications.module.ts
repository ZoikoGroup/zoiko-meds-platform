import { Global, Module } from '@nestjs/common';

import { NotificationsCoverageController } from './notifications-coverage.controller';
import { NotificationsService } from './notifications.service';

/**
 * Governed notification dispatch (ZM-NOT-EMAIL-02).
 *
 * Global so any workflow module can emit an event at the point its
 * authoritative state transition commits, without re-importing.
 */
@Global()
@Module({
  controllers: [NotificationsCoverageController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
