import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingChannel,
  BillingInterval,
  CommercialOffer,
  PriceCatalogEntry,
  Prisma,
} from '@prisma/client';
import { marketDefaultCurrency } from '../../common/countries';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { isZeroCostOffer } from './commercial.doctrine';

export interface PriceLookup {
  offer: CommercialOffer;
  market: string;
  currency: string;
  interval: BillingInterval;
  channel: BillingChannel;
  at?: Date;
}

/**
 * The same lookup with the currency left open, for a buyer who states a market but
 * not a currency — which is every self-serve purchase, since a pharmacy knows what
 * country it is in and not what the platform has chosen to bill that country in.
 */
export interface MarketPriceLookup {
  offer: CommercialOffer;
  market: string;
  interval: BillingInterval;
  channel: BillingChannel;
  currency?: string;
  at?: Date;
}

/** Input for a new catalog record, shared by the create path and its validation. */
export interface PriceEntryInput {
  offer: CommercialOffer;
  market: string;
  currency: string;
  interval: BillingInterval;
  amountMinor: number;
  channel: BillingChannel;
  catalogVersion: string;
  approvalReference: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
  providerProductId?: string | null;
  providerPriceId?: string | null;
  taxBehavior?: string;
  legalTermsVersion?: string | null;
}

/**
 * The price catalog (ZM-COM-BILL-001 S-21, S-E2, S-M2).
 *
 * The single source of a charge amount. Two properties matter most:
 *
 *  - It fails closed. If no approved record matches the market, currency,
 *    interval, channel and date, checkout must stop and route to sales rather
 *    than fall back to a default, a midpoint of a published range, or a constant.
 *    A marketing range such as "99-299 per location" is not an executable price.
 *  - A price referenced by a finalized invoice is immutable. Changing history
 *    would desynchronise finance records, so a new price is a new catalog version.
 */
