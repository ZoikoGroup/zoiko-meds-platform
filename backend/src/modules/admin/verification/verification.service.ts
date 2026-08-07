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
import { CreateVerificationDto } from './dto/create-verification.dto';
import { UpdateVerificationDto } from './dto/update-verification.dto';

@Injectable()
export class VerificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditWriter,
  ) {}

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

  async create(actorId: string, dto: CreateVerificationDto) {
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
    );
    return this.toDto(req);
  }

  async update(actorId: string, id: string, dto: UpdateVerificationDto) {
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
        const newPharmacy = await tx.pharmacy.create({
          data: {
            name: existing.pharmacyName,
            licenseNumber: existing.licenseNumber || `LIC-${Date.now().toString(36).toUpperCase()}`,
            verificationStatus: VerificationStatus.PENDING,
            isParticipating: false,
            reliabilityScore: 0.8,
            addressLine1: 'Primary Location',
            city: 'Main City',
            country: 'India',
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
        await tx.pharmacy.update({
          where: { id: pharmacyId },
          data: {
            verificationStatus: VerificationStatus.VERIFIED,
            isParticipating: true,
            updatedAt: new Date(),
          },
        });

        if (targetUser) {
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

        if (targetUser) {
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

        if (targetUser) {
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


