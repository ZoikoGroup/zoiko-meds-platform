import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { MailModule } from './modules/mail/mail.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { IpAllowlistGuard } from './modules/admin/security/ip-allowlist.guard';
import { MeModule } from './modules/me/me.module';
import { HealthModule } from './modules/health/health.module';
import { MedibaseModule } from './modules/medibase/medibase.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { SignalModule } from './modules/signal/signal.module';
import { SearchModule } from './modules/search/search.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { EnterpriseModule } from './modules/enterprise/enterprise.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { ScanModule } from './modules/scan/scan.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    PrismaModule,
    MailModule, // Transactional email (credentials, invites, resets)
    NotificationsModule, // ZM-NOT-EMAIL-02 governed notification dispatch
    HealthModule,
    AuthModule, // Authentication, JWT sessions & role-based access
    AdminModule, // SUPER_ADMIN platform administration
    MeModule, // Authenticated patient portal (search, saved, alerts)
    // Service domains
    MedibaseModule, // MediBase™ medicine identity
    AvailabilityModule, // ZoikoAvail™ confidence engine
    SignalModule, // ZoikoSignal™ intelligence
    SearchModule, // Public medicine search
    PharmacyModule, // Pharmacy verification & participation
    EnterpriseModule, // Enterprise inquiries / lead capture
    CommercialModule, // ZM-COM-BILL-001 billing, subscriptions & participation
    ScanModule, // Prescription scan — AI/Vision fallback (OCR runs in-browser)
    IntegrationsModule, // External-dependency status for the admin console
  ],
  providers: [
    // Enforce the configured rate limit globally. Without this the
    // ThrottlerModule config above is inert. Public read/search routes opt out
    // with @SkipThrottle; sensitive auth routes tighten it with @Throttle.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // The workspace IP allowlist (MSA-42). Global, because a restriction that
    // covers only the routes someone remembered to decorate is not one. It is
    // inert until an allowlist is switched on with entries in it, and always
    // answers the health probes so a wrong entry cannot take the instance out
    // of its load balancer.
    { provide: APP_GUARD, useClass: IpAllowlistGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Assign a request id to every request before anything else runs.
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
