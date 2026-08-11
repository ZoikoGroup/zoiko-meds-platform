import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { TaxDetermination } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Tax determination (ZM-COM-BILL-001 S-M3, S-M4).
 *
 * The doctrine forbids a hard-coded universal rate, and this service is built so
 * that inventing one is not possible: there is no rate table here. A determination
 * must be supplied by an approved source — a configured tax engine, or a manual
 * Finance determination with a reference — and is then persisted with its inputs so
 * the figure can be re-explained during an audit.
 *
 * With no engine configured, `determine` refuses rather than defaulting to zero.
 * Charging with an unresolved tax position is a compliance problem, and silently
 * assuming zero would hide it.
 *
 * ZoikoMeds never determines tax on the medicine a patient later buys at a
 * pharmacy: it is not the medicine seller, so that liability stays with the
 * dispensing pharmacy (S-M4). Nothing in this service takes a medicine as input.
 */
@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record an approved tax determination for a charge.
   *
   * Every field is an input from the approving source. `rateBasisPoints` is an
   * output of that determination, not a constant chosen here — 2000 means 20%,
   * stored in basis points so no float rounding creeps into a tax figure.
   */
  async record(input: {
    billingProfileId: string;
    customerCountry: string;
    customerRegion?: string | null;
    customerPostalCode?: string | null;
    taxId?: string | null;
    taxExempt?: boolean;
    productTaxCode?: string | null;
    rateBasisPoints: number;
    taxableAmountMinor: number;
    currency: string;
    treatment: string;
    determinedBy: string;
    determinationRef?: string | null;
    jurisdictionNote?: string | null;
  }): Promise<TaxDetermination> {
    if (!input.customerCountry?.trim()) {
      throw new BadRequestException(
        'Customer country is required: tax cannot be determined without evidence of customer location.',
      );
    }
    if (!input.determinedBy?.trim()) {
      throw new BadRequestException(
        'determinedBy is required — a tax determination must be attributable to an engine or an approver.',
      );
    }
    if (!Number.isInteger(input.rateBasisPoints) || input.rateBasisPoints < 0) {
      throw new BadRequestException('rateBasisPoints must be a non-negative integer.');
    }
    if (input.rateBasisPoints > 10_000) {
      throw new BadRequestException('rateBasisPoints cannot exceed 10000 (100%).');
    }
    if (!input.treatment?.trim()) {
      throw new BadRequestException(
        'treatment is required, e.g. STANDARD_RATED, ZERO_RATED, REVERSE_CHARGE, EXEMPT or NOT_REGISTERED.',
      );
    }

    // An exempt or reverse-charge customer must not carry a positive rate: the two
    // together would be internally contradictory on an invoice.
    if ((input.taxExempt || input.treatment === 'REVERSE_CHARGE') && input.rateBasisPoints > 0) {
      throw new BadRequestException(
        `Treatment ${input.treatment}${input.taxExempt ? ' (exempt customer)' : ''} cannot carry a positive tax rate.`,
      );
    }

    const taxAmountMinor = this.computeTax(input.taxableAmountMinor, input.rateBasisPoints);

    return this.prisma.taxDetermination.create({
      data: {
        billingProfileId: input.billingProfileId,
        customerCountry: input.customerCountry.trim().toUpperCase(),
        customerRegion: input.customerRegion ?? null,
        customerPostalCode: input.customerPostalCode ?? null,
        taxId: input.taxId ?? null,
        taxExempt: input.taxExempt ?? false,
        productTaxCode: input.productTaxCode ?? null,
        rateBasisPoints: input.rateBasisPoints,
        taxAmountMinor,
        currency: input.currency.toUpperCase(),
        treatment: input.treatment.trim(),
        determinedBy: input.determinedBy.trim(),
        determinationRef: input.determinationRef ?? null,
        jurisdictionNote: input.jurisdictionNote ?? null,
      },
    });
  }

  /**
   * Integer tax maths. Rounded half-up on the minor unit so a tax figure is exact
   * and reproducible rather than dependent on float representation.
   */
  computeTax(taxableAmountMinor: number, rateBasisPoints: number): number {
    if (taxableAmountMinor <= 0 || rateBasisPoints <= 0) return 0;
    return Math.round((taxableAmountMinor * rateBasisPoints) / 10_000);
  }

  /**
   * Whether a charge may proceed for a customer. Absent a determination, the answer
   * is no — deliberately, so an unresolved tax position blocks billing instead of
   * defaulting to zero tax.
   */
  async hasDetermination(billingProfileId: string): Promise<boolean> {
    const found = await this.prisma.taxDetermination.findFirst({
      where: { billingProfileId },
      orderBy: { determinedAt: 'desc' },
      select: { id: true },
    });
    return !!found;
  }

  async latestFor(billingProfileId: string): Promise<TaxDetermination | null> {
    return this.prisma.taxDetermination.findFirst({
      where: { billingProfileId },
      orderBy: { determinedAt: 'desc' },
    });
  }
}
