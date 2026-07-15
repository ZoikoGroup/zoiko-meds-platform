import { Module } from '@nestjs/common';
import { NearbyPharmacyModule } from '../nearby/nearby-pharmacy.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [NearbyPharmacyModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
