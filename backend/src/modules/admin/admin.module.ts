import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AuditWriter } from './audit.writer';
import { PharmacyAdminController } from './pharmacy/pharmacy-admin.controller';
import { PharmacyAdminService } from './pharmacy/pharmacy-admin.service';
import { VerificationController } from './verification/verification.controller';
import { VerificationService } from './verification/verification.service';
import { NotificationController } from './notification/notification.controller';
import { NotificationService } from './notification/notification.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AdminController,
    PharmacyAdminController,
    VerificationController,
    NotificationController,
    ReportsController,
  ],
  providers: [
    AuditWriter,
    AdminService,
    PharmacyAdminService,
    VerificationService,
    NotificationService,
    ReportsService,
  ],
  exports: [AuditWriter],
})
export class AdminModule {}
