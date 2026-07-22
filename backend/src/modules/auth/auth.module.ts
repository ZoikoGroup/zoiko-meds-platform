import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { MicrosoftStrategy } from './strategies/microsoft.strategy';
import { AuditWriter } from '../admin/audit.writer';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // JWT_SECRET presence/strength is enforced at boot by validateEnv, so
        // by the time this runs it is guaranteed to be a safe value.
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '3600s'),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    // OAuth strategies self-guard construction with placeholder credentials,
    // so registering them never crashes boot; the OAuth guards return 503 when
    // a provider is not actually configured.
    GoogleStrategy,
    MicrosoftStrategy,
    AuditWriter,
  ],
  exports: [AuthService],
})
export class AuthModule {}

