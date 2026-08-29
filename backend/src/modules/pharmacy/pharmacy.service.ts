import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AvailabilityConfidence,
  CommercialClassification,
  QualityState,
  SignalNotificationType,
  UserRole,
  VerificationRequestStatus,
  VerificationStatus,
} from '@prisma/client';
import { resolveCountryAlpha2 } from '../../common/countries';
import { resolveJurisdictionId } from '../../common/jurisdiction';
import { normalizePhone } from '../../common/phone';
import { logoUrlFor } from './logo/pharmacy-logo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditWriter } from '../admin/audit.writer';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { AddInventoryDto } from './dto/add-inventory.dto';
import { UpdateInventoryDto } from './dto/update-inventory.dto';
import { UpdatePharmacyProfileDto } from './dto/update-profile.dto';
import { SavedMedicineLinkService } from '../saved-link/saved-medicine-link.service';
import { assertLocationIsFree } from './location-identity';
import { resolveMapLink } from './map-link';
import {
  PHARMACY_INVENTORY_KEY_PREFIX,
  PHARMACY_UPLOAD_KEY_PREFIX,
  PharmacyNotificationService,
} from './notifications/pharmacy-notification.service';

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
 * Which section of the portal's notification list a row belongs in.
 *
 * The category was previously hard-coded to 'verification' for every row, which is
 * why the Inventory, Uploads and System filters could never match anything and
 * read as broken (MP-24).
 *
 * There is no stored category to read: SignalNotificationType describes patient
 * availability signals, and the verification workflow reuses SAFETY for its own
 * decisions. The dedupe key is the honest discriminator - it is set by whichever
 * workflow raised the row, and it is what distinguishes a verification decision
 * from a genuine safety alert that happens to share a type.
 *
 * The two pharmacy-written prefixes are imported rather than repeated: they are
 * a contract with PharmacyNotificationService, and a prefix that drifts on one
 * side of it is an empty filter tab with nothing to show it is broken.
 */
function notificationCategory(row: {
  dedupeKey: string;
  type: SignalNotificationType;
}): 'inventory' | 'verification' | 'upload' | 'system' {
  if (row.dedupeKey.startsWith('verification:')) return 'verification';
  if (row.dedupeKey.startsWith(PHARMACY_UPLOAD_KEY_PREFIX)) return 'upload';
  if (row.dedupeKey.startsWith(PHARMACY_INVENTORY_KEY_PREFIX)) return 'inventory';

  switch (row.type) {
    // Availability signals about a medicine: stock, in this portal's language.
    case SignalNotificationType.RUNNING_LOW:
    case SignalNotificationType.BACK_IN_STOCK:
    case SignalNotificationType.LIMITED:
    case SignalNotificationType.NEARBY_RESTOCK:
      return 'inventory';
    // Recalls and advisories are platform-wide messages, not this pharmacy's
    // stock, so they belong with the other platform messages.
    case SignalNotificationType.RECALL:
    case SignalNotificationType.SAFETY:
    default:
      return 'system';
  }
}

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
/**
 * A pharmacy's own contact number in E.164, or a refusal.
 *
 * Patient search offers one action on every pharmacy card — call before you
 * travel — and it can only be the number of that exact branch. A pharmacy with
 * no number reaches patients as a card they cannot act on, so the number is
 * required rather than optional, and it is never defaulted or borrowed from
 * anywhere.
 *
 * Local and international form are both accepted: the number is read against the
 * pharmacy's own country and stored in one form. A number that is not valid for
 * that country is refused rather than saved, because a number nobody can ring
 * still looks like a way to reach the pharmacy.
 */
