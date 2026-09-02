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
      include: { pharmacy: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
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
    return this.toDto(req);
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
        include: { pharmacy: true },
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
          select: { latitude: true, longitude: true },
        });
        await tx.pharmacy.update({
          where: { id: pharmacyId },
          data: {
            verificationStatus: VerificationStatus.VERIFIED,
            isParticipating: canParticipate({
              verificationStatus: VerificationStatus.VERIFIED,
              latitude: approved?.latitude ?? null,
              longitude: approved?.longitude ?? null,
            }),
            updatedAt: new Date(),
          },
        });

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
        include: { pharmacy: true },
      });

      return req;
    });

    await this.audit.write(
      actorId,
      `admin.verification.${(dto.status ?? 'update').toLowerCase()}`,
      'VerificationRequest',
      id,
      { pharmacy: result.pharmacyName, status: result.status },
      ipAddress,
    );
    return this.toDto(result);
  }

  private async require(id: string) {
    const req = await this.prisma.verificationRequest.findUnique({
      where: { id },
      include: { pharmacy: true },
    });
    if (!req) throw new NotFoundException('Verification request not found');
    return req;
  }

  private toDto(r: VerificationRequest & { pharmacy?: any }) {
    const pharmacyName = r.pharmacy?.name || r.pharmacyName;
    const licenseNumber = r.pharmacy?.licenseNumber || r.licenseNumber;
    return {
      id: r.id,
      pharmacy: pharmacyName,
      pharmacyId: r.pharmacyId,
      licenseNumber,
      submittedBy: r.submittedBy,
      date: r.createdAt,
      status: r.status,
      reviewer: r.reviewer,
      docName: r.docName,
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


