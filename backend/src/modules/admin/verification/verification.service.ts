import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  SignalNotificationType,
  VerificationRequest,
  VerificationRequestStatus,
  VerificationStatus,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditWriter } from '../audit.writer';
import { buildSubmissionSummary } from './submission-summary';
import { resolveCountryAlpha2 } from '../../../common/countries';
import { resolveJurisdictionId } from '../../../common/jurisdiction';
import { allowsCategory } from '../../pharmacy/notification-preferences.service';
import { canParticipate } from '../../pharmacy/participation';
import { CreateVerificationDto } from './dto/create-verification.dto';
import { UpdateVerificationDto } from './dto/update-verification.dto';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

  /**
   * The licence document attached to a request.
   *
   * Read straight out of the row and handed to the caller — the controller that
   * exposes it is SUPER_ADMIN-only, so there is no public URL, nothing signed to
   * expire, and nothing that outlives the reviewer's session.
   */
  async getDocument(requestId: string) {
    const document = await this.prisma.verificationDocument.findUnique({
      where: { verificationRequestId: requestId },
      select: { filename: true, mimeType: true, data: true },
    });
    if (!document) {
      throw new NotFoundException('No document has been uploaded for this verification request.');
    }
    return document;
  }

  async list() {
    // NOTE: pharmacy records are no longer fabricated for unlinked pharmacy
    // users here. This used to invent a "<Full Name> Pharmacy" at "Main Branch
    // Address, Main City" plus a PENDING request the operator never filed, so a
    // reviewer saw placeholder text as if it were submitted detail, and the
    // pharmacy's own profile page opened pre-filled with that invented address
    // instead of a blank form. Onboarding now runs the other way round: the
    // pharmacy fills in its profile (PATCH /pharmacies/me) and that submission
    // creates the record and the request that lands in this queue.
    await this.prisma.pharmacy.updateMany({
      where: {
        country: 'US',
        OR: [
          { city: { contains: 'Gandimaisamma', mode: 'insensitive' } },
          { city: { contains: 'Hyderabad', mode: 'insensitive' } },
          { region: { contains: 'Telangana', mode: 'insensitive' } },
        ],
      },
      data: { country: 'India' },
    });
    const rows = await this.prisma.verificationRequest.findMany({
      include: VerificationService.REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    const firstTime = await this.firstTimePharmacyIds(rows);
    return rows.map((r) => this.toDto(r, !!r.pharmacyId && firstTime.has(r.pharmacyId)));
  }

  async create(actorId: string, dto: CreateVerificationDto, ipAddress?: string) {
    let pharmacyId = dto.pharmacyId || null;
    if (!pharmacyId && dto.licenseNumber) {
      const match = await this.prisma.pharmacy.findFirst({
        where: { licenseNumber: dto.licenseNumber },
      });
      if (match) pharmacyId = match.id;
    }

    const req = await this.prisma.verificationRequest.create({
      data: {
        pharmacyName: dto.pharmacyName,
        licenseNumber: dto.licenseNumber,
        submittedBy: dto.submittedBy,
        pharmacyId,
        docName: dto.docName || null,
        docUrl: dto.docUrl || null,
      },
    });
    await this.audit.write(
      actorId,
      'admin.verification.create',
      'VerificationRequest',
      req.id,
      { pharmacy: req.pharmacyName },
      ipAddress,
    );
    const firstTime = await this.firstTimePharmacyIds([req]);
    return this.toDto(req, !!req.pharmacyId && firstTime.has(req.pharmacyId));
  }

  async update(
    actorId: string,
    id: string,
    dto: UpdateVerificationDto,
    ipAddress?: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.verificationRequest.findUnique({
        where: { id },
        include: VerificationService.REQUEST_INCLUDE,
      });
      if (!existing) throw new NotFoundException('Verification request not found');

      const actor = actorId ? await tx.user.findUnique({ where: { id: actorId } }) : null;
      const reviewerName = actor ? actor.fullName : 'Super Admin';

      const data: Prisma.VerificationRequestUpdateInput = {
        reviewer: reviewerName,
      };
      if (dto.status !== undefined) data.status = dto.status;
      if (dto.reviewer !== undefined) data.reviewer = dto.reviewer;
      if (dto.note) {
        const stamped = `[${new Date().toISOString()}]: ${dto.note}`;
        data.notes = existing.notes ? `${existing.notes}\n${stamped}` : stamped;
      }

      // Resolve submitting user by email from submittedBy
      const emailMatch = existing.submittedBy.match(/[\w.-]+@[\w.-]+\.\w+/);
      const userEmail = emailMatch ? emailMatch[0].toLowerCase() : existing.submittedBy.toLowerCase();
      const targetUser = await tx.user.findFirst({
        where: { email: { equals: userEmail, mode: 'insensitive' } },
      });

      let pharmacyId = existing.pharmacyId;

      /** Identity fields this decision made authoritative, for the audit trail. */
      let appliedIdentity: {
        name?: { from: string | null; to: string };
        licenseNumber?: { from: string | null; to: string };
      } = {};

      // Does this member still want to hear about verification changes? Asked
      // once, inside the transaction, and before any of the branches below
      // create a notification — a switch that is only honoured on the way out
      // is not honoured at all.
      const wantsVerificationUpdates = targetUser
        ? await allowsCategory(tx, targetUser.id, 'verification')
        : false;

      if (!pharmacyId && targetUser?.pharmacyId) {
        pharmacyId = targetUser.pharmacyId;
      }

      if (!pharmacyId && existing.licenseNumber) {
        const matchedByLic = await tx.pharmacy.findFirst({
          where: { licenseNumber: existing.licenseNumber },
        });
        if (matchedByLic) pharmacyId = matchedByLic.id;
      }

      if (!pharmacyId) {
        const matchedByName = await tx.pharmacy.findFirst({
          where: { name: { equals: existing.pharmacyName, mode: 'insensitive' } },
        });
        if (matchedByName) pharmacyId = matchedByName.id;
      }

      if (!pharmacyId) {
        // No address is invented for it. This row exists only because a
        // verification request arrived without one, and "Primary Location, Main
        // City, India" is not where the pharmacy is — it was shown to patients
        // as the branch's address, and it geocodes (or fails to) somewhere that
        // has nothing to do with the shop. Nulls are the true answer; the
        // operator fills them in from the portal, which geocodes on save.
        const newPharmacy = await tx.pharmacy.create({
          data: {
            name: existing.pharmacyName,
            licenseNumber: existing.licenseNumber || `LIC-${Date.now().toString(36).toUpperCase()}`,
            verificationStatus: VerificationStatus.PENDING,
            isParticipating: false,
            // Nothing has been reported yet, so nothing has been reported
            // promptly. 0.8 was a score this pharmacy never earned, and it
            // feeds the ZoikoAvail confidence band patients are shown.
            reliabilityScore: 0,
          },
        });
        pharmacyId = newPharmacy.id;
      }

      data.pharmacy = { connect: { id: pharmacyId } };

      if (targetUser && targetUser.pharmacyId !== pharmacyId) {
        await tx.user.update({
          where: { id: targetUser.id },
          data: { pharmacyId },
        });
      }

      if (dto.status === VerificationRequestStatus.APPROVED) {
        // Approving the licence and publishing the pharmacy used to be the same
        // write. They answer different questions, and fusing them listed
        // pharmacies that no patient could ever be shown: a request that
        // arrives without a pharmacy row creates one with no address and no
        // coordinates, and this marked it participating. Every distance-bounded
        // search then dropped it, so it was simultaneously part of the verified
        // network and absent from it.
        //
        // The licence is approved either way. Listing waits for a location and
        // starts by itself the moment the operator or a reviewer sets one.
        const approved = await tx.pharmacy.findUnique({
          where: { id: pharmacyId },
          select: { latitude: true, longitude: true, name: true, licenseNumber: true },
        });

        // Approval is where the requested identity becomes the real one.
        //
        // It used to change a status and nothing else, because the pharmacy row
        // had already been overwritten at submission time — so approving decided
        // nothing that had not already happened, and rejecting could not undo
        // it. The request now carries what was asked for and this row carries
        // what was approved; this write is the moment the two meet, inside the
        // same transaction as the status so a half-applied identity cannot
        // exist.
        const requestedName = existing.pharmacyName?.trim();
        const requestedLicense = existing.licenseNumber?.trim();

        await tx.pharmacy.update({
          where: { id: pharmacyId },
          data: {
            ...(requestedName ? { name: requestedName } : {}),
            ...(requestedLicense ? { licenseNumber: requestedLicense } : {}),
            verificationStatus: VerificationStatus.VERIFIED,
            isParticipating: canParticipate({
              verificationStatus: VerificationStatus.VERIFIED,
              latitude: approved?.latitude ?? null,
              longitude: approved?.longitude ?? null,
            }),
            updatedAt: new Date(),
          },
        });

        // What actually changed, recorded before and after, so the trail answers
        // "what did this reviewer approve" without re-deriving it from two rows
        // that have since moved on.
        appliedIdentity = {
          name:
            requestedName && requestedName !== approved?.name
              ? { from: approved?.name ?? null, to: requestedName }
              : undefined,
          licenseNumber:
            requestedLicense && requestedLicense !== (approved?.licenseNumber ?? '')
              ? { from: approved?.licenseNumber ?? null, to: requestedLicense }
              : undefined,
        };

        if (targetUser && wantsVerificationUpdates) {
          await tx.signalNotification.create({
            data: {
              userId: targetUser.id,
              dedupeKey: `verification:${existing.id}:approved:${Date.now()}`,
              type: SignalNotificationType.SAFETY,
              medicineName: 'Pharmacy Account',
              title: 'Pharmacy Verification Approved',
              description: `Your pharmacy onboarding request for "${existing.pharmacyName}" has been approved. You now have full access to inventory management.`,
              actionLabel: 'Go to Pharmacy Portal',
            },
          });
        }
      } else if (dto.status === VerificationRequestStatus.REQUEST_INFO) {
        await tx.pharmacy.update({
          where: { id: pharmacyId },
          data: {
            verificationStatus: VerificationStatus.INFO_REQUESTED,
            isParticipating: false,
            updatedAt: new Date(),
          },
        });

        if (targetUser && wantsVerificationUpdates) {
          await tx.signalNotification.create({
            data: {
              userId: targetUser.id,
              dedupeKey: `verification:${existing.id}:request_info:${Date.now()}`,
              type: SignalNotificationType.SAFETY,
              medicineName: 'Pharmacy Account',
              title: 'Information Requested for Verification',
              description: `Reviewer requested additional information for "${existing.pharmacyName}"${dto.note ? `: ${dto.note}` : '.'}`,
              actionLabel: 'View Pharmacy Profile',
            },
          });
        }
      } else if (dto.status === VerificationRequestStatus.REJECTED) {
        await tx.pharmacy.update({
          where: { id: pharmacyId },
          data: {
            verificationStatus: VerificationStatus.REJECTED,
            isParticipating: false,
            updatedAt: new Date(),
          },
        });

        if (targetUser && wantsVerificationUpdates) {
          await tx.signalNotification.create({
            data: {
              userId: targetUser.id,
              dedupeKey: `verification:${existing.id}:rejected:${Date.now()}`,
              type: SignalNotificationType.SAFETY,
              medicineName: 'Pharmacy Account',
              title: 'Pharmacy Verification Rejected',
              description: `Your verification request for "${existing.pharmacyName}" was rejected.${dto.note ? ` Reason: ${dto.note}` : ' Please contact support.'}`,
              actionLabel: 'View Verification Status',
            },
          });
        }
      } else if (dto.status !== undefined) {
        await tx.pharmacy.update({
          where: { id: pharmacyId },
          data: {
            verificationStatus: VerificationStatus.PENDING,
            isParticipating: false,
            updatedAt: new Date(),
          },
        });
      }

      const req = await tx.verificationRequest.update({
        where: { id },
        data,
        include: VerificationService.REQUEST_INCLUDE,
      });

      return { req, appliedIdentity };
    });

    await this.audit.write(
      actorId,
      `admin.verification.${(dto.status ?? 'update').toLowerCase()}`,
      'VerificationRequest',
      id,
      {
        pharmacy: result.req.pharmacyName,
        status: result.req.status,
        // Old and requested values for whatever this decision made
        // authoritative, so the trail answers what was approved rather than
        // only that something was. Empty on a rejection or an info request,
        // which change no identity by design.
        appliedIdentity: result.appliedIdentity,
      },
      ipAddress,
    );
    const firstTime = await this.firstTimePharmacyIds([result.req]);
    return this.toDto(result.req, !!result.req.pharmacyId && firstTime.has(result.req.pharmacyId));
  }

  /**
   * What every query feeding `toDto` has to fetch.
   *
   * Metadata only — `data` is deliberately absent. The bytes are the reason
   * the document lives in its own table, and pulling them into the queue would
   * put every licence scan on the wire to render a filename. The reviewer
   * fetches the file itself from the protected document endpoint.
   *
   * Shared rather than repeated at four call sites: a query that forgot the
   * include would report "No document" for a request that has one, which is
   * the failure this whole path exists to stop.
   */
  private static readonly REQUEST_INCLUDE = {
    pharmacy: true,
    document: {
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        updatedAt: true,
      },
    },
  } as const;

  private async require(id: string) {
    const req = await this.prisma.verificationRequest.findUnique({
      where: { id },
      include: VerificationService.REQUEST_INCLUDE,
    });
    if (!req) throw new NotFoundException('Verification request not found');
    return req;
  }

  /**
   * Which pharmacies have never had a request approved.
   *
   * Asked once for a whole page of requests rather than per row: the queue
   * renders every request, and a lookup inside the mapper would be one query
   * per card. "First time" is the difference between showing a reviewer a
   * comparison and showing them a submission, so it cannot be guessed from the
   * pharmacy's current status — a resubmission sets that back to PENDING and
   * would make an established pharmacy look new.
   */
  private async firstTimePharmacyIds(rows: Array<{ pharmacyId: string | null }>) {
    const ids = [...new Set(rows.map((r) => r.pharmacyId).filter((id): id is string => !!id))];
    if (!ids.length) return new Set<string>();

    const approved = await this.prisma.verificationRequest.findMany({
      where: { pharmacyId: { in: ids }, status: VerificationRequestStatus.APPROVED },
      select: { pharmacyId: true },
      distinct: ['pharmacyId'],
    });
    const everApproved = new Set(approved.map((a) => a.pharmacyId));
    return new Set(ids.filter((id) => !everApproved.has(id)));
  }

  private toDto(
    r: VerificationRequest & { pharmacy?: any; document?: any },
    isFirstTime = false,
  ) {
    // The approved identity, which is what every other surface shows. It used
    // to be `r.pharmacy?.name || r.pharmacyName` on both — one value doing the
    // work of two, which is why the Verification Center could not tell a
    // reviewer what they were being asked to approve.
    const pharmacyName = r.pharmacy?.name || r.pharmacyName;
    const licenseNumber = r.pharmacy?.licenseNumber || r.licenseNumber;
    // One service turns a request into the reviewer's picture of it, so the
    // console renders an answer instead of reconstructing one. See
    // submission-summary.ts for why it reads two sources.
    const summary = buildSubmissionSummary(r, {
      documentName: r.document?.filename ?? r.docName ?? null,
      isFirstTime,
    });
    const changes = summary.changes;

    return {
      ...summary,
      id: r.id,
      pharmacy: pharmacyName,
      pharmacyId: r.pharmacyId,
      licenseNumber,
      // What the pharmacy is asking for, and how it differs from the above.
      requestedName: r.pharmacyName ?? null,
      requestedLicenseNumber: r.licenseNumber ?? null,
      changes,
      // Generated from the request, kept apart from `notes` so a reviewer can
      // tell the system's explanation from a colleague's. This used to be built
      // from the identity diff alone, so a document-only submission — nothing
      // renamed, nothing relicensed — produced null and the reviewer was shown
      // no reason at all. That was the reported case.
      reason: changes.length
        ? `${summary.requestTypeLabel}. Requires review: ${changes
            .map((c) => c.label.toLowerCase())
            .join(', ')}.`
        : null,
      submittedBy: r.submittedBy,
      date: r.createdAt,
      status: r.status,
      reviewer: r.reviewer,
      // Read off the relation, not off the denormalized columns beside it.
      // docName/docUrl are a copy written at upload time; the row in
      // VerificationDocument is what "View File" actually serves, so a request
      // whose copy drifted would have offered the reviewer a dead link.
      document: r.document
        ? {
            id: r.document.id,
            filename: r.document.filename,
            mimeType: r.document.mimeType,
            sizeBytes: r.document.sizeBytes,
            uploadedAt: r.document.updatedAt,
          }
        : null,
      docName: r.document?.filename ?? r.docName,
      docUrl: r.docUrl,
      notes: r.notes,
      addressLine1: r.pharmacy?.addressLine1 || '',
      city: r.pharmacy?.city || '',
      region: r.pharmacy?.region || '',
      postalCode: r.pharmacy?.postalCode || '',
      country: r.pharmacy?.country || '',
    };
  }
}


