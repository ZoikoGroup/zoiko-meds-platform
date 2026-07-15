import { Module } from '@nestjs/common';
import { NearbyPharmacyService } from './nearby-pharmacy.service';

@Module({
  providers: [NearbyPharmacyService],
  exports: [NearbyPharmacyService],
})
export class NearbyPharmacyModule {}
