import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommercialModule } from '../commercial/commercial.module';
import { MailModule } from '../mail/mail.module';
import { ScanModule } from '../scan/scan.module';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * Reports on the platform's external dependencies (MSA-39).
 *
 * A module of its own rather than part of AdminModule: it needs StripeConfig from
 * CommercialModule, and CommercialModule already imports AdminModule, so putting
 * it there would make the two circular.
 */
@Module({
  imports: [PrismaModule, CommercialModule, MailModule, ScanModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
