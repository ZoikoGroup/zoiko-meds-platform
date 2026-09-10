import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderMode } from '@prisma/client';

/**
 * Stripe configuration and the live-mode gate (ZM-COM-BILL-001 S-3, S-P1, S-Q4).
 *
 * Two deliberate properties:
 *
 *  - Live mode is opt-in twice. A live secret key is not enough; BILLING_LIVE_MODE
 *    must also be true, which is the switch Finance flips only once the launch
 *    blockers close (approved catalog, verified merchant and bank beneficiary, tax
 *    registrations, reconciled legal entity). A live key left in an env file
 *    therefore cannot start charging anyone by itself.
 *  - Absence is not an error. With no key configured the platform runs normally
 *    with billing disabled, because charging is not required for the availability
 *    network to work. Callers ask `isConfigured` rather than getting a crash at boot.
 */
@Injectable()
export class StripeConfig {
  private readonly logger = new Logger(StripeConfig.name);

  constructor(private readonly config: ConfigService) {}

  get secretKey(): string | null {
    return this.config.get<string>('STRIPE_SECRET_KEY') || null;
  }

  get webhookSecret(): string | null {
    return this.config.get<string>('STRIPE_WEBHOOK_SECRET') || null;
  }

  /**
   * Verified supplier entity that appears on an invoice (S-N2, S-P2).
   *
   * Needed to record an invoice the provider raised, because for self-serve Pro
   * no internal step drafts one first and there is nowhere else to learn it from.
   * There is no honest default: which entity contracts with the pharmacy is a
   * property of the deployment, not of the payment. So an unset value stops the
   * invoice being recorded rather than stamping a guess onto a finance document.
   */
  get supplierLegalEntity(): string | null {
    return this.config.get<string>('BILLING_SUPPLIER_LEGAL_ENTITY')?.trim() || null;
  }

  get isConfigured(): boolean {
    return !!this.secretKey;
  }

  /**
   * Mode inferred from the key prefix rather than declared separately, so the two
   * can never disagree. Stripe live keys are sk_live_…; anything else is test.
   */
  get mode(): ProviderMode {
    return this.secretKey?.startsWith('sk_live_') ? ProviderMode.LIVE : ProviderMode.TEST;
  }

  /** Whether Finance has authorised live charging. */
  get liveModeAuthorized(): boolean {
    return this.config.get<string>('BILLING_LIVE_MODE') === 'true';
  }

  /**
   * The single question every charging path must ask. Returns why not, so the
   * caller can surface something specific instead of a bare false.
   */
  chargingBlockedReason(): string | null {
    if (!this.isConfigured) {
      return 'No payment provider is configured. STRIPE_SECRET_KEY is unset.';
    }
    if (this.mode === ProviderMode.LIVE && !this.liveModeAuthorized) {
      return (
        'A live Stripe key is present but live charging is not authorised. ' +
        'BILLING_LIVE_MODE must be enabled only after the launch blockers close: approved price ' +
        'catalog per market, verified merchant and bank beneficiary, tax registrations, and a ' +
        'reconciled contracting entity.'
      );
    }
    return null;
  }

  get canCharge(): boolean {
    return this.chargingBlockedReason() === null;
  }

  /**
   * Warn loudly at boot about the one genuinely dangerous combination: a live key
   * in a non-production process.
   */
  warnOnSuspiciousConfig(nodeEnv: string): void {
    if (this.mode === ProviderMode.LIVE && nodeEnv !== 'production') {
      this.logger.error(
        `A LIVE Stripe key is configured in NODE_ENV=${nodeEnv}. Use a test key outside production.`,
      );
    }
    if (this.isConfigured && !this.webhookSecret) {
      this.logger.warn(
        'STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not — webhooks will be rejected as unverified.',
      );
    }
    if (this.isConfigured && !this.supplierLegalEntity) {
      this.logger.warn(
        'STRIPE_SECRET_KEY is set but BILLING_SUPPLIER_LEGAL_ENTITY is not — invoices raised by the ' +
          'provider cannot be recorded, so a pharmacy that pays will see an empty invoice list. Set it ' +
          'to the verified supplier entity that must appear on the document.',
      );
    }
  }
}
