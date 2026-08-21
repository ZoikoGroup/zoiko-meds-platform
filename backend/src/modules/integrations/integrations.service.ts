import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationDeliveryStatus, ProviderMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isOAuthConfigured } from '../auth/guards/oauth.guard';
import { StripeConfig } from '../commercial/stripe/stripe.config';
import { MailService } from '../mail/mail.service';
import { VisionService } from '../scan/vision.service';

/**
 * Health of one external service this platform depends on.
 *
 * `manage` is a route in the admin console, or null when there is nothing to
 * manage there: several of these are configured by environment variable on the
 * server, and offering a button that opens nothing is what MSA-39 reported.
 */
export interface IntegrationStatus {
  id: string;
  name: string;
  category: string;
  /** operational | degraded | disabled */
  status: 'operational' | 'degraded' | 'disabled';
  /** One line an operator can act on, never a bare adjective. */
  detail: string;
  configured: boolean;
  manage: string | null;
  /** Set when the service is configured on the server rather than in the console. */
  configuredBy?: string;
}

/**
 * The platform's real external integrations (MSA-39).
 *
 * The page this feeds used to list eight named enterprise systems — Epic, Cerner,
 * Snowflake, Okta, Power BI and others — with invented statuses and sync times,
 * none of which this platform connects to and none of which exist anywhere in the
 * schema. To a super admin that is not stale data but a false account of what the
 * platform does, and every Manage button on it opened nothing.
 *
 * What is reported here is what the deployment actually talks to, read from the
 * same configuration and tables the features themselves use, so the page cannot
 * drift from reality: if payments are in test mode, this says so because
 * StripeConfig says so.
 */
@Injectable()
export class IntegrationsService {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stripe: StripeConfig,
    private readonly mail: MailService,
    private readonly vision: VisionService,
  ) {}

  async list(): Promise<IntegrationStatus[]> {
    return [
      this.payments(),
      await this.email(),
      this.oauth('GOOGLE', 'Google sign-in'),
      this.oauth('MICROSOFT', 'Microsoft sign-in'),
      this.prescriptionScan(),
    ];
  }

  /** Stripe, described by the gate that actually decides whether it can charge. */
  private payments(): IntegrationStatus {
    const blocked = this.stripe.chargingBlockedReason();

    if (!this.stripe.isConfigured) {
      return {
        id: 'stripe',
        name: 'Stripe',
        category: 'Payments',
        status: 'disabled',
        detail: 'No API key is set, so no purchase or invoice can be processed.',
        configured: false,
        manage: '/commercial',
        configuredBy: 'STRIPE_SECRET_KEY',
      };
    }

    const mode = this.stripe.mode === ProviderMode.LIVE ? 'live' : 'test';
    return {
      id: 'stripe',
      name: 'Stripe',
      category: 'Payments',
      // Test mode is not a fault — it is the correct state before launch — but it
      // is not "operational" either, because nothing it does moves real money.
      status: blocked ? 'degraded' : 'operational',
      detail: blocked
        ? `Connected in ${mode} mode, but charging is blocked: ${blocked}`
        : `Connected in ${mode} mode and authorised to charge.`,
      configured: true,
      manage: '/commercial',
    };
  }

  /**
   * Email, with the delivery record behind it rather than a claim of health. A
   * transport that accepts everything and delivers nothing looks identical from
   * configuration alone.
   */
  private async email(): Promise<IntegrationStatus> {
    if (!this.mail.isEnabled) {
      return {
        id: 'smtp',
        name: 'Email (SMTP)',
        category: 'Notifications',
        status: 'disabled',
        detail:
          'No SMTP host is set. Password resets and notifications are written to the server log instead of being sent.',
        configured: false,
        manage: '/notifications',
        configuredBy: 'SMTP_HOST',
      };
    }

    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [sent, failed] = await Promise.all([
      this.prisma.notificationDelivery.count({
        where: { status: NotificationDeliveryStatus.SENT, createdAt: { gte: since } },
      }),
      this.prisma.notificationDelivery.count({
        where: { status: NotificationDeliveryStatus.FAILED, createdAt: { gte: since } },
      }),
    ]);

    const attempted = sent + failed;
    return {
      id: 'smtp',
      name: 'Email (SMTP)',
      category: 'Notifications',
      status: failed > 0 && failed >= sent ? 'degraded' : 'operational',
      detail:
        attempted === 0
          ? 'Configured. Nothing has been sent in the last seven days.'
          : `${sent} delivered and ${failed} failed in the last seven days.`,
      configured: true,
      manage: '/notifications',
    };
  }

  /** A provider with no client id and secret is off, and its button returns 503. */
  private oauth(prefix: 'GOOGLE' | 'MICROSOFT', name: string): IntegrationStatus {
    const configured = isOAuthConfigured(this.config, prefix);
    return {
      id: prefix.toLowerCase(),
      name,
      category: 'Identity',
      status: configured ? 'operational' : 'disabled',
      detail: configured
        ? 'Client credentials are set, so the sign-in button completes.'
        : 'No client credentials, so the sign-in button answers 503 and only email sign-in works.',
      configured,
      // Nothing in the console manages this: it is credentials on the server.
      manage: null,
      configuredBy: `${prefix}_CLIENT_ID, ${prefix}_CLIENT_SECRET`,
    };
  }

  /** The AI fallback for prescription scanning. Browser OCR works without it. */
  private prescriptionScan(): IntegrationStatus {
    const enabled = this.vision.isEnabled();
    return {
      id: 'vision',
      name: 'Prescription scan (AI fallback)',
      category: 'Medicine intelligence',
      status: enabled ? 'operational' : 'disabled',
      detail: enabled
        ? 'Available when browser-side OCR cannot read a prescription.'
        : 'Disabled. Scanning still runs in the browser; unreadable prescriptions simply get no second attempt.',
      configured: enabled,
      manage: null,
      configuredBy: 'ANTHROPIC_API_KEY, SCAN_VISION_ENABLED',
    };
  }
}
