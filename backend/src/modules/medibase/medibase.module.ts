import { Module } from '@nestjs/common';
import { MedibaseController } from './medibase.controller';
import { MedibaseService } from './medibase.service';

@Module({
  controllers: [MedibaseController],
  providers: [MedibaseService],
  exports: [MedibaseService],
})
export class MedibaseModule {}