@Injectable()
export class PriceCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * Resolve the approved price, or throw. Never returns a guess.
   *
   * Zero-cost offers are still catalog records: "free" has to be a deliberate,
   * approved state rather than the absence of a price, otherwise a missing record
   * and an intentionally free plan are indistinguishable.
   */
  async requirePrice(lookup: PriceLookup): Promise<PriceCatalogEntry> {
    const entry = await this.findPrice(lookup);
    if (!entry) {
      throw new NotFoundException(
        `No approved price catalog record for offer=${lookup.offer} market=${lookup.market} ` +
          `currency=${lookup.currency} interval=${lookup.interval} channel=${lookup.channel}. ` +
          'Checkout cannot proceed — contact ZoikoMeds sales. A published price range is not an executable price.',
      );
    }
    return entry;
  }

  /** Same lookup without throwing, for callers that need to branch. */
  async findPrice(lookup: PriceLookup): Promise<PriceCatalogEntry | null> {
    const at = lookup.at ?? new Date();

    return this.prisma.priceCatalogEntry.findFirst({
      where: {
        offer: lookup.offer,
        // Stored uppercase so a lowercase caller cannot miss an approved record.
        market: lookup.market.toUpperCase(),
        currency: lookup.currency.toUpperCase(),
        interval: lookup.interval,
        channel: lookup.channel,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      // Latest effective record wins when versions overlap.
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * Resolve the approved price for a market when the buyer has not named a
   * currency, or throw.
   *
   * A self-serve purchase states a country, not a currency: the pharmacy knows it
   * is in India, and which currency the platform bills India in is a commercial
   * decision recorded in this catalog. Assuming one — the previous behaviour, which
   * hard-coded USD — turns an approved INR price into a 404 for the only market it
   * was approved for.
   *
   * Choosing between approved records is not the same as guessing a price. Every
   * branch here returns a record Finance approved, and when the choice is genuinely
   * ambiguous it refuses rather than picking the cheaper or dearer one:
   *
   *  - one approved currency for the market: that one, no preference needed
   *  - several: the market's own currency, else USD as the platform's cross-border
   *    default, else an error naming the candidates so the caller states one
   */
  async requirePriceForMarket(lookup: MarketPriceLookup): Promise<PriceCatalogEntry> {
    const market = lookup.market.toUpperCase();

    if (lookup.currency) {
      return this.requirePrice({ ...lookup, market, currency: lookup.currency });
    }

    const at = lookup.at ?? new Date();
    const candidates = await this.prisma.priceCatalogEntry.findMany({
      where: {
        offer: lookup.offer,
        market,
        interval: lookup.interval,
        channel: lookup.channel,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });

    if (candidates.length === 0) {
      throw new NotFoundException(
        `No approved price catalog record for offer=${lookup.offer} market=${market} ` +
          `interval=${lookup.interval} channel=${lookup.channel} in any currency. ` +
          'Checkout cannot proceed — contact ZoikoMeds sales. A published price range is not an executable price.',
      );
    }

    // Insertion order is effectiveFrom desc, so the first record seen for a
    // currency is the one in force for it.
    const byCurrency = new Map<string, PriceCatalogEntry>();
    for (const entry of candidates) {
      if (!byCurrency.has(entry.currency)) byCurrency.set(entry.currency, entry);
    }

    if (byCurrency.size === 1) {
      return candidates[0];
    }

    const local = marketDefaultCurrency(market);
    const preferred = (local && byCurrency.get(local)) || byCurrency.get('USD');
    if (preferred) return preferred;

    throw new ConflictException(
      `Market ${market} has approved prices in ${[...byCurrency.keys()].sort().join(', ')} and no ` +
        'default for this market, so the currency to charge is ambiguous. Specify the currency.',
    );
  }

  /**
   * Reject an invalid catalog record before anything is written anywhere.
   *
   * Separate from createEntry so the caller that provisions a provider price can
   * check first: a rejected entry must not leave a live product behind at the
   * payment provider, which is exactly what happens if the provider is called and
   * the insert then fails.
   */
  assertEntryValid(input: PriceEntryInput): void {
    if (!input.approvalReference?.trim()) {
      throw new BadRequestException(
        'approvalReference is required: a price may not enter the catalog without a traceable approval.',
      );
    }
    if (!Number.isInteger(input.amountMinor) || input.amountMinor < 0) {
      throw new BadRequestException('amountMinor must be a non-negative integer in minor units.');
    }
    // A paid offer priced at zero is almost always a mistake, and would silently
    // give away a billable plan.
    if (input.amountMinor === 0 && !isZeroCostOffer(input.offer)) {
      throw new BadRequestException(
        `${input.offer} is a paid offer and cannot be priced at zero. Use the approved amount, or the free offer.`,
      );
    }
    // Conversely a "free" offer must stay free — that decision is governed and
    // cannot be changed by inserting a priced record (S-D1).
    if (input.amountMinor > 0 && isZeroCostOffer(input.offer)) {
      throw new BadRequestException(
        `${input.offer} is free at launch. Charging it requires a new approved commercial program, ` +
          'notice and explicit customer acceptance — not a catalog insert.',
      );
    }
    if (input.effectiveTo && input.effectiveTo <= input.effectiveFrom) {
      throw new BadRequestException('effectiveTo must be after effectiveFrom.');
    }
  }

  /**
   * Add an approved price. Requires an approval reference — pricing is a governed
   * commercial decision, not content management (S-P4), so a record with no
   * traceable approver is rejected outright.
   */
  async createEntry(actorId: string, input: PriceEntryInput): Promise<PriceCatalogEntry> {
    this.assertEntryValid(input);

    const market = input.market.toUpperCase();
    const currency = input.currency.toUpperCase();

    try {
      const entry = await this.prisma.priceCatalogEntry.create({
        data: {
          offer: input.offer,
          market,
          currency,
          interval: input.interval,
          amountMinor: input.amountMinor,
          channel: input.channel,
          catalogVersion: input.catalogVersion,
          approvalReference: input.approvalReference.trim(),
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          providerProductId: input.providerProductId ?? null,
          providerPriceId: input.providerPriceId ?? null,
          taxBehavior: input.taxBehavior ?? 'UNSPECIFIED',
          legalTermsVersion: input.legalTermsVersion ?? null,
        },
      });

      await this.audit.write(actorId, 'commercial.price_catalog.create', 'PriceCatalogEntry', entry.id, {
        offer: entry.offer,
        market: entry.market,
        currency: entry.currency,
        interval: entry.interval,
        amountMinor: entry.amountMinor,
        catalogVersion: entry.catalogVersion,
        approvalReference: entry.approvalReference,
      });

      return entry;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'An approved price already exists for this offer, market, currency, interval, channel and catalog version. ' +
            'Publish a new catalog version instead of replacing it.',
        );
      }
      throw err;
    }
  }

  /**
   * Mark a price as referenced by a finalized invoice. After this it can never be
   * edited — finance records must stay reconcilable (S-21).
   */
  async lock(entryId: string, actorId?: string): Promise<PriceCatalogEntry> {
    const entry = await this.prisma.priceCatalogEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Price catalog entry not found');
    if (entry.lockedAt) return entry;

    const locked = await this.prisma.priceCatalogEntry.update({
      where: { id: entryId },
      data: { lockedAt: new Date() },
    });
    await this.audit.write(actorId ?? null, 'commercial.price_catalog.lock', 'PriceCatalogEntry', entryId, {
      offer: entry.offer,
      market: entry.market,
    });
    return locked;
  }

  /**
   * Close a price to new sales by setting effectiveTo. Deliberately the only
   * mutation permitted on a locked record: withdrawing a price going forward is
   * legitimate, rewriting what a customer was charged is not.
   */
  async supersede(actorId: string, entryId: string, effectiveTo: Date): Promise<PriceCatalogEntry> {
    const entry = await this.prisma.priceCatalogEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Price catalog entry not found');
    if (effectiveTo <= entry.effectiveFrom) {
      throw new BadRequestException('effectiveTo must be after the record effectiveFrom.');
    }

    const updated = await this.prisma.priceCatalogEntry.update({
      where: { id: entryId },
      data: { effectiveTo },
    });
    await this.audit.write(actorId, 'commercial.price_catalog.supersede', 'PriceCatalogEntry', entryId, {
      effectiveTo: effectiveTo.toISOString(),
    });
    return updated;
  }

  /**
   * Guard for any other edit. A locked price is immutable; callers must publish a
   * new catalog version.
   */
  async assertMutable(entryId: string): Promise<void> {
    const entry = await this.prisma.priceCatalogEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('Price catalog entry not found');
    if (entry.lockedAt) {
      throw new ConflictException(
        'This price has been referenced by a finalized invoice and is immutable. Publish a new catalog version.',
      );
    }
  }

  async list(filter?: { offer?: CommercialOffer; market?: string; catalogVersion?: string }) {
    return this.prisma.priceCatalogEntry.findMany({
      where: {
        offer: filter?.offer,
        market: filter?.market?.toUpperCase(),
        catalogVersion: filter?.catalogVersion,
      },
      orderBy: [{ offer: 'asc' }, { market: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }
}
