import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NearbyPharmacyModule } from '../nearby/nearby-pharmacy.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { DashboardOverviewService } from './dashboard-overview.service';
import { AuditWriter } from './audit.writer';
import { PharmacyAdminController } from './pharmacy/pharmacy-admin.controller';
import { PharmacyAdminService } from './pharmacy/pharmacy-admin.service';
import { VerificationController } from './verification/verification.controller';
import { VerificationService } from './verification/verification.service';
import { NotificationController } from './notification/notification.controller';
import { NotificationService } from './notification/notification.service';
import { ReportsController } from './reports/reports.controller';
import { ReportsService } from './reports/reports.service';
import { OrganizationService } from './organization/organization.service';
import { SecurityPostureService } from './security/security-posture.service';
import { HelpResourcesService } from './help/help-resources.service';

@Module({
  imports: [AuthModule, NearbyPharmacyModule],
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
    DashboardOverviewService,
    PharmacyAdminService,
    VerificationService,
    NotificationService,
    ReportsService,
    OrganizationService,
    SecurityPostureService,
    HelpResourcesService,
  ],
  exports: [AuditWriter],
})
export class AdminModule {}
