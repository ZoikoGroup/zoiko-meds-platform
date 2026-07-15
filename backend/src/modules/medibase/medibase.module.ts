import { Module } from '@nestjs/common';
import { MedibaseController } from './medibase.controller';
import { MedibaseAdminController } from './medibase-admin.controller';
import { MedibaseService } from './medibase.service';
import { MedibaseChangeLogWriter } from './medibase-changelog.writer';

@Module({
  controllers: [MedibaseController, MedibaseAdminController],
  providers: [MedibaseService, MedibaseChangeLogWriter],
  exports: [MedibaseService],
})
export class MedibaseModule {}
