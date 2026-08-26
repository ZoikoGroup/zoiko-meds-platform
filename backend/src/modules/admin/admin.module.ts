import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
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
import { IpAllowlistGuard } from './security/ip-allowlist.guard';
import { RoleCapabilitiesService } from './roles/role-capabilities.service';
import { PlatformApiKeyService } from './api-keys/platform-api-key.service';

@Module({
  imports: [
    // Supplies DiscoveryService/MetadataScanner so the capability matrix can be
    // read off the controllers rather than hand-maintained.
    DiscoveryModule,
    AuthModule,
    NearbyPharmacyModule,
  ],
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
    IpAllowlistGuard,
    RoleCapabilitiesService,
    PlatformApiKeyService,
  ],
  exports: [AuditWriter, IpAllowlistGuard, PlatformApiKeyService],
})
export class AdminModule {}
