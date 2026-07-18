import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AvailabilityConfidence,
  MedicinePriority,
  Prisma,
  SignalNotification,
  SignalNotificationType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateSignalSettingsDto } from './dto/update-signal-settings.dto';

/**
 * Patient ZoikoSignal™ — personalized availability notifications.
 *
 * Notifications are DERIVED, not hand-authored: on every read we regenerate the
 * user's notification set from their saved medicines' current availability
 * confidence bands and any relevant dispatched platform broadcasts. A stable
 * `dedupeKey` per logical notification keeps generation idempotent, so a user's
 * read / archived / dismissed state survives regeneration. This is personal,
 * per-user data — distinct from the aggregate, PHI-free ZoikoSignal intelligence
 * (SignalAggregate) consumed by enterprise/government/admin roles.
 */

// Anchor for "distance from you" — matches MeService's demo service area.
const ORIGIN = { lat: 17.5561, lng: 78.4181 }; // Gandimaisamma, Hyderabad

type PatientStatus = 'available' | 'limited' | 'running-low' | 'out-of-stock';

const CONFIDENCE_TO_STATUS: Record<AvailabilityConfidence, PatientStatus> = {
  HIGH: 'available',
  MODERATE: 'limited',
  LOW: 'running-low',
  UNKNOWN: 'out-of-stock',
  SUPPRESSED: 'out-of-stock',
};

const CONFIDENCE_RANK: Record<AvailabilityConfidence, number> = {
  HIGH: 0,
  MODERATE: 1,
  LOW: 2,
  UNKNOWN: 3,
  SUPPRESSED: 4,
};

const EST_DURATION: Record<PatientStatus, string | null> = {
  available: '2+ weeks',
  limited: '4–5 days',
  'running-low': '2–3 days',
  'out-of-stock': null,
};

// Statuses that count as an urgent, card-worthy "active alert".
const ACTIVE_ALERT_TYPES: SignalNotificationType[] = [
  SignalNotificationType.RUNNING_LOW,
  SignalNotificationType.BACK_IN_STOCK,
  SignalNotificationType.LIMITED,
];

// Backend enum → the lowercase vocabulary the patient UI renders.
const TYPE_UI: Record<SignalNotificationType, string> = {
  RUNNING_LOW: 'running-low',
  BACK_IN_STOCK: 'back-in-stock',
  LIMITED: 'limited',
  NEARBY_RESTOCK: 'nearby-restock',
  RECALL: 'recall',
  SAFETY: 'safety',
};

// Which notification types are gated by which settings toggle.
const SETTING_FOR_TYPE: Partial<Record<SignalNotificationType, keyof UpdateSignalSettingsDto>> = {
  RUNNING_LOW: 'runningLow',
  BACK_IN_STOCK: 'backInStock',
  LIMITED: 'runningLow',
  NEARBY_RESTOCK: 'nearbyRestock',
  RECALL: 'recall',
  SAFETY: 'safety',
};

type SignalWithPharmacy = Prisma.AvailabilitySignalGetPayload<{
  include: { pharmacy: true };
}>;

@Injectable()
export class PatientSignalService {
  constructor(private readonly prisma: PrismaService) {}

  // === Public read surface =================================================

  async savedStatus(userId: string) {
    await this.regenerate(userId);
    const saved = await this.loadSavedWithSignals(userId);
    const genericIndex = await this.buildAlternativesIndex(saved.map((s) => s.medicine));
    return saved.map((s) => this.toSavedStatusDto(s, genericIndex));
  }

  async listNotifications(userId: string) {
    await this.regenerate(userId);
    const rows = await this.prisma.signalNotification.findMany({
      where: { userId, dismissed: false, archived: false },
      orderBy: { occurredAt: 'desc' },
    });
    return rows.map((n) => this.toNotificationDto(n));
  }

  async listActiveAlerts(userId: string) {
    await this.regenerate(userId);
    const rows = await this.prisma.signalNotification.findMany({
      where: {
        userId,
        dismissed: false,
        archived: false,
        type: { in: ACTIVE_ALERT_TYPES },
      },
      orderBy: { occurredAt: 'desc' },
    });
    return rows.map((n) => this.toNotificationDto(n));
  }

