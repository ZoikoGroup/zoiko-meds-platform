import { Module } from '@nestjs/common';
import { NearbyPharmacyModule } from '../nearby/nearby-pharmacy.module';
import { SignalModule } from '../signal/signal.module';
import { MeController } from './me.controller';
import { MeService } from './me.service';
import { PatientSignalController } from './signal/patient-signal.controller';
import { PatientSignalService } from './signal/patient-signal.service';

@Module({
  imports: [NearbyPharmacyModule, SignalModule],
  controllers: [MeController, PatientSignalController],
  providers: [MeService, PatientSignalService],
})
export class MeModule {}
