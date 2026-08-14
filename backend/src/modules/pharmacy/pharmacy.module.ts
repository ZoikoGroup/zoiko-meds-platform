import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { SavedMedicineLinkModule } from '../saved-link/saved-medicine-link.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';

@Module({
  imports: [AdminModule, SavedMedicineLinkModule],
  controllers: [PharmacyController],
  providers: [PharmacyService],
  exports: [PharmacyService],
})
export class PharmacyModule {}

