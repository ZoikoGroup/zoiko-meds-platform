import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { HealthModule } from './modules/health/health.module';
import { MedibaseModule } from './modules/medibase/medibase.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { SignalModule } from './modules/signal/signal.module';
import { SearchModule } from './modules/search/search.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { EnterpriseModule } from './modules/enterprise/enterprise.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
        limit: Number(process.env.THROTTLE_LIMIT ?? 100),
      },
    ]),
    PrismaModule,
    HealthModule,
    AuthModule, // Authentication, JWT sessions & role-based access
    AdminModule, // SUPER_ADMIN platform administration
    // Service domains
    MedibaseModule, // MediBase™ medicine identity
    AvailabilityModule, // ZoikoAvail™ confidence engine
    SignalModule, // ZoikoSignal™ intelligence
    SearchModule, // Public medicine search
    PharmacyModule, // Pharmacy verification & participation
    EnterpriseModule, // Enterprise inquiries / lead capture
  ],
})
export class AppModule {}
