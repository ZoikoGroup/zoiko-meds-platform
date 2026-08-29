import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { SavedMedicineLinkModule } from '../saved-link/saved-medicine-link.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { PharmacyLogoService } from './logo/pharmacy-logo.service';
import { PharmacyNotificationService } from './notifications/pharmacy-notification.service';
import { PharmacyIntegrationService } from './integration/pharmacy-integration.service';
import { PharmacyIntegrationScheduler } from './integration/pharmacy-integration.scheduler';
import { NotificationPreferencesService } from './notification-preferences.service';

@Module({
  imports: [AdminModule, SavedMedicineLinkModule],
  controllers: [PharmacyController],
  providers: [
    PharmacyService,
    PharmacyLogoService,
    PharmacyNotificationService,
    NotificationPreferencesService,
    PharmacyIntegrationService,
    // Not exported: nothing outside this module should be starting feed runs,
    // and the timer it owns must exist once.
    PharmacyIntegrationScheduler,
  ],
  exports: [
    PharmacyService,
    PharmacyLogoService,
    PharmacyNotificationService,
    // Exported so notification producers outside this module (verification
    // review, for one) can ask before they notify.
    NotificationPreferencesService,
    PharmacyIntegrationService,
  ],
})
export class PharmacyModule {}

