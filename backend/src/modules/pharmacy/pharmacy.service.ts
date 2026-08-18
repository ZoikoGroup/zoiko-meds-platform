import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AvailabilityConfidence,
  CommercialClassification,
  UserRole,
  VerificationRequestStatus,
  VerificationStatus,
} from '@prisma/client';
import { resolveCountryAlpha2 } from '../../common/countries';
import { logoUrlFor } from './logo/pharmacy-logo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AddInventoryDto } from './dto/add-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { UpdatePharmacyProfileDto } from './dto/update-profile.dto';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';

/**
 * Maps the pharmacy-facing status string to the AvailabilityConfidence enum
 * used by the AvailabilitySignal model.
 */
const STATUS_TO_CONFIDENCE: Record<string, AvailabilityConfidence> = {
  available: AvailabilityConfidence.HIGH,
  limited: AvailabilityConfidence.MODERATE,
  'out-of-stock': AvailabilityConfidence.LOW,
};

/** Maps AvailabilityConfidence back to the pharmacy-facing status string. */
const CONFIDENCE_TO_STATUS: Record<string, string> = {
  HIGH: 'available',
  MODERATE: 'limited',
  LOW: 'out-of-stock',
  UNKNOWN: 'out-of-stock',
  SUPPRESSED: 'out-of-stock',
};

/**
 * Store the country as its alpha-2 code, whichever form the operator typed.
 *
 * The field is free text on the form and always will be — somebody will type
 * "India" and somebody else "IN", and both are the same answer. Billing is not so
 * forgiving: the price catalog is keyed on the code and the payment provider
 * rejects anything else, so the code is what gets persisted. An unrecognisable
 * value is refused at the edge instead of becoming a purchase that fails much
 * later with a message about markets.
 */
function normalizeCountryInput(country?: string | null): string | null {
  const typed = country?.trim();
  if (!typed) return null;

  const resolved = resolveCountryAlpha2(typed);
  if (!resolved) {
    throw new BadRequestException(
      `"${typed}" is not a country we recognise. Enter the country name, such as India, or its ` +
        'two-letter code, IN.',
    );
  }
  return resolved;
}

/**
 * Pharmacy verification, participation & inventory management.
 *
 * Handles the pharmacy portal domain: registration, verification workflow,
 * participation status, and inventory-signal intake. Confidential inventory
 * (exact quantities) is stored but never exposed on public surfaces.
 */
