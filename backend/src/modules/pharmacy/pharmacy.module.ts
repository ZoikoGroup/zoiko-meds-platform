import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { SavedMedicineLinkModule } from '../saved-link/saved-medicine-link.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';
import { PharmacyLogoService } from './logo/pharmacy-logo.service';

@Module({
  imports: [AdminModule, SavedMedicineLinkModule],
  controllers: [PharmacyController],
  providers: [PharmacyService, PharmacyLogoService],
  exports: [PharmacyService, PharmacyLogoService],
})
export class PharmacyModule {}

