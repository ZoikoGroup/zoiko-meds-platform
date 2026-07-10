import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditWriter } from './audit.writer';
import { PharmacyAdminController } from './pharmacy/pharmacy-admin.controller';
import { PharmacyAdminService } from './pharmacy/pharmacy-admin.service';
import { VerificationController } from './verification/verification.controller';
import { VerificationService } from './verification/verification.service';
import { NotificationController } from './notification/notification.controller';
import { NotificationService } from './notification/notification.service';

@Module({
  controllers: [
    AdminController,
    PharmacyAdminController,
    VerificationController,
    NotificationController,
  ],
  providers: [
    AuditWriter,
    AdminService,
    PharmacyAdminService,
    VerificationService,
    NotificationService,
  ],
})
export class AdminModule {}