function normalizePhoneInput(
  phone: string | null | undefined,
  country: string | null | undefined,
): string {
  const typed = phone?.trim();
  if (!typed) {
    throw new BadRequestException(
      "Enter the pharmacy's contact number, including its country or area code — " +
        'patients are shown this number to confirm availability before visiting.',
    );
  }

  const normalized = normalizePhone(typed, country);
  if (!normalized) {
    throw new BadRequestException(
      country
        ? `"${typed}" is not a valid phone number for ${country}. Include the area code, or write it ` +
          'in international form such as +91 40 2345 6789.'
        : `"${typed}" is not a valid phone number. Write it in international form, such as ` +
          '+91 40 2345 6789, or set your country first so a local number can be understood.',
    );
  }
  return normalized;
}

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
    private readonly portalNotifications: PharmacyNotificationService,
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

  /**
   * Coordinates behind a Google Maps share link.
   *
   * Read-only: it never touches the pharmacy record. The portal shows the pair
   * for confirmation first, and saving it goes through the normal profile
   * update, so a mis-pasted link cannot silently move a pharmacy.
   */
  async resolveMapLink(url: string) {
    return resolveMapLink(url);
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
      // Null until the operator sets a location; the portal renders the
      // "not set yet" state from exactly that.
      latitude: pharmacy.latitude,
      longitude: pharmacy.longitude,
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
      latitude: null,
      longitude: null,
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

    // Resolved once, before the write: the phone number is interpreted in this
    // country, so a national-format number and the country it belongs to have to
    // be settled together.
    const submittedCountry = normalizeCountryInput(dto.country);

    // Patients are given this number to confirm before travelling, so a new
    // pharmacy cannot be registered without one.
    const phone = normalizePhoneInput(dto.phone, submittedCountry);

    // One physical pharmacy, one record. Checked before the insert, so the
    // second registration of a shop is refused rather than created and merged
    // later — by then both halves hold their own availability signals and there
    // is no way to tell a patient which card is the real one.
    if (dto.latitude != null && dto.longitude != null) {
      await assertLocationIsFree(this.prisma, {
        latitude: dto.latitude,
        longitude: dto.longitude,
      });
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const jurisdictionId = await resolveJurisdictionId(tx, submittedCountry);
      const pharmacy = await tx.pharmacy.create({
        data: {
          name,
          licenseNumber,
          phone,
          addressLine1: dto.addressLine1?.trim() || null,
          addressLine2: dto.addressLine2?.trim() || null,
          city: dto.city?.trim() || null,
          region: dto.region?.trim() || null,
          country: submittedCountry,
          jurisdictionId,
          postalCode: dto.postalCode?.trim() || null,
          // Without these the pharmacy is invisible to the distance-bounded
          // patient search, however complete the rest of the profile is.
          latitude: dto.latitude ?? null,
          longitude: dto.longitude ?? null,
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

    const name = dto.name !== undefined ? dto.name.trim() : undefined;
    const licenseNumber = dto.licenseNumber !== undefined ? dto.licenseNumber.trim() : undefined;

    if (dto.name !== undefined && !name) {
      throw new BadRequestException('Pharmacy name cannot be empty.');
    }
    if (dto.licenseNumber !== undefined && !licenseNumber) {
      throw new BadRequestException('Licence number cannot be empty.');
    }

    // The country this edit leaves the record in, which is the one a national-format
    // phone number is read against. Taking it from `existing` alone would reject a
    // valid number whenever the country is being corrected in the same save.
    const country =
      dto.country !== undefined ? normalizeCountryInput(dto.country) : existing.country;

    // Re-resolved only when the country itself is part of this edit — an edit
    // to, say, the address alone must not spend a write re-deriving a value
    // nothing about this save is changing.
    const jurisdictionId =
      dto.country !== undefined
        ? await resolveJurisdictionId(this.prisma, country)
        : existing.jurisdictionId;

    // The contact number is what a patient acts on, so it cannot be cleared, and a
    // record that never had one has to supply it on the next save. A save that does
    // not touch the field on a pharmacy that already has a number is unaffected: a
    // number stored before this validation existed must not block an edit to the
    // address, and it is normalized the moment the operator next touches the field.
    let phone = existing.phone;
    if (dto.phone !== undefined) {
      phone = normalizePhoneInput(dto.phone, country);
    } else if (!existing.phone?.trim()) {
      throw new BadRequestException(
        "Add the pharmacy's contact number before saving — patients are shown this " +
          'number to confirm availability before visiting.',
      );
    }

    // A profile edit can move the pin. Moving it onto another pharmacy's
    // premises creates the same duplicate a second registration would; itself
    // excluded, so re-saving an unchanged location is never blocked.
    const movingPin =
      (dto.latitude !== undefined && dto.latitude !== existing.latitude) ||
      (dto.longitude !== undefined && dto.longitude !== existing.longitude);
    const nextLat = dto.latitude !== undefined ? dto.latitude : existing.latitude;
    const nextLng = dto.longitude !== undefined ? dto.longitude : existing.longitude;
    if (movingPin && nextLat != null && nextLng != null) {
      await assertLocationIsFree(this.prisma, {
        latitude: nextLat,
        longitude: nextLng,
        excludeId: pharmacyId,
      });
    }

    const updated = await this.prisma.pharmacy.update({
      where: { id: pharmacyId },
      data: {
        name: name !== undefined ? name : existing.name,
        licenseNumber: licenseNumber !== undefined ? licenseNumber : existing.licenseNumber,
        phone,
        addressLine1:
          dto.addressLine1 !== undefined ? dto.addressLine1.trim() || null : existing.addressLine1,
        addressLine2:
          dto.addressLine2 !== undefined ? dto.addressLine2.trim() || null : existing.addressLine2,
        city: dto.city !== undefined ? dto.city.trim() || null : existing.city,
        region: dto.region !== undefined ? dto.region.trim() || null : existing.region,
        country,
        jurisdictionId,
        postalCode:
          dto.postalCode !== undefined ? dto.postalCode.trim() || null : existing.postalCode,
        latitude: dto.latitude !== undefined ? dto.latitude : existing.latitude,
        longitude: dto.longitude !== undefined ? dto.longitude : existing.longitude,
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
      where: { userId, dismissed: false, archived: false },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return list.map((n) => ({
      id: n.id,
      type: notificationCategory(n),
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
   *
   * Scoped to this pharmacyId and to nothing else: every AvailabilitySignal the
   * pharmacy holds is returned whatever its confidence band, so a medicine
   * patients can see a High / Moderate / Low signal for is always listed and
   * editable here. These are the same rows the public surfaces read — the
   * portal is the writer, patient search the reader, one table.
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
            // Patient search matches brand names too (MediBase holds them on
            // the identity). Without them here, a pharmacy searching its own
            // availability page for the brand a patient searched — "Lantus" for
            // the "Insulin Glargine" identity — was told no medicine matched.
            brandNames: true,
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
      brands: s.medicine.brandNames ?? [],
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
   * The reporting pharmacy's jurisdiction, for stamping onto a MediBase
   * identity created from what it typed (MSA-35). Without this, every
   * pharmacy-sourced identity carries `jurisdictionId: null` forever — the
   * catalog has no other moment at which a jurisdiction is ever attached to
   * one, so the MediBase dashboard's market counts stay at zero regardless of
   * how large the catalog grows.
   */
  private async getPharmacyJurisdictionId(pharmacyId: string): Promise<string | null> {
    const pharmacy = await this.prisma.pharmacy.findUnique({
      where: { id: pharmacyId },
      select: { jurisdictionId: true },
    });
    return pharmacy?.jurisdictionId ?? null;
  }

  /**
   * Aggregate live database analytics for the authenticated pharmacy:
   * 1. Inventory Overview (Available, Limited, Out of Stock counts)
   * 2. Availability Trend (daily percentage over last 7 days)
   * 3. Frequently Requested Medicines (ranked by real DB inquiry/saved/search counts)
   * 4. Update Activity (count of daily updates from CSV, manual edits, status changes)
   */
  /**
   * Participation metrics for the portal's Participation page (MP-44).
   *
   * Every figure here is measured from this pharmacy's own rows. The page used to
   * render a hard-coded fixture - 92% reliability, 87% participation, 34 updates a
   * week - identical for every pharmacy, which is worse than an empty page: it
   * reads as the operator's own record.
   *
   * Two of the old fixture's numbers are deliberately not reproduced. A
   * "participation score" and a "data quality" percentage are composites, and
   * inventing a formula would put an authoritative-looking score on the screen that
   * no specification defines. What is returned instead is what can be counted:
   * how much of the catalogue is current, how complete its details are, and how
   * often it is updated. Each is explainable from the counts returned beside it.
   */
  async getParticipation(pharmacyId: string) {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [pharmacy, signals, updatesLast7Days] = await Promise.all([
      this.prisma.pharmacy.findUnique({
        where: { id: pharmacyId },
        select: { reliabilityScore: true, verificationStatus: true, isParticipating: true },
      }),
      this.prisma.availabilitySignal.findMany({
        where: { pharmacyId },
        select: {
          computedAt: true,
          confidence: true,
          medicine: {
            select: { genericName: true, strength: true, dosageForm: true },
          },
        },
      }),
      this.prisma.inventorySignal.count({
        where: { pharmacyId, reportedAt: { gte: sevenDaysAgo } },
      }),
    ]);
    if (!pharmacy) throw new NotFoundException('Pharmacy not found');

    const medicinesListed = signals.length;

    // Average age of the availability information patients are being shown. Null
    // rather than zero when nothing is listed: "0 hours old" would read as
    // perfectly fresh when in fact there is nothing there.
    const freshnessHours =
      medicinesListed === 0
        ? null
        : Math.round(
            (signals.reduce((total, s) => total + (now.getTime() - s.computedAt.getTime()), 0) /
              medicinesListed /
              3_600_000) *
              10,
          ) / 10;

    const currentCount = signals.filter((s) => s.computedAt >= sevenDaysAgo).length;
    const completeCount = signals.filter(
      (s) =>
        !!s.medicine.genericName?.trim() &&
        !!s.medicine.strength?.trim() &&
        !!s.medicine.dosageForm?.trim(),
    ).length;

    const percent = (part: number) =>
      medicinesListed === 0 ? null : Math.round((part / medicinesListed) * 100);

    return {
      // Stored, and the one governed score here: it drives ZoikoAvail confidence.
      reliabilityScore: Math.round(pharmacy.reliabilityScore * 100),
      verificationStatus: pharmacy.verificationStatus,
      isParticipating: pharmacy.isParticipating,

      medicinesListed,
      updatesLast7Days,
      freshnessHours,

      /** Share of listed medicines updated in the last seven days. */
      upToDatePercent: percent(currentCount),
      upToDateCount: currentCount,

      /** Share whose MediBase entry has a generic name, strength and dosage form. */
      detailsCompletePercent: percent(completeCount),
      detailsCompleteCount: completeCount,
    };
  }

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

    // True only when some day in the window actually has reports behind it. It
    // previously counted the existence of any availability signal at all, so it
    // claimed trend data for a pharmacy that had reported nothing all week.
    const hasTrendHistory = days.some((d) => d.inventoryCount > 0);

    // A day with no reports has no availability percentage, and is reported as
    // such. Today's snapshot used to be substituted for every empty day, which
    // drew a flat line across the week - 79% seven times over - that looked like
    // a fortnight of stable history rather than an absence of data (MP-44).
    const availabilityTrend = days.map((day) => ({
      label: day.label,
      value:
        day.inventoryCount > 0
          ? Math.round((day.inStockCount / day.inventoryCount) * 100)
          : null,
    }));

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
    // Absent when an explicit identity id is sent, and that is correct: nothing
    // is created on that path, so there is no catalog entry a blank field could
    // end up in. Required by the DTO on the name path, where it is.
    const name = (dto.name ?? '').trim();
    const generic = (dto.generic ?? '').trim();
    const strength = (dto.strength ?? '').trim();
    const dosageForm = (dto.dosageForm ?? dto.dosageform ?? '').trim();

    // 1. Resolve the MediBase identity this row is about.
    //
    // An explicit id is authoritative: the identity is taken as given, with no
    // name matching and nothing created, so the pharmacy's signal lands on
    // exactly the identity patients search.
    //
    // A name — what the portal form sends — is matched on name and strength
    // together. The strength used to be passed as `dto.strength || undefined`,
    // which in Prisma means "do not filter on this", so a request without one
    // matched whichever strength happened to be stored first: a pharmacy
    // stocking 500 mg was recorded against the 650 mg identity a patient was
    // searching for.
    let medicine = dto.medicineId
      ? await this.prisma.medicineEntity.findUnique({ where: { id: dto.medicineId } })
      : await this.prisma.medicineEntity.findFirst({
          where: {
            canonicalName: { equals: name, mode: 'insensitive' },
            strength: { equals: strength, mode: 'insensitive' },
          },
        });

    if (dto.medicineId && !medicine) {
      throw new NotFoundException(
        'That medicine is not in the MediBase catalog. Send the medicine name instead, or ask MediBase support to add the identity.',
      );
    }

    if (!medicine) {
      // This is a MediBase identity, created from what a pharmacy typed. It is
      // why the fields above are required rather than optional: whatever is
      // missing here is missing from the catalog every patient searches.
      medicine = await this.prisma.medicineEntity.create({
        data: {
          canonicalName: name,
          genericName: generic,
          strength,
          dosageForm,
          jurisdictionId: await this.getPharmacyJurisdictionId(pharmacyId),
        },
      });
    }

    const status = dto.status || 'available';
    const confidence = STATUS_TO_CONFIDENCE[status] || AvailabilityConfidence.HIGH;
    const reportedInStock = status !== 'out-of-stock';

    // The availability this pharmacy was publishing for this medicine before
    // now, if any. Read here because the upsert below is the point it stops
    // existing, and the portal notification is about the transition rather than
    // about the save.
    const priorSignal = await this.prisma.availabilitySignal.findUnique({
      where: { medicineId_pharmacyId: { medicineId: medicine.id, pharmacyId } },
      select: { confidence: true },
    });
    const priorStatus = priorSignal
      ? CONFIDENCE_TO_STATUS[priorSignal.confidence] || 'out-of-stock'
      : null;

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

    // 3c. Tell this pharmacy's own portal what changed, on the Inventory tab.
    await this.notifyAvailabilityTransition(
      pharmacyId,
      medicine,
      priorStatus,
      status,
      Date.now(),
    );

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
        dosageForm: medicine.dosageForm || '',
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
      brands: medicine.brandNames ?? [],
      strength: medicine.strength || '',
      dosageForm: medicine.dosageForm || 'Tablet',
      dosageform: medicine.dosageForm || 'Tablet',
      status,
      confidence: confidence.toLowerCase(),
      updated: 'just now',
    };
  }

  /**
   * Tell the pharmacy's own portal that a medicine's patient-facing
   * availability changed — when it actually changed.
   *
   * `previousStatus` is null for a medicine this pharmacy was publishing
   * nothing for, which counts as a transition into whatever it now is. The same
   * status in and out is not an event and raises nothing: re-saving a row must
   * not manufacture news, or the Inventory tab fills with rows that say only
   * that somebody pressed Save.
   *
   * Never rethrows — a failed notification must not undo the inventory write it
   * is describing.
   */
  private async notifyAvailabilityTransition(
    pharmacyId: string,
    medicine: { id: string; canonicalName: string; strength?: string | null },
    previousStatus: string | null,
    status: string,
    occurredAtMs: number,
  ): Promise<void> {
    if (previousStatus === status) return;

    if (status === 'available') {
      await this.portalNotifications.inventoryBecameAvailable(
        pharmacyId,
        medicine,
        occurredAtMs,
      );
      return;
    }

    // A row that arrives already out of stock takes nothing away from patients,
    // so only the loss of availability the pharmacy actually had is reported.
    if (previousStatus === null) return;

    await this.portalNotifications.inventoryBecameUnavailable(
      pharmacyId,
      medicine,
      status,
      occurredAtMs,
    );
  }

  /**
   * Find the MediBase identity an inventory row should point at.
   *
   * Name + strength are what identify a medicine, and the matcher is the same
   * one addInventoryItem uses so both entry points land on the same row. A
   * blank strength deliberately matches any strength, as it does on add.
   */
  private findMedicineIdentity(name: string, strength?: string | null) {
    return this.prisma.medicineEntity.findFirst({
      where: {
        canonicalName: { equals: name, mode: 'insensitive' },
        strength: strength || undefined,
      },
    });
  }

  /**
   * May this pharmacy rewrite an identity's descriptive fields in place?
   *
   * MedicineEntity is the shared MediBase catalog, not per-pharmacy stock. An
   * in-place edit therefore reaches every other pharmacy holding that medicine
   * and every patient searching for it. Allowed only when the pharmacy is the
   * sole stockist AND the identity is still ungoverned (NEEDS_REVIEW — what
   * addInventoryItem creates); a curated entry belongs to MediBase admin.
   */
  private async mayEditIdentity(
    medicine: { id: string; qualityState: QualityState },
    pharmacyId: string,
  ) {
    if (medicine.qualityState !== QualityState.NEEDS_REVIEW) return false;
    const otherStockist = await this.prisma.availabilitySignal.findFirst({
      where: { medicineId: medicine.id, pharmacyId: { not: pharmacyId } },
      select: { id: true },
    });
    return !otherStockist;
  }

  /**
   * Edit an inventory item: its availability status, the medicine it points at,
   * or both.
   *
   * Name and strength are resolved to a MediBase identity rather than written
   * over the current one — changing "Asthalin 100 mcg" to 200 mcg re-points
   * this pharmacy's row at the 200 mcg identity (creating it if the catalog
   * has never seen it) and leaves the 100 mcg identity intact for whoever else
   * stocks it. Generic name and dosage form describe the identity itself, so
   * they are only written when this pharmacy is its sole, ungoverned owner.
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
      include: { medicine: true },
    });

    if (!signal || signal.pharmacyId !== pharmacyId) {
      throw new NotFoundException('Inventory item not found');
    }

    const oldStatus = CONFIDENCE_TO_STATUS[signal.confidence] || 'out-of-stock';
    // Keep the current status when the caller only edits identity fields.
    // Defaulting to 'available' here would silently restock an out-of-stock
    // medicine because someone corrected a spelling.
    const status = dto.status || oldStatus;
    const confidence = STATUS_TO_CONFIDENCE[status] || AvailabilityConfidence.HIGH;
    const reportedInStock = status !== 'out-of-stock';

    const current = signal.medicine;
    const editsIdentity =
      dto.name !== undefined ||
      dto.generic !== undefined ||
      dto.strength !== undefined ||
      dto.dosageForm !== undefined ||
      dto.dosageform !== undefined;

    let medicineId = signal.medicineId;
    let linkTarget: { id: string; canonicalName: string; strength?: string | null } | null = null;

    // An explicit MediBase identity id wins over name resolution: it says which
    // identity this row is about with no room for a near-miss, which is what a
    // CSV/API integration should send. Nothing is created and no descriptive
    // field of the shared identity is touched.
    if (dto.medicineId !== undefined && dto.medicineId !== signal.medicineId) {
      const target = await this.prisma.medicineEntity.findUnique({
        where: { id: dto.medicineId },
      });
      if (!target) {
        throw new NotFoundException(
          'That medicine is not in the MediBase catalog. Send the medicine name instead, or ask MediBase support to add the identity.',
        );
      }
      // One row per (medicine, pharmacy) — the unique constraint the name path
      // guards the same way below.
      const clash = await this.prisma.availabilitySignal.findUnique({
        where: { medicineId_pharmacyId: { medicineId: target.id, pharmacyId } },
        select: { id: true },
      });
      if (clash) {
        throw new ConflictException(
          `${target.canonicalName}${target.strength ? ` ${target.strength}` : ''} is already in your inventory. Edit that entry instead.`,
        );
      }
      medicineId = target.id;
      linkTarget = target;
    } else if (editsIdentity) {
      // Unsent fields keep their current value — this is a patch, not a replace.
      const name = (dto.name ?? current.canonicalName).trim();
      if (!name) throw new BadRequestException('Medicine name is required');
      const strength = (dto.strength ?? current.strength ?? '').trim();
      const generic = (dto.generic ?? current.genericName ?? '').trim();
      const dosageForm = (
        dto.dosageForm ??
        dto.dosageform ??
        current.dosageForm ??
        'Tablet'
      ).trim();

      const target = await this.findMedicineIdentity(name, strength);

      if (!target) {
        // The catalog has no such medicine yet. Creating it here mirrors
        // addInventoryItem, which is also how a pharmacy introduces one.
        const created = await this.prisma.medicineEntity.create({
          data: {
            canonicalName: name,
            genericName: generic || null,
            strength: strength || null,
            dosageForm,
            jurisdictionId: await this.getPharmacyJurisdictionId(pharmacyId),
          },
        });
        medicineId = created.id;
        linkTarget = created;
      } else {
        medicineId = target.id;
        linkTarget = target;

        const descriptionChanged =
          (target.genericName ?? '') !== generic ||
          (target.dosageForm ?? '') !== dosageForm;

        if (descriptionChanged) {
          if (await this.mayEditIdentity(target, pharmacyId)) {
            const fixed = await this.prisma.medicineEntity.update({
              where: { id: target.id },
              data: { genericName: generic || null, dosageForm },
            });
            linkTarget = fixed;
          } else {
            // Refuse rather than save half the form: the pharmacist must know
            // the generic/dosage form they typed was not applied.
            throw new ConflictException(
              `${target.canonicalName}${target.strength ? ` ${target.strength}` : ''} is a shared MediBase identity — other pharmacies stock it, so its generic name and dosage form are governed centrally and cannot be changed here. Adjust the medicine name or strength to point your inventory at a different medicine.`,
            );
          }
        }
      }

      if (medicineId !== signal.medicineId) {
        // One row per (medicine, pharmacy) — re-pointing onto a medicine this
        // pharmacy already lists would collide on that unique constraint.
        const clash = await this.prisma.availabilitySignal.findUnique({
          where: { medicineId_pharmacyId: { medicineId, pharmacyId } },
          select: { id: true },
        });
        if (clash) {
          throw new ConflictException(
            `${name}${strength ? ` ${strength}` : ''} is already in your inventory. Edit that entry instead.`,
          );
        }
      }
    }

    const updated = await this.prisma.availabilitySignal.update({
      where: { id: signalId },
      data: { medicineId, confidence, computedAt: new Date() },
      include: {
        medicine: {
          select: {
            canonicalName: true,
            genericName: true,
            brandNames: true,
            strength: true,
            dosageForm: true,
          },
        },
      },
    });

    // An edit can introduce a medicine the catalog never held, which is exactly
    // the moment patients following that name off-catalog should be linked and
    // told — the same hook addInventoryItem uses.
    if (linkTarget && medicineId !== signal.medicineId && reportedInStock) {
      await this.savedLink.linkPendingSaves(linkTarget);
    } else if (reportedInStock && oldStatus === 'out-of-stock') {
      // Restocking a row the pharmacy already held is the other way a saved
      // medicine becomes available, and it used to raise nothing: the link hook
      // only fired when the edit re-pointed the row at a different identity, so
      // a patient waiting on this exact medicine heard nothing when the only
      // pharmacy stocking it flipped it back to available.
      await this.savedLink.linkPendingSaves({
        id: updated.medicineId,
        canonicalName: updated.medicine.canonicalName,
      });
    }

    // Tell this pharmacy's own portal what changed, on the Inventory tab.
    await this.notifyAvailabilityTransition(
      pharmacyId,
      {
        id: updated.medicineId,
        canonicalName: updated.medicine.canonicalName,
        strength: updated.medicine.strength,
      },
      // Re-pointing the row at a different identity means this pharmacy was
      // publishing no availability at all for the medicine it now holds, so the
      // old row's status is not this medicine's previous state.
      medicineId === signal.medicineId ? oldStatus : null,
      status,
      Date.now(),
    );

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
        previousValues: {
          status: oldStatus,
          confidence: signal.confidence.toLowerCase(),
          // Identity is auditable too — re-pointing a row changes what the
          // pharmacy is telling patients it stocks.
          medicineId: signal.medicineId,
          medicineName: current.canonicalName,
          genericName: current.genericName || '',
          strength: current.strength || '',
          dosageForm: current.dosageForm || 'Tablet',
        },
        newValues: {
          status,
          confidence: confidence.toLowerCase(),
          medicineId: updated.medicineId,
          medicineName: updated.medicine.canonicalName,
          genericName: updated.medicine.genericName || '',
          strength: updated.medicine.strength || '',
          dosageForm: updated.medicine.dosageForm || 'Tablet',
        },
        status: 'Success',
      },
      ipAddress,
    );

    return {
      id: updated.id,
      medicineId: updated.medicineId,
      name: updated.medicine.canonicalName,
      generic: updated.medicine.genericName || '',
      brands: updated.medicine.brandNames ?? [],
      strength: updated.medicine.strength || '',
      dosageForm: updated.medicine.dosageForm || 'Tablet',
      // Alias kept in step with getInventory/addInventoryItem so the table and
      // the edit dialog read the same shape whichever call produced the row.
      dosageform: updated.medicine.dosageForm || 'Tablet',
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
      // A file keyed on MediBase identity ids needs no name column: the id says
      // which medicine each row is about more precisely than a name can.
      if (!headers.includes('name') && !headers.includes('medicineid')) {
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

    // Looked up once, not per row: pharmacyId is constant for the whole file,
    // and a several-hundred-row CSV should not cost a query per row for a
    // value that never changes within the call.
    const jurisdictionId = await this.getPharmacyJurisdictionId(pharmacyId);

    /**
     * Identities this file reported as in stock, deduplicated.
     *
     * Collected during the loop and fanned out to patients afterwards rather
     * than inside it: a file may list the same medicine twice, and
     * linkPendingSaves is a query per call. Keyed by identity id so a 400-row
     * import costs one lookup per distinct medicine, not one per row.
     */
    const stockedIdentities = new Map<string, { id: string; canonicalName: string }>();

    for (const row of rawRows) {
      totalProcessed++;
      const name = row.name || row.canonicalName || row.medicineName;
      // A MediBase identity id in the file is authoritative — the row attaches
      // to that identity with no name matching. Integrations that hold ids
      // should send them; a file with names only behaves exactly as before.
      const medicineIdColumn = (row.medicineid || row.medicineId || '').trim?.() || '';
      if (!name && !medicineIdColumn) {
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
        let medicine = medicineIdColumn
          ? await this.prisma.medicineEntity.findUnique({ where: { id: medicineIdColumn } })
          : await this.prisma.medicineEntity.findFirst({
              where: {
                canonicalName: { equals: name, mode: 'insensitive' },
                strength: strength || undefined,
              },
            });

        // An id column that names no identity is a data error in the file, not
        // an invitation to mint a new identity under a borrowed id.
        if (medicineIdColumn && !medicine) {
          skipped++;
          continue;
        }

        if (!medicine) {
          medicine = await this.prisma.medicineEntity.create({
            data: {
              canonicalName: name,
              genericName: generic || null,
              strength: strength || null,
              dosageForm,
              jurisdictionId,
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

        // An out-of-stock line is a record, not an availability event, so only
        // stocked rows are followed up on — the same rule addInventoryItem
        // applies on the single-item path.
        if (reportedInStock) {
          stockedIdentities.set(medicine.id, {
            id: medicine.id,
            canonicalName: medicine.canonicalName,
          });
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

    // Attach name-only saved medicines to the identities this file stocked and
    // alert the patients waiting on them. A bulk import used to skip this
    // entirely, so the same medicine that raised an alert when typed into the
    // form raised none when it arrived in a CSV — a pharmacy's upload method is
    // not something a patient should be able to feel.
    for (const identity of stockedIdentities.values()) {
      await this.savedLink.linkPendingSaves(identity);
    }

    // Report the outcome on the portal's Uploads tab. Raised for every import,
    // including one that applied nothing: a file that failed silently is the
    // case the pharmacy most needs told about.
    await this.portalNotifications.bulkUploadCompleted(
      pharmacyId,
      { imported, updated, skipped, totalProcessed, mode },
      Date.now(),
    );

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
