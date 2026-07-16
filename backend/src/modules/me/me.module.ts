import { Module } from '@nestjs/common';
import { NearbyPharmacyModule } from '../nearby/nearby-pharmacy.module';
import { SignalModule } from '../signal/signal.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';

@Module({
  imports: [NearbyPharmacyModule, SignalModule],
  controllers: [MeController],
  providers: [MeService],
})
export class MeModule {}