@Injectable()
export class PharmacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriter,
    private readonly savedLink: SavedMedicineLinkService,
  ) {}

  // ---------------------------------------------------------------------------
  // Public pharmacy queries (existing)
  // ---------------------------------------------------------------------------

  async listVerified() {
    const pharmacies = await this.prisma.pharmacy.findMany({
      where: { verificationStatus: 'VERIFIED', isParticipating: true },
      select: {
        id: true,
        name: true,
        city: true,
        region: true,
        reliabilityScore: true,
        // The timestamp, never the image: this list is a patient-facing query and
        // the bytes live in their own table precisely so it stays cheap.
        logoUpdatedAt: true,
      },
    });
    return pharmacies.map(({ logoUpdatedAt, ...pharmacy }) => ({
      ...pharmacy,
      logoUrl: logoUrlFor(pharmacy.id, logoUpdatedAt),
    }));
  }

  async findById(id: string) {
    const pharmacy = await this.prisma.pharmacy.findUnique({ where: { id } });
    // Returning null here would serialize as a 200 with an empty body, which
    // clients cannot distinguish from a successful fetch — surface a 404.
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');
    return { ...pharmacy, logoUrl: logoUrlFor(pharmacy.id, pharmacy.logoUpdatedAt) };
  }

  async getProfile(pharmacyId: string, user?: AuthenticatedUser) {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
    });
    if (!pharmacy) throw new NotFoundException('Pharmacy profile not found');

    const latestReq = await this.prisma.verificationRequest.findFirst({
      where: { pharmacyId },
      orderBy: { createdAt: 'desc' },
    });

    // Every field below is the stored value or empty — never a fabricated
    // placeholder. The profile page renders this as the pharmacy's own record,
    // so invented contact details would read as real data to the operator.
    return {
      id: pharmacy.id,
      isDraft: false,
      name: pharmacy.name,
      licenseNumber: pharmacy.licenseNumber || '',
      verificationStatus: pharmacy.verificationStatus,
      isParticipating: pharmacy.isParticipating,
      phone: pharmacy.phone || '',
      email: user?.email || '',
      addressLine1: pharmacy.addressLine1 || '',
      addressLine2: pharmacy.addressLine2 || '',
      city: pharmacy.city || '',
      region: pharmacy.region || '',
      country: pharmacy.country || '',
      postalCode: pharmacy.postalCode || '',
      reliabilityScore: Math.round(pharmacy.reliabilityScore * 100),
      logoUrl: logoUrlFor(pharmacy.id, pharmacy.logoUpdatedAt),
      // Commercial standing, so the portal can show the plan without a second
      // round trip. Deliberately not the price: what a pharmacy pays comes from
      // the catalog, and the profile is not a billing surface (ZM-COM-BILL-001).
      commercialClassification: pharmacy.commercialClassification,
      reviewStatus: latestReq?.status ?? null,
      reviewedBy: latestReq?.reviewer ?? null,
      submittedAt: latestReq?.createdAt ?? null,
      notes: latestReq?.notes || null,
    };
  }

  /**
   * Profile for the logged-in pharmacy user, resolved from Pharmacy Management.
   *
   * An account with no pharmacy link yet gets an empty draft rather than an
   * error: that is the self-onboarding path, where the operator fills in their
   * own details and `saveMyProfile` files the verification request. Inventory
   * routes still hard-fail on a missing link via `resolvePharmacyId`.
   */
  async getMyProfile(user: AuthenticatedUser) {
    const pharmacyId = await this.findMyPharmacyId(user);
    if (pharmacyId) return this.getProfile(pharmacyId, user);

    // An admin may already have queued a placeholder request for this account
    // (AdminService.ensurePharmacyVerificationRequest). Carry its reviewer
    // correspondence into the draft so the operator sees where they stand
    // instead of being told nothing has been submitted.
    const pending = user?.email
      ? await this.prisma.verificationRequest.findFirst({
          where: {
            pharmacyId: null,
            submittedBy: { contains: user.email, mode: 'insensitive' },
          },
          orderBy: { createdAt: 'desc' },
        })
      : null;

    return {
      id: null,
      isDraft: true,
      name: '',
      licenseNumber: '',
      verificationStatus: VerificationStatus.UNVERIFIED,
      isParticipating: false,
      phone: '',
      email: user?.email || '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      region: '',
      country: '',
      postalCode: '',
      reliabilityScore: 0,
      // Same shape as a saved profile: a draft simply has no logo yet.
      logoUrl: null,
      // No pharmacy record exists yet, so there is nothing claimed either.
      commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
      reviewStatus: pending?.status ?? null,
      reviewedBy: pending?.reviewer ?? null,
      submittedAt: pending?.createdAt ?? null,
      notes: pending?.notes ?? null,
    };
  }

  /** Pharmacy link for the caller, or null when the account has none yet. */
  private async findMyPharmacyId(user: AuthenticatedUser): Promise<string | null> {
    if (user?.pharmacyId) return user.pharmacyId;
    if (!user?.id) return null;
    const row = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { pharmacyId: true },
    });
    return row?.pharmacyId ?? null;
  }

  /**
   * Save the logged-in pharmacy's own profile, creating the Pharmacy record on
   * first submit, and file a verification request for the admin panel.
   *
   * Re-review is triggered when the pharmacy is not yet verified, and when an
   * already-verified pharmacy changes its name or licence number — those are the
   * two fields verification actually attests to, so a change has to be re-checked.
   * Address and phone edits on a verified pharmacy do not drop its status.
   */
  async saveMyProfile(
    user: AuthenticatedUser,
    dto: UpdatePharmacyProfileDto,
    ipAddress?: string,
  ) {
    const pharmacyId = await this.findMyPharmacyId(user);
    if (pharmacyId) {
      return this.updateProfile(pharmacyId, dto, user, ipAddress);
    }

    const name = dto.name?.trim();
    const licenseNumber = dto.licenseNumber?.trim();
    if (!name || !licenseNumber) {
      throw new BadRequestException(
        'Pharmacy name and licence number are required to submit your pharmacy for verification.',
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const pharmacy = await tx.pharmacy.create({
        data: {
          name,
          licenseNumber,
          phone: dto.phone?.trim() || null,
          addressLine1: dto.addressLine1?.trim() || null,
          addressLine2: dto.addressLine2?.trim() || null,
          city: dto.city?.trim() || null,
          region: dto.region?.trim() || null,
          country: normalizeCountryInput(dto.country),
          postalCode: dto.postalCode?.trim() || null,
          // Awaiting review — a self-declared pharmacy is never trusted on
          // submit, so it stays out of public results until an admin approves.
          verificationStatus: VerificationStatus.PENDING,
          isParticipating: false,
          reliabilityScore: 0,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { pharmacyId: pharmacy.id },
      });

      // Adopt any request raised before this pharmacy record existed so the
      // Verification Center shows one row, not two.
      //
      // Matching on licence alone is not enough: AdminService provisions a
      // request via ensurePharmacyVerificationRequest as soon as an account gets
      // a pharmacy role, and it cannot know the real licence — so that row never
      // matches what the operator later types. Match on the submitting account
      // as well, which is the stable identifier across both paths, and overwrite
      // the provisional name/licence with what was actually submitted.
      const orphan = await tx.verificationRequest.findFirst({
        where: {
          pharmacyId: null,
          OR: [
            { licenseNumber },
            { submittedBy: { contains: user.email, mode: 'insensitive' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
      });
      if (orphan) {
        await tx.verificationRequest.update({
          where: { id: orphan.id },
          data: {
            pharmacyId: pharmacy.id,
            pharmacyName: name,
            licenseNumber,
            submittedBy: `${user.fullName} (${user.email})`,
            status: VerificationRequestStatus.PENDING,
            notes: orphan.notes
              ? `${orphan.notes}\nPharmacy submitted its own details from the pharmacy portal profile.`
              : 'Submitted by the pharmacy from the pharmacy portal profile.',
          },
        });
      } else {
        await tx.verificationRequest.create({
          data: {
            pharmacyId: pharmacy.id,
            pharmacyName: name,
            licenseNumber,
            submittedBy: `${user.fullName} (${user.email})`,
            status: VerificationRequestStatus.PENDING,
            notes: 'Submitted by the pharmacy from the pharmacy portal profile.',
          },
        });
      }

      return pharmacy;
    });

    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.profile.submit',
      'Pharmacy',
      created.id,
      { userId: user?.id, pharmacyId: created.id, name, licenseNumber },
      ipAddress,
    );

    return this.getProfile(created.id, user);
  }

  async updateProfile(
    pharmacyId: string,
    dto: UpdatePharmacyProfileDto,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const existing = await this.prisma.pharmacy.findUnique({ where: { id: pharmacyId } });
    if (!existing) throw new NotFoundException('Pharmacy not found');

    const updated = await this.prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: {
        name: dto.name !== undefined ? dto.name : existing.name,
        licenseNumber: dto.licenseNumber !== undefined ? dto.licenseNumber : existing.licenseNumber,
        phone: dto.phone !== undefined ? dto.phone : existing.phone,
        addressLine1: dto.addressLine1 !== undefined ? dto.addressLine1 : existing.addressLine1,
        addressLine2: dto.addressLine2 !== undefined ? dto.addressLine2 : existing.addressLine2,
        city: dto.city !== undefined ? dto.city : existing.city,
        region: dto.region !== undefined ? dto.region : existing.region,
        country: dto.country !== undefined ? normalizeCountryInput(dto.country) : existing.country,
        postalCode: dto.postalCode !== undefined ? dto.postalCode : existing.postalCode,
        updatedAt: new Date(),
      },
    });

    if (dto.name || dto.licenseNumber) {
      await this.prisma.verificationRequest.updateMany({
        where: { pharmacyId },
        data: {
          pharmacyName: updated.name,
          licenseNumber: updated.licenseNumber || '',
        },
      });
    }

    // A pharmacy that is not verified yet always goes (back) into the review
    // queue on save. A verified one only does so if the attested identity —
    // name or licence — actually changed.
    //
    // SUSPENDED is deliberately excluded: it is an enforcement state, so letting
    // a save move it to PENDING would let a suspended pharmacy clear its own
    // suspension. Only an admin can lift it from the Verification Center.
    const identityChanged =
      existing.name !== updated.name ||
      (existing.licenseNumber || '') !== (updated.licenseNumber || '');
    const suspended = existing.verificationStatus === VerificationStatus.SUSPENDED;
    const needsReview =
      !suspended &&
      (existing.verificationStatus !== VerificationStatus.VERIFIED || identityChanged);

    if (needsReview && user) {
      await this.submitForReview(updated, user, identityChanged);
    }

    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.profile.update',
      'Pharmacy',
      pharmacyId,
      {
        userId: user?.id,
        pharmacyId,
        name: updated.name,
        licenseNumber: updated.licenseNumber,
        resubmittedForReview: needsReview,
      },
      ipAddress,
    );

    return this.getProfile(pharmacyId, user);
  }

  /**
   * Put a pharmacy into the admin Verification Center queue. Reuses an open
   * request when one exists so repeated saves do not flood the reviewer with
   * duplicate rows for the same pharmacy.
   */
  private async submitForReview(
    pharmacy: { id: string; name: string; licenseNumber: string | null },
    user: AuthenticatedUser,
    identityChanged: boolean,
  ) {
    const OPEN = [
      VerificationRequestStatus.PENDING,
      VerificationRequestStatus.UNDER_REVIEW,
      VerificationRequestStatus.ESCALATED,
      VerificationRequestStatus.REQUEST_INFO,
    ];

    await this.prisma.pharmacy.update({
      where: { id: pharmacy.id },
      data: {
        verificationStatus: VerificationStatus.PENDING,
        isParticipating: false,
        updatedAt: new Date(),
      },
    });

    const open = await this.prisma.verificationRequest.findFirst({
      where: { pharmacyId: pharmacy.id, status: { in: OPEN } },
      orderBy: { createdAt: 'desc' },
    });

    const note = identityChanged
      ? 'Pharmacy updated its name or licence number — re-verification required.'
      : 'Pharmacy updated its profile and resubmitted for verification.';

    if (open) {
      await this.prisma.verificationRequest.update({
        where: { id: open.id },
        data: {
          pharmacyName: pharmacy.name,
          licenseNumber: pharmacy.licenseNumber || '',
          status: VerificationRequestStatus.PENDING,
          notes: open.notes ? `${open.notes}\n${note}` : note,
        },
      });
      return;
    }

    await this.prisma.verificationRequest.create({
      data: {
        pharmacyId: pharmacy.id,
        pharmacyName: pharmacy.name,
        licenseNumber: pharmacy.licenseNumber || '',
        submittedBy: `${user.fullName} (${user.email})`,
        status: VerificationRequestStatus.PENDING,
        notes: note,
      },
    });
  }

  /**
   * Billing view for the logged-in pharmacy (ZM-COM-BILL-001 S-22).
   *
   * Financial detail is scoped by role, per the published access matrix: a
   * Pharmacy Manager sees plan and usage but no invoice amounts, and a Pharmacist
   * sees only operational limits. Rather than returning everything and hoping the
   * client hides it, the fields simply are not present for roles that may not see
   * them — a UI bug cannot then leak them.
   *
   * There is no payment method or checkout here. Purchasing runs through an
   * authorized payer, and the portal is not a billing surface.
   */
  async getMyBilling(user: AuthenticatedUser) {
    const pharmacyId = await this.findMyPharmacyId(user);
    if (!pharmacyId) {
      return {
        linked: false,
        classification: CommercialClassification.DIRECTORY_UNCLAIMED,
        participatesInNetworkCore: false,
        canSeeFinancialDetail: false,
        plan: null,
        invoices: [],
      };
    }

    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { commercialClassification: true, name: true },
    });

    const link = await this.prisma.subscriptionLocation.findFirst({
      where: { pharmacyId, releasedAt: null },
      orderBy: { activatedAt: 'desc' },
      include: {
        subscription: {
          include: { priceCatalogEntry: true, billingProfile: true },
        },
      },
    });

    const subscription = link?.subscription ?? null;

    // Only a Pharmacy Manager (PHARMACY_ADMIN) or above may see amounts. Staff
    // get plan status alone.
    const canSeeFinancialDetail =
      user.role === UserRole.PHARMACY_ADMIN ||
      user.role === UserRole.SUPER_ADMIN ||
      user.role === UserRole.ADMIN;

    const plan = subscription
      ? {
          offer: subscription.offer,
          state: subscription.state,
          quantity: subscription.quantity,
          currentPeriodEnd: subscription.currentPeriodEnd,
          evaluationEndsAt: subscription.evaluationEndsAt,
          // Amounts only for roles permitted financial detail.
          ...(canSeeFinancialDetail && subscription.priceCatalogEntry
            ? {
                amountMinor: subscription.priceCatalogEntry.amountMinor,
                currency: subscription.priceCatalogEntry.currency,
                interval: subscription.priceCatalogEntry.interval,
              }
            : {}),
        }
      : null;

    let invoices: unknown[] = [];
    if (canSeeFinancialDetail && subscription?.billingProfileId) {
      const rows = await this.prisma.invoice.findMany({
        where: { billingProfileId: subscription.billingProfileId },
        orderBy: { createdAt: 'desc' },
        take: 24,
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          currency: true,
          totalMinor: true,
          amountPaidMinor: true,
          periodStart: true,
          periodEnd: true,
          issuedAt: true,
          paidAt: true,
        },
      });
      invoices = rows;
    }

    return {
      linked: true,
      pharmacyName: pharmacy?.name ?? null,
      classification:
        pharmacy?.commercialClassification ?? CommercialClassification.DIRECTORY_UNCLAIMED,
      participatesInNetworkCore: true,
      canSeeFinancialDetail,
      plan,
      invoices,
    };
  }

  async getUserNotifications(userId: string) {
    const list = await this.prisma.signalNotification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return list.map((n) => ({
      id: n.id,
      type: 'verification',
      title: n.title,
      message: n.description,
      when: this.timeAgo(n.createdAt),
      unread: !n.read,
    }));
  }

  // ---------------------------------------------------------------------------
  // Pharmacy-scoped inventory management
  // ---------------------------------------------------------------------------

  /**
   * Resolve the pharmacyId for the current user. The caller MUST be linked to a
   * pharmacy — there is no fallback. Returning some other pharmacy's id when the
   * user has none would let any authenticated account read and mutate a
   * pharmacy's inventory, so a missing link is a hard authorization failure.
   */
  async resolvePharmacyId(
    userPharmacyId: string | null,
    userId?: string,
  ): Promise<string> {
    if (userPharmacyId) return userPharmacyId;
    if (userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { pharmacyId: true },
      });
      if (user?.pharmacyId) return user.pharmacyId;
    }
    throw new ForbiddenException(
      'Your account is not linked to a pharmacy. Ask a platform administrator to associate your account with a pharmacy.',
    );
  }

  /**
   * List all inventory items for a pharmacy. Each row joins MedicineEntity +
   * AvailabilitySignal to produce the shape the frontend DataTable expects.
   */
  async getInventory(pharmacyId: string) {
    const signals = await this.prisma.availabilitySignal.findMany({
      where: { pharmacyId },
      include: {
        medicine: {
          select: {
            id: true,
            canonicalName: true,
            genericName: true,
            strength: true,
            dosageForm: true,
          },
        },
      },
      orderBy: { computedAt: 'desc' },
    });

    return signals.map((s) => ({
      id: s.id,
      medicineId: s.medicineId,
      name: s.medicine.canonicalName,
      generic: s.medicine.genericName || '',
      strength: s.medicine.strength || '',
      dosageForm: s.medicine.dosageForm || 'Tablet',
      dosageform: s.medicine.dosageForm || 'Tablet',
      status: CONFIDENCE_TO_STATUS[s.confidence] || 'out-of-stock',
      confidence: s.confidence.toLowerCase(),
      updated: this.timeAgo(s.computedAt),
    }));
  }

  /**
   * Get dynamic dashboard summary and statistics computed directly from PostgreSQL
   * for the given pharmacy.
   */
  async getDashboard(pharmacyId: string) {
    const signals = await this.prisma.availabilitySignal.findMany({
      where: { pharmacyId },
      include: {
        medicine: {
          select: {
            canonicalName: true,
            genericName: true,
          },
        },
      },
      orderBy: { computedAt: 'desc' },
    });

    let available = 0;
    let limited = 0;
    let outOfStock = 0;
    let pending = 0;

    const recentUpdates: Array<{
      id: string;
      name: string;
      status: string;
      when: string;
      by: string;
    }> = [];

    const pendingUpdates: Array<{
      id: string;
      name: string;
      reason: string;
    }> = [];

    const now = Date.now();
    const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

    for (const s of signals) {
      const status = CONFIDENCE_TO_STATUS[s.confidence] || 'out-of-stock';
      if (status === 'available') available++;
      else if (status === 'limited') limited++;
      else outOfStock++;

      const isOld = now - new Date(s.computedAt).getTime() > TWENTY_FOUR_HOURS_MS;
      if (isOld || s.requiresConfirmation || status === 'out-of-stock' || status === 'limited') {
        pending++;
        if (pendingUpdates.length < 5) {
          let reason = 'Signal reconfirmation recommended';
          if (isOld) reason = 'Signal older than 24h — reconfirm availability';
          else if (status === 'out-of-stock') reason = 'Marked out of stock — update if restocked';
          else if (status === 'limited') reason = 'Limited stock — confirm quantity band';

          pendingUpdates.push({
            id: s.id,
            name: s.medicine.canonicalName,
            reason,
          });
        }
      }

      if (recentUpdates.length < 5) {
        recentUpdates.push({
          id: s.id,
          name: s.medicine.canonicalName,
          status,
          when: this.timeAgo(s.computedAt),
          by: 'Staff update',
        });
      }
    }

    const total = signals.length;

    return {
      stats: {
        total,
        available,
        limited,
        outOfStock,
        pending,
      },
      recentUpdates,
      pendingUpdates,
      notifications: [
        {
          id: 'n1',
          type: 'inventory',
          title: 'Inventory signals active',
          message: `${total} medicines currently tracked in PostgreSQL database.`,
          when: 'Just now',
          unread: false,
        },
        {
          id: 'n2',
          type: 'system',
          title: 'Real-time database sync',
          message: 'Dashboard cards are dynamically synchronized with live inventory records.',
          when: 'Just now',
          unread: false,
        },
      ],
    };
  }

  private async getPharmacyName(pharmacyId: string): Promise<string> {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { name: true },
    });
    return pharmacy?.name || 'Pharmacy';
  }

  /**
   * Aggregate live database analytics for the authenticated pharmacy:
   * 1. Inventory Overview (Available, Limited, Out of Stock counts)
   * 2. Availability Trend (daily percentage over last 7 days)
   * 3. Frequently Requested Medicines (ranked by real DB inquiry/saved/search counts)
   * 4. Update Activity (count of daily updates from CSV, manual edits, status changes)
   */
  async getReports(pharmacyId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    sevenDaysAgo.setHours(0, 0, 0, 0);

    const [availabilitySignals, inventorySignals, auditLogs, savedMedsGroup] =
      await Promise.all([
        this.prisma.availabilitySignal.findMany({
          where: { pharmacyId },
          include: {
            medicine: {
              select: {
                id: true,
                canonicalName: true,
              },
            },
          },
        }),
        this.prisma.inventorySignal.findMany({
          where: { pharmacyId, reportedAt: { gte: sevenDaysAgo } },
          select: {
            id: true,
            medicineId: true,
            uploadMethod: true,
            reportedInStock: true,
            reportedAt: true,
          },
        }),
        this.prisma.auditLog.findMany({
          where: {
            createdAt: { gte: sevenDaysAgo },
            OR: [
              { action: { startsWith: 'pharmacy.inventory' } },
              { action: { startsWith: 'inventory.' } },
              { action: { startsWith: 'pharmacy.profile' } },
            ],
          },
          select: { createdAt: true, metadata: true },
        }),
        this.prisma.savedMedicine.groupBy({
          by: ['medicineId'],
          _count: { medicineId: true },
        }),
      ]);

    // 1. Inventory Overview
    let available = 0;
    let limited = 0;
    let outOfStock = 0;

    for (const sig of availabilitySignals) {
      if (sig.confidence === AvailabilityConfidence.HIGH) available++;
      else if (sig.confidence === AvailabilityConfidence.MODERATE) limited++;
      else outOfStock++;
    }

    const statusBreakdown = [
      { label: 'Available', value: available },
      { label: 'Limited', value: limited },
      { label: 'Out of stock', value: outOfStock },
    ];

    // 2. 7-Day Trend & Activity Labels
    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const days: {
      label: string;
      start: Date;
      end: Date;
      inventoryCount: number;
      inStockCount: number;
      updateCount: number;
    }[] = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);

      const start = new Date(d);
      start.setHours(0, 0, 0, 0);

      const end = new Date(d);
      end.setHours(23, 59, 59, 999);

      days.push({
        label: dayLabels[d.getDay()],
        start,
        end,
        inventoryCount: 0,
        inStockCount: 0,
        updateCount: 0,
      });
    }

    // Populate daily update activity & inventory signals for trend
    for (const day of days) {
      // Inventory signals reported on this day
      const dayInvSignals = inventorySignals.filter(
        (s) => s.reportedAt >= day.start && s.reportedAt <= day.end,
      );
      day.updateCount += dayInvSignals.length;

      // Audit log entries on this day
      const dayLogs = auditLogs.filter((l) => {
        if (l.createdAt < day.start || l.createdAt > day.end) return false;
        if (!l.metadata) return true;
        const meta = l.metadata as Record<string, any>;
        return !meta.pharmacyId || meta.pharmacyId === pharmacyId;
      });
      day.updateCount += dayLogs.length;

      // Availability on or before this day
      const cumulativeSignals = inventorySignals.filter((s) => s.reportedAt <= day.end);
      day.inventoryCount = cumulativeSignals.length;
      day.inStockCount = cumulativeSignals.filter((s) => s.reportedInStock).length;
    }

    const hasTrendHistory =
      days.some((d) => d.inventoryCount > 0) || availabilitySignals.length > 0;

    const availabilityTrend = days.map((day) => {
      let pct = 0;
      if (day.inventoryCount > 0) {
        pct = Math.round((day.inStockCount / day.inventoryCount) * 100);
      } else if (availabilitySignals.length > 0) {
        const totalAvail = availabilitySignals.length;
        const availCount = availabilitySignals.filter(
          (s) => s.confidence === AvailabilityConfidence.HIGH,
        ).length;
        pct = Math.round((availCount / totalAvail) * 100);
      }
      return {
        label: day.label,
        value: pct,
      };
    });

    // 3. Frequently Requested Medicines
    const savedMap = new Map<string, number>();
    for (const item of savedMedsGroup) {
      // Saves for medicines not yet in the catalog have no id to attribute
      // demand to; they are counted once a pharmacy brings the medicine in.
      if (!item.medicineId) continue;
      savedMap.set(item.medicineId, item._count.medicineId);
    }

    const requestedMeds = availabilitySignals.map((sig) => {
      const savedCount = savedMap.get(sig.medicineId) || 0;
      return {
        id: sig.medicineId,
        name: sig.medicine.canonicalName,
        requests: savedCount,
      };
    });

    requestedMeds.sort((a, b) => b.requests - a.requests);
    const frequentlyRequested = requestedMeds.slice(0, 5);

    // 4. Update Activity
    const updateActivity = days.map((day) => ({
      label: day.label,
      value: day.updateCount,
    }));

    return {
      statusBreakdown,
      availabilityTrend: hasTrendHistory ? availabilityTrend : [],
      frequentlyRequested,
      updateActivity,
      hasTrendData: hasTrendHistory,
    };
  }

  /**
   * Add a medicine to the pharmacy's inventory.
   * 1. Find or create the MedicineEntity.
   * 2. Create an InventorySignal (raw intake).
   * 3. Upsert an AvailabilitySignal (public-safe derived signal).
   * 4. Audit-log the operation.
   */
  async addInventoryItem(
    pharmacyId: string,
    dto: AddInventoryDto,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    // 1. Find or create the medicine entity
    let medicine = await this.prisma.medicineEntity.findFirst({
      where: {
        canonicalName: { equals: dto.name, mode: 'insensitive' },
        strength: dto.strength || undefined,
      },
    });

    if (!medicine) {
      medicine = await this.prisma.medicineEntity.create({
        data: {
          canonicalName: dto.name,
          genericName: dto.generic || null,
          strength: dto.strength || null,
          dosageForm: dto.dosageForm || dto.dosageform || 'Tablet',
        },
      });
    }

    const status = dto.status || 'available';
    const confidence = STATUS_TO_CONFIDENCE[status] || AvailabilityConfidence.HIGH;
    const reportedInStock = status !== 'out-of-stock';

    // 2. Create the raw inventory signal
    await this.prisma.inventorySignal.create({
      data: {
        pharmacyId,
        medicineId: medicine.id,
        uploadMethod: 'MANUAL',
        reportedInStock,
        quantityOnHand: null,
      },
    });

    // 3. Upsert the public availability signal
    const avail = await this.prisma.availabilitySignal.upsert({
      where: {
        medicineId_pharmacyId: {
          medicineId: medicine.id,
          pharmacyId,
        },
      },
      update: {
        confidence,
        computedAt: new Date(),
      },
      create: {
        medicineId: medicine.id,
        pharmacyId,
        confidence,
      },
    });

    // 3b. Attach any name-only saved medicines to this identity and alert the
    // patients following it. Only meaningful when the medicine is actually
    // stocked — an out-of-stock report is not an availability event.
    if (reportedInStock) {
      await this.savedLink.linkPendingSaves(medicine);
    }

    // 4. Audit log entry
    const pharmacyName = await this.getPharmacyName(pharmacyId);
    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.inventory.create',
      'Medicine Inventory',
      avail.id,
      {
        userId: user?.id,
        userEmail: user?.email,
        userName: user?.fullName || 'Pharmacy Admin',
        userRole: user?.role || 'PHARMACY_ADMIN',
        pharmacyId,
        pharmacyName,
        module: 'Inventory',
        action: 'Create',
        entityType: 'Medicine Inventory',
        entityId: avail.id,
        medicineId: medicine.id,
        medicineName: medicine.canonicalName,
        genericName: medicine.genericName || '',
        strength: medicine.strength || '',
        dosageForm: medicine.dosageForm || 'Tablet',
        newValues: { status, confidence: confidence.toLowerCase() },
        status: 'Success',
      },
      ipAddress,
    );

    return {
      id: avail.id,
      medicineId: medicine.id,
      name: medicine.canonicalName,
      generic: medicine.genericName || '',
      strength: medicine.strength || '',
      dosageForm: medicine.dosageForm || 'Tablet',
      dosageform: medicine.dosageForm || 'Tablet',
      status,
      confidence: confidence.toLowerCase(),
      updated: 'just now',
    };
  }

  /**
   * Update the availability status of an existing inventory item.
   */
  async updateInventoryItem(
    pharmacyId: string,
    signalId: string,
    dto: UpdateInventoryDto,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const signal = await this.prisma.availabilitySignal.findUnique({
      where: { id: signalId },
    });

    if (!signal || signal.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Inventory item not found');
    }

    const oldStatus = CONFIDENCE_TO_STATUS[signal.confidence] || 'out-of-stock';
    const status = dto.status || 'available';
    const confidence = STATUS_TO_CONFIDENCE[status] || AvailabilityConfidence.HIGH;

    const updated = await this.prisma.availabilitySignal.update({
      where: { id: signalId },
      data: { confidence, computedAt: new Date() },
      include: {
        medicine: {
          select: {
            canonicalName: true,
            genericName: true,
            strength: true,
            dosageForm: true,
          },
        },
      },
    });

    // Audit log entry
    const pharmacyName = await this.getPharmacyName(pharmacyId);
    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.inventory.update',
      'Medicine Inventory',
      signalId,
      {
        userId: user?.id,
        userEmail: user?.email,
        userName: user?.fullName || 'Pharmacy Admin',
        userRole: user?.role || 'PHARMACY_ADMIN',
        pharmacyId,
        pharmacyName,
        module: 'Inventory',
        action: 'Update',
        entityType: 'Medicine Inventory',
        entityId: signalId,
        medicineId: updated.medicineId,
        medicineName: updated.medicine.canonicalName,
        genericName: updated.medicine.genericName || '',
        strength: updated.medicine.strength || '',
        dosageForm: updated.medicine.dosageForm || 'Tablet',
        previousValues: { status: oldStatus, confidence: signal.confidence.toLowerCase() },
        newValues: { status, confidence: confidence.toLowerCase() },
        status: 'Success',
      },
      ipAddress,
    );

    return {
      id: updated.id,
      medicineId: updated.medicineId,
      name: updated.medicine.canonicalName,
      generic: updated.medicine.genericName || '',
      strength: updated.medicine.strength || '',
      dosageForm: updated.medicine.dosageForm || 'Tablet',
      status,
      confidence: confidence.toLowerCase(),
      updated: 'just now',
    };
  }

  /**
   * Bulk import medicines from CSV content or parsed row objects into PostgreSQL.
   * Mode: 'merge' (default — keeps existing inventory, updates matching, adds new)
   * Mode: 'replace' (updates/adds, and prunes unlisted inventory for the pharmacy)
   */
  async importCsv(
    pharmacyId: string,
    input: string | any[],
    mode: 'merge' | 'replace' = 'merge',
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    let rawRows: any[] = [];

    if (typeof input === 'string') {
      const lines = input.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) {
        throw new BadRequestException('The CSV file is empty.');
      }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
      if (!headers.includes('name')) {
        throw new BadRequestException('CSV file missing required "name" header column.');
      }
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map((p) => p.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = parts[idx] || '';
        });
        rawRows.push(row);
      }
    } else if (Array.isArray(input)) {
      rawRows = input;
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let totalProcessed = 0;
    const processedSignalIds = new Set<string>();

    for (const row of rawRows) {
      totalProcessed++;
      const name = row.name || row.canonicalName || row.medicineName;
      if (!name) {
        skipped++;
        continue;
      }
      const generic = row.generic || row.genericName || '';
      const strength = row.strength || '';
      const dosageForm = row.dosageform || row.dosageForm || row.form || 'Tablet';
      const statusRaw = (row.status || row.availability || 'available').toLowerCase();
      const confidence = STATUS_TO_CONFIDENCE[statusRaw] || AvailabilityConfidence.HIGH;
      const reportedInStock = statusRaw !== 'out-of-stock';

      try {
        let medicine = await this.prisma.medicineEntity.findFirst({
          where: {
            canonicalName: { equals: name, mode: 'insensitive' },
            strength: strength || undefined,
          },
        });

        if (!medicine) {
          medicine = await this.prisma.medicineEntity.create({
            data: {
              canonicalName: name,
              genericName: generic || null,
              strength: strength || null,
              dosageForm,
            },
          });
        }

        await this.prisma.inventorySignal.create({
          data: {
            pharmacyId,
            medicineId: medicine.id,
            uploadMethod: 'CSV',
            reportedInStock,
          },
        });

        const existingSignal = await this.prisma.availabilitySignal.findUnique({
          where: {
            medicineId_pharmacyId: {
              medicineId: medicine.id,
              pharmacyId,
            },
          },
        });

        if (existingSignal) {
          const updatedSignal = await this.prisma.availabilitySignal.update({
            where: { id: existingSignal.id },
            data: {
              confidence,
              computedAt: new Date(),
            },
          });
          processedSignalIds.add(updatedSignal.id);
          updated++;
        } else {
          const createdSignal = await this.prisma.availabilitySignal.create({
            data: {
              medicineId: medicine.id,
              pharmacyId,
              confidence,
            },
          });
          processedSignalIds.add(createdSignal.id);
          imported++;
        }
      } catch (err: any) {
        skipped++;
      }
    }

    if (mode === 'replace') {
      const allPharmacySignals = await this.prisma.availabilitySignal.findMany({
        where: { pharmacyId },
        select: { id: true },
      });

      const idsToDelete = allPharmacySignals
        .map((s) => s.id)
        .filter((id) => !processedSignalIds.has(id));

      if (idsToDelete.length > 0) {
        await this.prisma.availabilitySignal.deleteMany({
          where: { id: { in: idsToDelete } },
        });
      }
    }

    const pharmacyName = await this.getPharmacyName(pharmacyId);
    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.inventory.import',
      'Medicine Inventory',
      null,
      {
        userId: user?.id,
        userEmail: user?.email,
        userName: user?.fullName || 'Pharmacy Admin',
        userRole: user?.role || 'PHARMACY_ADMIN',
        pharmacyId,
        pharmacyName,
        module: 'Inventory',
        action: 'Import',
        entityType: 'Medicine Inventory',
        imported,
        updated,
        skipped,
        totalProcessed,
        mode,
        status: 'Success',
      },
      ipAddress,
    );

    return {
      imported,
      updated,
      skipped,
      totalProcessed,
      mode,
    };
  }

  /**
   * Remove an inventory item (AvailabilitySignal) from the pharmacy.
   */
  async deleteInventoryItem(
    pharmacyId: string,
    signalId: string,
    user?: AuthenticatedUser,
    ipAddress?: string,
  ) {
    const signal = await this.prisma.availabilitySignal.findUnique({
      where: { id: signalId },
      include: {
        medicine: {
          select: {
            id: true,
            canonicalName: true,
            genericName: true,
            strength: true,
            dosageForm: true,
          },
        },
      },
    });

    if (!signal || signal.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Inventory item not found');
    }

    await this.prisma.availabilitySignal.delete({ where: { id: signalId } });

    const pharmacyName = await this.getPharmacyName(pharmacyId);
    await this.auditWriter.write(
      user?.id ?? null,
      'pharmacy.inventory.delete',
      'Medicine Inventory',
      signalId,
      {
        userId: user?.id,
        userEmail: user?.email,
        userName: user?.fullName || 'Pharmacy Admin',
        userRole: user?.role || 'PHARMACY_ADMIN',
        pharmacyId,
        pharmacyName,
        module: 'Inventory',
        action: 'Delete',
        entityType: 'Medicine Inventory',
        entityId: signalId,
        medicineId: signal.medicineId,
        medicineName: signal.medicine?.canonicalName || 'Unknown',
        genericName: signal.medicine?.genericName || '',
        strength: signal.medicine?.strength || '',
        dosageForm: signal.medicine?.dosageForm || 'Tablet',
        status: 'Success',
      },
      ipAddress,
    );

    return { id: signalId, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private timeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
}