  async summary(userId: string) {
    await this.regenerate(userId);
    const [saved, notifs] = await Promise.all([
      this.loadSavedWithSignals(userId),
      this.prisma.signalNotification.findMany({
        where: { userId, dismissed: false, archived: false },
      }),
    ]);
    const runningLow = saved.filter((s) => {
      const st = this.statusFor(s);
      return st === 'running-low' || st === 'out-of-stock';
    }).length;
    return {
      savedMedicines: saved.length,
      activeAlerts: notifs.filter((n) => ACTIVE_ALERT_TYPES.includes(n.type)).length,
      runningLow,
      backInStockToday: notifs.filter((n) => n.type === SignalNotificationType.BACK_IN_STOCK).length,
      unread: notifs.filter((n) => !n.read).length,
    };
  }

  async digest(userId: string) {
    await this.regenerate(userId);
    const notifs = await this.prisma.signalNotification.findMany({
      where: { userId, dismissed: false, archived: false },
      orderBy: { occurredAt: 'desc' },
    });
    const alerts = notifs
      .filter((n) => ACTIVE_ALERT_TYPES.includes(n.type))
      .slice(0, 3)
      .map((n) => ({ id: n.id, type: TYPE_UI[n.type], medicine: n.medicineName }));
    return { unread: notifs.filter((n) => !n.read).length, alerts };
  }

  // === Settings ============================================================

  async getSettings(userId: string) {
    const pref =
      (await this.prisma.signalNotificationPreference.findUnique({ where: { userId } })) ??
      (await this.prisma.signalNotificationPreference.create({ data: { userId } }));
    return this.toSettingsDto(pref);
  }

