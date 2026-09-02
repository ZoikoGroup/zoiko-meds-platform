import { Injectable, NotFoundException } from '@nestjs/common';
import {
  AvailabilityConfidence,
  LocationPrecision,
  MedicinePriority,
  Prisma,
  SignalNotification,
  SignalNotificationPreference,
  SignalNotificationType,
} from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PUBLIC_SIGNALS_INCLUDE,
  signalAgeMinutes,
} from '../../availability/availability.visibility';
import { NearbyPharmacyService } from '../../nearby/nearby-pharmacy.service';
import { SavedQueryDto } from '../dto/saved-query.dto';
import { UpdateSignalSettingsDto } from './dto/update-signal-settings.dto';

/** Default search radius in km, matching the patient search radius selector. */
const DEFAULT_RADIUS_KM = 15;

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

/**
 * How recently a signal must have been refreshed to count as a restock event.
 *
 * Read through signalAgeMinutes, never off `freshnessMinutes` directly. Nothing
 * writes that column - the pharmacy portal's upsert sets confidence and
 * computedAt - so reading it raw made this window unreachable and an in-stock
 * saved medicine produced no notification at all (MN-25).
 */
const RESTOCK_WINDOW_MINUTES = 180;

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly nearby: NearbyPharmacyService,
  ) {}

  // === Public read surface =================================================

  /**
   * Saved medicines with their current signal status.
   *
   * `query` is where the patient is. The "nearest pharmacy" on each row is only
   * nearest to someone, and it used to be nearest to a fixed demo address in
   * Hyderabad — every patient was told the same pharmacy was the same number of
   * kilometres away, wherever they actually were. With no location the pharmacy
   * is still named, with no distance attached.
   */
  async savedStatus(userId: string, query: SavedQueryDto = {}) {
    const origin = await this.nearby.resolveOrigin({
      lat: query.lat,
      lng: query.lng,
      city: query.city,
    });
    await this.regenerate(userId);
    const saved = await this.loadSavedWithSignals(userId);
    const genericIndex = await this.buildAlternativesIndex(saved.map((s) => s.medicine));
    const maxDistance = query.maxDistance ?? DEFAULT_RADIUS_KM;
    return saved.map((s) => this.toSavedStatusDto(s, genericIndex, origin, maxDistance));
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

  /**
   * The counters above the ZoikoSignal page.
   *
   * Takes the caller's location for the same reason the cards below it do: the
   * "running low" tile counts the same medicines those cards band, and a tile
   * counting every saved medicine low ANYWHERE sat above a list of cards that
   * had each been scoped to the patient's own radius.
   */
  async summary(userId: string, query: SavedQueryDto = {}) {
    const origin = await this.nearby.resolveOrigin({
      lat: query.lat,
      lng: query.lng,
      city: query.city,
    });
    const maxDistance = query.maxDistance ?? DEFAULT_RADIUS_KM;
    await this.regenerate(userId);
    const [saved, notifs] = await Promise.all([
      this.loadSavedWithSignals(userId),
      this.prisma.signalNotification.findMany({
        where: { userId, dismissed: false, archived: false },
      }),
    ]);
    const runningLow = saved.filter((s) => {
      const st = this.statusFor(s, origin, maxDistance);
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
    const prefs = await this.preferencesFor(userId);
    const saved = await this.loadSavedWithSignals(userId);

    for (const s of saved) {
      const status = this.statusFor(s);
      const prev = s.notifiedStatus as PatientStatus | null;
      // No location here, and none needed: notification generation ranks on
      // confidence then freshness, and distance is only the last tie-break.
      const best = this.bestSignal(s.medicine.availabilitySignals ?? []);
      const type = this.notificationTypeFor(status, prev, best);
      // A switch the patient turned off means no notification of that kind is
      // produced at all. `notifiedStatus` still advances below, so switching it
      // back on does not replay a transition that happened while it was off.
      const suppressed = type !== null && !this.allows(prefs, type);
      const currentKey =
        type && !suppressed ? `med:${s.medicineId}:${TYPE_UI[type]}` : null;

      // Prune stale availability notifications for this medicine (keeps at most
      // the one reflecting the current state).
      //
      // When there is no current event, only already-read rows are pruned. This
      // regenerates on read, and a restock event stops being current once it is
      // three hours old, so wiping unconditionally deleted alerts the patient
      // had not opened the page in time to see.
      await this.prisma.signalNotification.deleteMany({
        where: {
          userId,
          medicineId: s.medicineId,
          dedupeKey: { startsWith: `med:${s.medicineId}:` },
          // Switched off: the rows go too, unread included — "do not tell me
          // about this" is not "keep the last one on the page forever". With no
          // current event at all, unread rows survive (see above).
          ...(currentKey
            ? { NOT: { dedupeKey: currentKey } }
            : suppressed
              ? {}
              : { read: true }),
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

    await this.syncBroadcasts(userId, prefs);
  }

  /** Fan dispatched platform emergency broadcasts out to this user. */
  private async syncBroadcasts(
    userId: string,
    prefs: SignalNotificationPreference,
  ): Promise<void> {
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
      if (!this.allows(prefs, type)) {
        await this.prisma.signalNotification.deleteMany({ where: { userId, dedupeKey } });
        continue;
      }
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

  /**
   * This patient's switches, created on first use.
   *
   * An upsert rather than find-then-create: regeneration runs on every read of
   * the signal surface, and two concurrent reads by the same account would
   * otherwise race to insert the same row.
   */
  private preferencesFor(userId: string): Promise<SignalNotificationPreference> {
    return this.prisma.signalNotificationPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * Does this patient still want this kind of notification?
   *
   * SETTING_FOR_TYPE has always described the mapping; nothing consulted it, so
   * every switch on the ZoikoSignal settings page persisted and then changed
   * nothing about what was generated or shown.
   */
  private allows(
    prefs: SignalNotificationPreference,
    type: SignalNotificationType,
  ): boolean {
    const key = SETTING_FOR_TYPE[type];
    // A type with no switch of its own is always delivered.
    if (!key) return true;
    return prefs[key as keyof SignalNotificationPreference] !== false;
  }

  private notificationTypeFor(
    status: PatientStatus,
    prev: PatientStatus | null,
    best: RankedSignal | null,
  ): SignalNotificationType | null {
    if (status === 'available') {
      if (prev && prev !== 'available') return SignalNotificationType.BACK_IN_STOCK;
      // Fresh signal on an already-stocked medicine → informational restock.
      if (best && this.ageOf(best.signal) < RESTOCK_WINDOW_MINUTES) {
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
          // Notifications are generated without a location — `regenerate` runs
          // on every read of this surface, including the ones that carry no
          // query at all — so this copy cannot claim proximity. It said
          // "decreasing near your location" about pharmacies that were, in the
          // case that surfaced it, 1,200 km away, on a page whose own card for
          // the same medicine said no nearby pharmacy had it. Search is where
          // the patient finds out what is actually within reach, and that is
          // what the action offers.
          description:
            'Availability is decreasing across the verified network. Check what is in stock near you before it runs out.',
          actionLabel: 'Find Pharmacy',
          actionKind: 'find',
          actionQuery: medicineName,
        };
      case SignalNotificationType.BACK_IN_STOCK:
        return {
          title: `${medicineName} is back in stock`,
          description: `This medicine is available again${nearest ? ` at ${nearest}` : ' at a verified pharmacy'}.`,
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
          // Named rather than called "nearby": generation has no location, so
          // whether this pharmacy is near the patient is not something it can
          // assert. The name is a fact; the proximity was a guess.
          title: nearest
            ? `${nearest} restocked ${medicineName}`
            : `${medicineName} was restocked`,
          description: `${nearest ?? 'A verified pharmacy'} just refreshed its availability signal for this medicine.`,
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
    origin: { lat: number; lng: number } | null,
    maxDistance: number,
  ) {
    // One set of signals answers every field on this card, so the band, the
    // named pharmacy, the estimate and the timestamp can no longer disagree
    // about which pharmacies they are describing.
    const inRange = this.signalsInRange(
      s.medicine.availabilitySignals ?? [],
      origin,
      maxDistance,
    );
    const status = this.statusFor(s, origin, maxDistance);
    const best = this.bestSignal(inRange, origin);
    const pharmacy = best?.signal.pharmacy;
    const generic = s.medicine.genericName ?? s.medicine.canonicalName;
    const alternatives = (genericIndex.get(generic.toLowerCase()) ?? [])
      .filter((name) => name !== s.medicine.canonicalName)
      .slice(0, 3);

    // `nearest` is a claim that this pharmacy is near the patient, so it has to
    // respect the same radius the rest of the app does. Unbounded, it named the
    // strongest signal anywhere: a patient in Delhi was shown a Hyderabad
    // pharmacy as their nearest, on a screen that offers it as somewhere to go.
    // Out of range means there is no nearest, and null is what the client
    // renders as "none nearby".
    const distance = this.distanceFor(pharmacy, origin);

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
              distance,
              // An area-level pin makes `distance` a rough figure, and the card
              // shows it as "~4 km" rather than quoting a tenth of a kilometre
              // for a point nobody has actually located.
              approximate: pharmacy.locationPrecision === LocationPrecision.APPROXIMATE,
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
    const rows = await this.prisma.savedMedicine.findMany({
      // Only medicines with a governed identity: an off-catalog save has no
      // availability signal, so there is no status to derive or notify on here.
      where: { userId, medicineId: { not: null } },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
      include: {
        medicine: {
          // Same governed-visibility rule as every other patient surface: a
          // withdrawn or unverified pharmacy's signal must not drive an alert
          // about what is in stock.
          include: { availabilitySignals: PUBLIC_SIGNALS_INCLUDE },
        },
      },
    });
    // The `medicineId: not null` filter above cannot narrow the relation for
    // TypeScript; this predicate makes the guarantee explicit.
    return rows.filter((row): row is SavedWithSignals => row.medicine !== null);
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

  /**
   * The availability band this patient should be shown for a saved medicine.
   *
   * Scoped to the signals within reach of them, because the card states the
   * band and "no nearby pharmacy has this" side by side, and unbounded they
   * contradicted each other: a medicine stocked only in Hyderabad read
   * "Running Low - 2-3 days" to a patient in Delhi whose pharmacy list beneath
   * it was empty. Stock 1,200 km away is not stock the patient can act on, and
   * an estimate of how long it will last there is not information about them.
   *
   * With no location shared, or no radius to apply, every signal is in scope -
   * the same fallback the pharmacy list uses, and the same reason: nothing can
   * be excluded for being far away when there is nothing to measure from.
   */
  private statusFor(
    s: SavedWithSignals,
    origin?: { lat: number; lng: number } | null,
    maxDistance?: number,
  ): PatientStatus {
    const best = this.bestSignal(
      this.signalsInRange(s.medicine.availabilitySignals ?? [], origin, maxDistance),
      origin,
    );
    if (!best) return 'out-of-stock';
    return CONFIDENCE_TO_STATUS[best.signal.confidence];
  }

  /**
   * The signals a patient at `origin` could actually reach.
   *
   * A pharmacy with no coordinates is out of range rather than in it: nobody
   * knows where it is, so it cannot be claimed as near anyone. Without an
   * origin there is no range to be outside of and every signal is returned.
   */
  private signalsInRange(
    signals: SignalWithPharmacy[],
    origin?: { lat: number; lng: number } | null,
    maxDistance?: number,
  ): SignalWithPharmacy[] {
    if (!origin || maxDistance == null) return signals;
    return signals.filter((signal) => {
      const distance = this.distanceFor(signal.pharmacy, origin);
      return distance != null && distance <= maxDistance;
    });
  }

  /**
   * Age of a signal in minutes, from the stored snapshot or its timestamp.
   *
   * The same answer every other patient surface quotes for the same row, so an
   * alert cannot describe a signal as stale that the ZoikoSignal page shows as
   * minutes old.
   */
  private ageOf(signal: { freshnessMinutes: number | null; computedAt: Date }): number {
    return signalAgeMinutes(signal.freshnessMinutes, signal.computedAt);
  }

  /** Strongest confidence, then freshest, then nearest. */
  private bestSignal(
    signals: SignalWithPharmacy[],
    origin?: { lat: number; lng: number } | null,
  ): RankedSignal | null {
    if (signals.length === 0) return null;
    return signals
      .map((signal) => ({ signal, distance: this.distanceFor(signal.pharmacy, origin) }))
      .sort(
        (a, b) =>
          CONFIDENCE_RANK[a.signal.confidence] - CONFIDENCE_RANK[b.signal.confidence] ||
          // Derived, not read raw: with freshnessMinutes never written every
          // signal tied here, and the freshest-first rule silently did nothing.
          this.ageOf(a.signal) - this.ageOf(b.signal) ||
          (a.distance ?? 999) - (b.distance ?? 999),
      )[0];
  }

  /**
   * Distance from the patient to a pharmacy, in km, or null when there is no
   * honest answer — the patient shared no location, or the pharmacy has no
   * coordinates. Null is what the client renders as "—"; a number here is a
   * claim about how far someone has to travel.
   */
  private distanceFor(
    p?: { latitude: number | null; longitude: number | null } | null,
    origin?: { lat: number; lng: number } | null,
  ) {
    if (!origin) return null;
    if (!p || p.latitude == null || p.longitude == null) return null;
    const R = 6371;
    const dLat = this.rad(p.latitude - origin.lat);
    const dLng = this.rad(p.longitude - origin.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.rad(origin.lat)) * Math.cos(this.rad(p.latitude)) * Math.sin(dLng / 2) ** 2;
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

/**
 * A saved medicine that has been linked to a governed MediBase identity.
 *
 * Saves made against a medicine the catalog does not contain yet carry a null
 * `medicine`; they have no availability signals to derive a status from, so
 * this surface excludes them. Their "now available" alert is raised by
 * SavedMedicineLinkService the moment a pharmacy brings the medicine in.
 */
type SavedWithSignals = Prisma.SavedMedicineGetPayload<{
  include: {
    medicine: { include: { availabilitySignals: { include: { pharmacy: true } } } };
  };
}> & {
  medicine: NonNullable<
    Prisma.SavedMedicineGetPayload<{
      include: {
        medicine: { include: { availabilitySignals: { include: { pharmacy: true } } } };
      };
    }>['medicine']
  >;
};

interface RankedSignal {
  signal: SignalWithPharmacy;
  distance: number | null;
}
