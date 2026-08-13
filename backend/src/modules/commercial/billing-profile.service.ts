import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BillingProfile } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';

/**
 * Billing profiles — the organizational billing identity (ZM-COM-BILL-001 S-2, S-A5).
 *
 * Billing identity is the legal organization, deliberately separate from the
 * patient/user identity used for medicine search. Nothing here accepts a user id
 * as the customer: a patient account can never acquire a billing profile, which is
 * what keeps payment data out of the patient surfaces entirely.
 */
@Injectable()
export class BillingProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  async create(
    actorId: string,
    input: {
      legalName: string;
      billingEmail: string;
      merchantEntity?: string | null;
      addressLine1?: string | null;
      addressLine2?: string | null;
      city?: string | null;
      region?: string | null;
      postalCode?: string | null;
      country?: string | null;
      taxId?: string | null;
      taxExempt?: boolean;
    },
  ): Promise<BillingProfile> {
    if (!input.legalName?.trim()) {
      throw new BadRequestException(
        'legalName is required: an invoice must identify the customer legal entity.',
      );
    }
    if (!input.billingEmail?.trim()) {
      throw new BadRequestException('billingEmail is required for billing correspondence.');
    }
    // Country is needed before tax can be determined, so requiring it here avoids
    // creating a profile that can never be invoiced (S-M3).
    if (!input.country?.trim()) {
      throw new BadRequestException(
        'country is required: tax is jurisdiction-specific and cannot be determined without it.',
      );
    }

    const profile = await this.prisma.billingProfile.create({
      data: {
        legalName: input.legalName.trim(),
        billingEmail: input.billingEmail.trim().toLowerCase(),
        merchantEntity: input.merchantEntity ?? null,
        addressLine1: input.addressLine1 ?? null,
        addressLine2: input.addressLine2 ?? null,
        city: input.city ?? null,
        region: input.region ?? null,
        postalCode: input.postalCode ?? null,
        country: input.country.trim().toUpperCase(),
        taxId: input.taxId ?? null,
        taxExempt: input.taxExempt ?? false,
      },
    });

    await this.audit.write(actorId, 'commercial.billing_profile.create', 'BillingProfile', profile.id, {
      legalName: profile.legalName,
      country: profile.country,
    });

    return profile;
  }

  async list(): Promise<BillingProfile[]> {
    return this.prisma.billingProfile.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subscriptions: {
          select: { id: true, offer: true, state: true, quantity: true },
        },
      },
    });
  }

  async get(id: string): Promise<BillingProfile> {
    const profile = await this.prisma.billingProfile.findUnique({
      where: { id },
      include: {
        subscriptions: { include: { locations: { where: { releasedAt: null } } } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!profile) throw new NotFoundException('Billing profile not found');
    return profile;
  }

  /**
   * Resolve the billing profile covering a pharmacy, via its active subscription
   * locations. Returns null when the pharmacy is on free participation — the normal
   * case, and not an error.
   */
  async forPharmacy(pharmacyId: string): Promise<BillingProfile | null> {
    const link = await this.prisma.subscriptionLocation.findFirst({
      where: { pharmacyId, releasedAt: null },
      include: { subscription: { include: { billingProfile: true } } },
      orderBy: { activatedAt: 'desc' },
    });
    return link?.subscription.billingProfile ?? null;
  }
}