  async updateSettings(userId: string, dto: UpdateSignalSettingsDto) {
    const data: Prisma.SignalNotificationPreferenceUncheckedUpdateInput = {};
    for (const key of [
      'runningLow',
      'backInStock',
      'nearbyRestock',
      'recall',
      'safety',
      'push',
      'email',
      'sms',
    ] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    const pref = await this.prisma.signalNotificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        ...data,
      } as Prisma.SignalNotificationPreferenceUncheckedCreateInput,
      update: data,
    });
    return this.toSettingsDto(pref);
  }

  // === Mutations ===========================================================

  async markRead(userId: string, id: string) {
    await this.prisma.signalNotification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    return { ok: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.signalNotification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return { ok: true };
  }

  async dismiss(userId: string, id: string) {
    await this.prisma.signalNotification.updateMany({
      where: { id, userId },
      data: { dismissed: true },
    });
    return { ok: true };
  }

  async archive(userId: string, id: string) {
    await this.prisma.signalNotification.updateMany({
      where: { id, userId },
      data: { archived: true },
    });
    return { ok: true };
  }

  async setPriority(userId: string, medicineId: string, priority: MedicinePriority) {
    const res = await this.prisma.savedMedicine.updateMany({
      where: { userId, medicineId },
      data: { priority },
    });
    if (res.count === 0) throw new NotFoundException('Saved medicine not found');
    return { ok: true, medicineId, priority };
  }

  // === Generation ==========================================================

  /**
   * Rebuild the user's notification set from current saved-medicine availability
   * and dispatched platform broadcasts. Idempotent: upserts by `dedupeKey` and
   * prunes stale availability rows, preserving read/archived/dismissed state.
   */
  private async regenerate(userId: string): Promise<void> {
    const saved = await this.loadSavedWithSignals(userId);

    for (const s of saved) {
      const status = this.statusFor(s);
      const prev = s.notifiedStatus as PatientStatus | null;
      const best = this.bestSignal(s.medicine.availabilitySignals ?? []);
      const type = this.notificationTypeFor(status, prev, best);
      const currentKey = type ? `med:${s.medicineId}:${TYPE_UI[type]}` : null;

      // Prune stale availability notifications for this medicine (keeps at most
      // the one reflecting the current state).
      await this.prisma.signalNotification.deleteMany({
        where: {
          userId,
          medicineId: s.medicineId,
          dedupeKey: { startsWith: `med:${s.medicineId}:` },
          ...(currentKey ? { NOT: { dedupeKey: currentKey } } : {}),
        },
      });

      if (type && currentKey) {
        const content = this.availabilityContent(type, s.medicine.canonicalName, best);
        await this.prisma.signalNotification.upsert({
          where: { userId_dedupeKey: { userId, dedupeKey: currentKey } },
          create: {
            userId,
            dedupeKey: currentKey,
            type,
            medicineId: s.medicineId,
            medicineName: s.medicine.canonicalName,
            ...content,
          },
          // Refresh copy/time in place; DO NOT touch read/archived/dismissed.
          update: {
            title: content.title,
            description: content.description,
            occurredAt: new Date(),
          },
        });
      }

      if (status !== prev) {
        await this.prisma.savedMedicine.update({
          where: { id: s.id },
          data: { notifiedStatus: status },
        });
      }
    }

    await this.syncBroadcasts(userId);
  }

  /** Fan dispatched platform emergency broadcasts out to this user. */
  private async syncBroadcasts(userId: string): Promise<void> {
    const broadcasts = await this.prisma.notification.findMany({
      where: {
        status: 'DISPATCHED',
        target: 'ALL_USERS',
        type: 'EMERGENCY_ALERT',
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    for (const b of broadcasts) {
      const type = /recall/i.test(b.title)
        ? SignalNotificationType.RECALL
        : SignalNotificationType.SAFETY;
      const dedupeKey = `broadcast:${b.id}`;
      await this.prisma.signalNotification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey } },
        create: {
          userId,
          dedupeKey,
          type,
          medicineName: b.title,
          title: b.title,
          description: b.message,
          actionLabel: 'Read advisory',
          actionKind: 'read',
          occurredAt: b.createdAt,
        },
        update: {
          title: b.title,
          description: b.message,
        },
      });
    }
  }

  private notificationTypeFor(
    status: PatientStatus,
    prev: PatientStatus | null,
    best: RankedSignal | null,
  ): SignalNotificationType | null {
    if (status === 'available') {
      if (prev && prev !== 'available') return SignalNotificationType.BACK_IN_STOCK;
      // Fresh signal on an already-stocked medicine → informational restock.
      if (best?.signal.freshnessMinutes != null && best.signal.freshnessMinutes < 180) {
        return SignalNotificationType.NEARBY_RESTOCK;
      }
      return null;
    }
    if (status === 'limited') return SignalNotificationType.LIMITED;
    // running-low and out-of-stock both surface as an urgent running-low alert.
    return SignalNotificationType.RUNNING_LOW;
  }

  private availabilityContent(
    type: SignalNotificationType,
    medicineName: string,
    best: RankedSignal | null,
  ): {
    title: string;
    description: string;
    actionLabel: string;
    actionKind: string;
    actionQuery: string;
  } {
    const nearest = best?.signal.pharmacy?.name;
    switch (type) {
      case SignalNotificationType.RUNNING_LOW:
        return {
          title: `${medicineName} is running low`,
          description:
            'Availability is decreasing near your location. Purchase soon before nearby pharmacies run out.',
          actionLabel: 'Find Pharmacy',
          actionKind: 'find',
          actionQuery: medicineName,
        };
      case SignalNotificationType.BACK_IN_STOCK:
        return {
          title: `${medicineName} is back in stock`,
          description: `This medicine is available again${nearest ? ` at ${nearest}` : ' at nearby pharmacies'}.`,
          actionLabel: 'View Pharmacies',
          actionKind: 'view',
          actionQuery: medicineName,
        };
      case SignalNotificationType.LIMITED:
        return {
          title: `${medicineName} has limited availability`,
          description: 'Only a few pharmacies currently have this medicine.',
          actionLabel: 'Locate Pharmacy',
          actionKind: 'locate',
          actionQuery: medicineName,
        };
      case SignalNotificationType.NEARBY_RESTOCK:
      default:
        return {
          title: `A nearby pharmacy restocked ${medicineName}`,
          description: `${nearest ?? 'A nearby pharmacy'} just refreshed its availability signal for this medicine.`,
          actionLabel: 'View Pharmacies',
          actionKind: 'view',
          actionQuery: medicineName,
        };
    }
  }

  // === Mapping / helpers ===================================================

  private toNotificationDto(n: SignalNotification) {
    return {
      id: n.id,
      type: TYPE_UI[n.type],
      medicine: n.medicineName,
      title: n.title,
      description: n.description,
      time: this.relativeTime(n.occurredAt),
      action: n.actionLabel
        ? {
            label: n.actionLabel,
            kind: n.actionKind ?? 'view',
            ...(n.actionQuery ? { query: n.actionQuery } : {}),
          }
        : null,
      read: n.read,
      archived: n.archived,
    };
  }

  private toSavedStatusDto(
    s: SavedWithSignals,
    genericIndex: Map<string, string[]>,
  ) {
    const status = this.statusFor(s);
    const best = this.bestSignal(s.medicine.availabilitySignals ?? []);
    const pharmacy = best?.signal.pharmacy;
    const generic = s.medicine.genericName ?? s.medicine.canonicalName;
    const alternatives = (genericIndex.get(generic.toLowerCase()) ?? [])
      .filter((name) => name !== s.medicine.canonicalName)
      .slice(0, 3);

    return {
      id: s.medicineId,
      name: s.medicine.canonicalName,
      generic,
      strength: s.medicine.strength ?? '',
      status,
      priority: s.priority.toLowerCase(),
      updated: best ? this.relativeTime(best.signal.computedAt) : 'No recent signal',
      nearest:
        pharmacy && status !== 'out-of-stock'
          ? {
              name: pharmacy.name,
              distance: this.distanceFor(pharmacy),
              open: pharmacy.isParticipating || pharmacy.verificationStatus === 'VERIFIED',
              is24x7: pharmacy.reliabilityScore >= 0.9,
            }
          : null,
      estDuration: EST_DURATION[status],
      alternatives,
    };
  }

  private toSettingsDto(p: {
    runningLow: boolean;
    backInStock: boolean;
    nearbyRestock: boolean;
    recall: boolean;
    safety: boolean;
    push: boolean;
    email: boolean;
    sms: boolean;
  }) {
    return {
      runningLow: p.runningLow,
      backInStock: p.backInStock,
      nearbyRestock: p.nearbyRestock,
      recall: p.recall,
      safety: p.safety,
      push: p.push,
      email: p.email,
      sms: p.sms,
    };
  }

  private async loadSavedWithSignals(userId: string): Promise<SavedWithSignals[]> {
    return this.prisma.savedMedicine.findMany({
      where: { userId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      include: {
        medicine: {
          include: { availabilitySignals: { include: { pharmacy: true } } },
        },
      },
    });
  }

  /** Map generic name → the canonical names sharing it (for "alternatives"). */
  private async buildAlternativesIndex(
    medicines: Array<{ genericName: string | null; canonicalName: string }>,
  ): Promise<Map<string, string[]>> {
    const generics = [
      ...new Set(
        medicines
          .map((m) => (m.genericName ?? m.canonicalName).toLowerCase())
          .filter(Boolean),
      ),
    ];
    if (generics.length === 0) return new Map();
    const rows = await this.prisma.medicineEntity.findMany({
      where: { isSuppressed: false, genericName: { in: generics, mode: 'insensitive' } },
      select: { canonicalName: true, genericName: true },
    });
    const index = new Map<string, string[]>();
    for (const r of rows) {
      const key = (r.genericName ?? r.canonicalName).toLowerCase();
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(r.canonicalName);
    }
    return index;
  }

  private statusFor(s: SavedWithSignals): PatientStatus {
    const best = this.bestSignal(s.medicine.availabilitySignals ?? []);
    if (!best) return 'out-of-stock';
    return CONFIDENCE_TO_STATUS[best.signal.confidence];
  }

  /** Strongest confidence, then freshest, then nearest. */
  private bestSignal(signals: SignalWithPharmacy[]): RankedSignal | null {
    if (signals.length === 0) return null;
    return signals
      .map((signal) => ({ signal, distance: this.distanceFor(signal.pharmacy) }))
      .sort(
        (a, b) =>
          CONFIDENCE_RANK[a.signal.confidence] - CONFIDENCE_RANK[b.signal.confidence] ||
          (a.signal.freshnessMinutes ?? 1e9) - (b.signal.freshnessMinutes ?? 1e9) ||
          (a.distance ?? 999) - (b.distance ?? 999),
      )[0];
  }

  private distanceFor(p?: { latitude: number | null; longitude: number | null } | null) {
    if (!p || p.latitude == null || p.longitude == null) return null;
    const R = 6371;
    const dLat = this.rad(p.latitude - ORIGIN.lat);
    const dLng = this.rad(p.longitude - ORIGIN.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.rad(ORIGIN.lat)) * Math.cos(this.rad(p.latitude)) * Math.sin(dLng / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(a))) * 10) / 10;
  }

  private rad(deg: number) {
    return (deg * Math.PI) / 180;
  }

  private relativeTime(date: Date): string {
    const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}

type SavedWithSignals = Prisma.SavedMedicineGetPayload<{
  include: {
    medicine: { include: { availabilitySignals: { include: { pharmacy: true } } } };
  };
}>;

interface RankedSignal {
  signal: SignalWithPharmacy;
  distance: number | null;
}
