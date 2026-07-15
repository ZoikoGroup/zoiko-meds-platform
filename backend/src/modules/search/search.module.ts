import { Module } from '@nestjs/common';
import { MedibaseModule } from '../medibase/medibase.module';
import { AvailabilityModule } from '../availability/availability.module';
import { NearbyPharmacyModule } from '../nearby/nearby-pharmacy.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  imports: [MedibaseModule, AvailabilityModule, NearbyPharmacyModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
