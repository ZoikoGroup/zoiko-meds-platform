import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  CreditNote,
  CreditNoteReason,
  Invoice,
  InvoiceStatus,
  PaymentProvider,
  ProviderMode,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { TaxService } from './tax.service';

/**
 * Fields that must never appear anywhere on an invoice (S-N2).
 *
 * The schema gives them no column, but free-text fields on a credit note could
 * still leak one, so notes are screened. An invoice is a finance document seen by
 * finance staff, and patient or medicine detail on it would turn routine billing
 * work into an unnecessary disclosure of what someone was looking for.
 */
const FORBIDDEN_INVOICE_TERMS = [
  'prescription',
  'diagnosis',
  'patient name',
  'medicine name',
  'search query',
  'search history',
];

/**
 * Invoicing (ZM-COM-BILL-001 S-N).
 *
 * Invoices are built from the subscription, its covered locations and a recorded
 * tax determination — never from usage telemetry or patient activity. Amounts are
 * integers in minor units throughout, and the catalog version is stamped so a
 * historic total can always be explained.
 */
@Injectable()
export class InvoiceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
    private readonly tax: TaxService,
  ) {}

  /**
   * Draft an invoice for a service period.
   *
   * Refuses without a tax determination: S-M3 forbids assuming a rate, so an
   * unresolved tax position must block the document rather than silently produce
   * one with zero tax.
   */
  async draft(
    actorId: string | null,
    input: {
      billingProfileId: string;
      subscriptionId?: string | null;
      supplierLegalEntity: string;
      periodStart: Date;
      periodEnd: Date;
      currency: string;
      subtotalMinor: number;
      discountMinor?: number;
      locationCount?: number;
      catalogVersion?: string | null;
      provider?: PaymentProvider;
      mode: ProviderMode;
    },
  ): Promise<Invoice> {
    if (input.periodEnd <= input.periodStart) {
      throw new BadRequestException('Invoice periodEnd must be after periodStart.');
    }
    if (!Number.isInteger(input.subtotalMinor) || input.subtotalMinor < 0) {
      throw new BadRequestException('subtotalMinor must be a non-negative integer.');
    }
    if (!input.supplierLegalEntity?.trim()) {
      throw new BadRequestException(
        'supplierLegalEntity is required: an invoice must identify the verified supplier entity.',
      );
    }

    const profile = await this.prisma.billingProfile.findUnique({
      where: { id: input.billingProfileId },
    });
    if (!profile) throw new BadRequestException('Billing profile not found');

    const determination = await this.tax.latestFor(input.billingProfileId);
    if (!determination) {
      throw new ForbiddenException(
        'No tax determination exists for this customer. Tax is jurisdiction-specific and must be ' +
          'resolved before invoicing — it is never assumed to be zero.',
      );
    }

    const discountMinor = input.discountMinor ?? 0;
    const taxable = Math.max(0, input.subtotalMinor - discountMinor);
    const taxMinor = this.tax.computeTax(taxable, determination.rateBasisPoints);
    const totalMinor = taxable + taxMinor;

    const invoice = await this.prisma.invoice.create({
      data: {
        billingProfileId: input.billingProfileId,
        subscriptionId: input.subscriptionId ?? null,
        invoiceNumber: await this.nextInvoiceNumber(),
        status: InvoiceStatus.DRAFT,
        supplierLegalEntity: input.supplierLegalEntity.trim(),
        customerLegalName: profile.legalName,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        locationCount: input.locationCount ?? 0,
        currency: input.currency.toUpperCase(),
        subtotalMinor: input.subtotalMinor,
        discountMinor,
        taxMinor,
        totalMinor,
        taxDeterminationId: determination.id,
        provider: input.provider ?? PaymentProvider.STRIPE,
        mode: input.mode,
        catalogVersion: input.catalogVersion ?? null,
      },
    });

    await this.audit.write(actorId, 'commercial.invoice.draft', 'Invoice', invoice.id, {
      invoiceNumber: invoice.invoiceNumber,
      totalMinor,
      taxMinor,
      currency: invoice.currency,
      taxDeterminationId: determination.id,
    });

    return invoice;
  }

  /**
   * Issue a credit note. Requires an approver and a reference: S-N4 puts financial
   * remediation with Finance under an approved policy, not with engineering.
   */
  async issueCreditNote(
    actorId: string,
    input: {
      invoiceId: string;
      reason: CreditNoteReason;
      amountMinor: number;
      approvalReference: string;
      note?: string;
      incidentReference?: string;
    },
  ): Promise<CreditNote> {
    if (!input.approvalReference?.trim()) {
      throw new ForbiddenException(
        'A credit note requires an approval reference. Credits post through an approved Finance workflow.',
      );
    }
    if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new BadRequestException('Credit amount must be a positive integer in minor units.');
    }
    this.assertNoProtectedData(input.note);
    this.assertNoProtectedData(input.incidentReference);

    const invoice = await this.prisma.invoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice) throw new BadRequestException('Invoice not found');

    // A credit cannot exceed what remains creditable, or the ledger stops
    // reconciling against the provider.
    const alreadyCredited = await this.prisma.creditNote.aggregate({
      where: { invoiceId: invoice.id },
      _sum: { amountMinor: true },
    });
    const remaining = invoice.totalMinor - (alreadyCredited._sum.amountMinor ?? 0);
    if (input.amountMinor > remaining) {
      throw new BadRequestException(
        `Credit of ${input.amountMinor} exceeds the ${remaining} still creditable on this invoice.`,
      );
    }

    const creditNote = await this.prisma.creditNote.create({
      data: {
        invoiceId: invoice.id,
        reason: input.reason,
        amountMinor: input.amountMinor,
        currency: invoice.currency,
        approvedByUserId: actorId,
        approvalReference: input.approvalReference.trim(),
        note: input.note ?? null,
        incidentReference: input.incidentReference ?? null,
        provider: invoice.provider,
      },
    });

    await this.audit.write(actorId, 'commercial.invoice.credit_note', 'Invoice', invoice.id, {
      creditNoteId: creditNote.id,
      reason: input.reason,
      amountMinor: input.amountMinor,
      approvalReference: input.approvalReference,
      incidentReference: input.incidentReference ?? null,
    });

    return creditNote;
  }

  async listForProfile(billingProfileId: string): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({
      where: { billingProfileId },
      orderBy: { createdAt: 'desc' },
      include: { creditNotes: true },
    });
  }

  /**
   * Sequential, human-facing invoice number. Derived from a count within the
   * current year so the reference is meaningful to finance rather than a cuid.
   */
  private async nextInvoiceNumber(): Promise<string> {
    const year = new Date().getUTCFullYear();
    const countThisYear = await this.prisma.invoice.count({
      where: {
        createdAt: {
          gte: new Date(Date.UTC(year, 0, 1)),
          lt: new Date(Date.UTC(year + 1, 0, 1)),
        },
      },
    });
    return `ZM-${year}-${String(countThisYear + 1).padStart(6, '0')}`;
  }

  /** Reject free text that would put protected detail on a finance document. */
  private assertNoProtectedData(text?: string | null): void {
    if (!text) return;
    const lowered = text.toLowerCase();
    const hit = FORBIDDEN_INVOICE_TERMS.find((term) => lowered.includes(term));
    if (hit) {
      throw new BadRequestException(
        `Invoice and credit-note text must not reference "${hit}". Patient names, medicine names, ` +
          'prescriptions and search queries never appear on a billing document.',
      );
    }
  }
}
