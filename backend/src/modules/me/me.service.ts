import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AvailabilityConfidence,
  MedicineEntity,
  Pharmacy,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { SearchQueryDto } from './dto/search-query.dto';
import { UpdateAlertsDto } from './dto/update-alerts.dto';

/**
 * Patient portal service — the authenticated end-user surface (search, saved
 * medicines, alert preferences, dashboard). Availability is always presented
 * as a governed CONFIDENCE band derived from verified-pharmacy signals, never
 * as exact stock.
 */

// Reference point used to derive "distance from you". A real deployment would
// use the user's chosen location; for now we anchor to the demo service area.
const ORIGIN = { lat: 17.5561, lng: 78.4181 }; // Gandimaisamma, Hyderabad

const CONFIDENCE_UI: Record<AvailabilityConfidence, string> = {
  HIGH: 'high',
  MODERATE: 'moderate',
  LOW: 'low',
  UNKNOWN: 'unknown',
  SUPPRESSED: 'unknown',
};

const CONFIDENCE_RANK: Record<string, number> = {
  high: 0,
  moderate: 1,
  low: 2,
  unknown: 3,
};

type SignalWithPharmacy = Prisma.AvailabilitySignalGetPayload<{
  include: { pharmacy: true };
}>;

@Injectable()
export class MeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nearby: NearbyPharmacyService,
  ) {}

  // --- Search --------------------------------------------------------------

  async search(userId: string, query: SearchQueryDto) {
    const q = (query.q ?? '').trim();
    const maxDistance = query.maxDistance ?? 5;
    const type = query.type ?? 'all';

    if (q) {
      // Record the search (governed: term only, no PHI) for recent/history.
      await this.prisma.searchHistory.create({ data: { userId, term: q } });
    }

    const where: Prisma.MedicineEntityWhereInput = { isSuppressed: false };
    if (q) {
      where.OR = [
        { canonicalName: { contains: q, mode: 'insensitive' } },
        { genericName: { contains: q, mode: 'insensitive' } },
        { manufacturer: { contains: q, mode: 'insensitive' } },
        { brandNames: { has: q } },
      ];
    }

    const medicines = await this.prisma.medicineEntity.findMany({
      where,
      include: { availabilitySignals: { include: { pharmacy: true } } },
      take: 50,
    });

    // Group medicines by generic to compute "related identities".
    const byGeneric = new Map<string, MedicineEntity[]>();
    for (const m of medicines) {
      const key = (m.genericName ?? m.canonicalName).toLowerCase();
      if (!byGeneric.has(key)) byGeneric.set(key, []);
      byGeneric.get(key)!.push(m);
    }

    const dtos = medicines
      .map((m) => this.toMedicineDto(m, medicines))
      .filter((m) => m !== null)
      .filter((m) => (m!.distance ?? 999) <= maxDistance)
      .filter((m) => {
        if (type === 'generic') return m!.isGeneric;
        if (type === 'brand') return !m!.isGeneric;
        return true;
      })
      .sort(
        (a, b) =>
          CONFIDENCE_RANK[a!.confidence] - CONFIDENCE_RANK[b!.confidence] ||
          (a!.distance ?? 999) - (b!.distance ?? 999),
      );

    const pharmacies = await this.nearbyPharmacies(maxDistance);

    // Internet-sourced pharmacies near the caller (Google Places). Geographic
    // only — NOT tied to whether `q` is in stock — so it is returned separately
    // from the availability-signal `pharmacies` above. Degrades to an empty,
    // well-formed result when no location is given or the provider is
    // unconfigured/unreachable.
    const internetPharmacies = await this.nearby.findNearby({
      lat: query.lat,
      lng: query.lng,
      city: query.city,
      maxDistanceKm: maxDistance,
    });

    return { medicines: dtos, pharmacies, internetPharmacies };
  }

  async pharmacies(maxDistance = 5) {
    return this.nearbyPharmacies(maxDistance);
  }

  // --- Saved medicines -----------------------------------------------------

  async listSaved(userId: string) {
    const rows = await this.prisma.savedMedicine.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        medicine: {
          include: { availabilitySignals: { include: { pharmacy: true } } },
        },
      },
    });
    return rows
      .map((r) => this.toMedicineDto(r.medicine, [r.medicine]))
      .filter(Boolean);
  }

  async save(userId: string, medicineId: string) {
    const medicine = await this.prisma.medicineEntity.findUnique({
      where: { id: medicineId },
    });
    if (!medicine) throw new NotFoundException('Medicine not found');
    try {
      await this.prisma.savedMedicine.create({ data: { userId, medicineId } });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Medicine already saved');
      }
      throw err;
    }
    return { saved: true, medicineId };
  }

  async unsave(userId: string, medicineId: string) {
    await this.prisma.savedMedicine.deleteMany({
      where: { userId, medicineId },
    });
    return { saved: false, medicineId };
  }

  // --- Alert preferences ---------------------------------------------------

  async getAlerts(userId: string) {
    const existing = await this.prisma.alertPreference.findUnique({
      where: { userId },
    });
    if (existing) return this.toAlertsDto(existing);
    const created = await this.prisma.alertPreference.create({
      data: { userId },
    });
    return this.toAlertsDto(created);
  }

  async updateAlerts(userId: string, dto: UpdateAlertsDto) {
    const data: Prisma.AlertPreferenceUncheckedUpdateInput = {};
    if (dto.backToHigh !== undefined) data.backToHigh = dto.backToHigh;
    if (dto.nearby !== undefined) data.nearby = dto.nearby;
    if (dto.confidenceChange !== undefined)
      data.confidenceChange = dto.confidenceChange;
    if (dto.shortage !== undefined) data.shortage = dto.shortage;

    const pref = await this.prisma.alertPreference.upsert({
      where: { userId },
      create: { userId, ...data } as Prisma.AlertPreferenceUncheckedCreateInput,
      update: data,
    });
    return this.toAlertsDto(pref);
  }

  // --- Dashboard overview --------------------------------------------------

  async overview(userId: string) {
    const [savedCount, searchCount, verifiedPharmacies, prefs, recentRows, top] =
      await Promise.all([
        this.prisma.savedMedicine.count({ where: { userId } }),
        this.prisma.searchHistory.count({ where: { userId } }),
        this.prisma.pharmacy.count({
          where: { verificationStatus: 'VERIFIED' },
        }),
        this.prisma.alertPreference.findUnique({ where: { userId } }),
        this.prisma.searchHistory.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 12,
        }),
        this.prisma.medicineEntity.findMany({
          where: { isSuppressed: false },
          include: { availabilitySignals: { include: { pharmacy: true } } },
          take: 20,
        }),
      ]);

    const activeAlerts = prefs
      ? [prefs.backToHigh, prefs.nearby, prefs.confidenceChange, prefs.shortage].filter(
          Boolean,
        ).length
      : 0;

    // De-duplicate recent search terms, most-recent first.
    const seen = new Set<string>();
    const recentSearches: { term: string; when: string }[] = [];
    for (const r of recentRows) {
      const key = r.term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      recentSearches.push({ term: r.term, when: this.relativeTime(r.createdAt) });
      if (recentSearches.length >= 6) break;
    }

    const featured = top
      .map((m) => this.toMedicineDto(m, top))
      .filter(Boolean)
      .sort(
        (a, b) =>
          CONFIDENCE_RANK[a!.confidence] - CONFIDENCE_RANK[b!.confidence] ||
          (a!.distance ?? 999) - (b!.distance ?? 999),
      )
      .slice(0, 3);

    return {
      summary: {
        savedMedicines: savedCount,
        recentSearches: searchCount,
        verifiedPharmacies,
        activeAlerts,
      },
      featured,
      recentSearches,
    };
  }

  // --- mapping helpers -----------------------------------------------------

  private async nearbyPharmacies(maxDistance: number) {
    const rows = await this.prisma.pharmacy.findMany({
      where: { verificationStatus: { in: ['VERIFIED', 'PENDING'] } },
      include: {
        availabilitySignals: { orderBy: { computedAt: 'desc' }, take: 1 },
      },
    });

    // Only pharmacies within range are shown. Compute the SVG map bounds over
    // THIS filtered set (not all rows) so nearby pins spread across the map
    // instead of collapsing onto a global-scale corner.
    const near = rows
      .map((p) => ({ p, distance: this.distanceFor(p) }))
      .filter((x) => x.distance != null && x.distance <= maxDistance);
    const bounds = this.bounds(
      near.map(({ p }) => ({ lat: p.latitude!, lng: p.longitude! })),
    );

    return near
      .map(({ p, distance }) => this.toPharmacyDto(p, bounds, distance))
      .sort(
        (a, b) =>
          CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence] ||
          (a.distance ?? 999) - (b.distance ?? 999),
      );
  }

  private toMedicineDto(
    medicine: MedicineEntity & { availabilitySignals?: SignalWithPharmacy[] },
    all: (MedicineEntity & { availabilitySignals?: SignalWithPharmacy[] })[],
  ) {
    const signals = medicine.availabilitySignals ?? [];
    // Best signal = strongest confidence, then freshest, then nearest.
    const ranked = signals
      .map((s) => ({
        signal: s,
        ui: CONFIDENCE_UI[s.confidence],
        distance: this.distanceFor(s.pharmacy),
      }))
      .sort(
        (a, b) =>
          CONFIDENCE_RANK[a.ui] - CONFIDENCE_RANK[b.ui] ||
          (a.distance ?? 999) - (b.distance ?? 999),
      );
    const best = ranked[0];

    const isGeneric = medicine.brandNames.length === 0;

    // Related identities: other medicines sharing the generic name.
    const related = all
      .filter(
        (m) =>
          m.id !== medicine.id &&
          !!medicine.genericName &&
          m.genericName === medicine.genericName,
      )
      .map((m) => {
        const s = (m.availabilitySignals ?? [])
          .map((x) => ({ ui: CONFIDENCE_UI[x.confidence], pharmacy: x.pharmacy }))
          .sort((a, b) => CONFIDENCE_RANK[a.ui] - CONFIDENCE_RANK[b.ui])[0];
        return {
          name: m.canonicalName,
          strength: m.strength ?? '',
          confidence: s?.ui ?? 'unknown',
          pharmacy: s?.pharmacy?.name ?? '—',
          distance: s ? this.distanceFor(s.pharmacy) : null,
        };
      });

    return {
      id: medicine.id,
      name: medicine.canonicalName,
      generic: medicine.genericName ?? medicine.canonicalName,
      manufacturer: medicine.manufacturer ?? 'Generic manufacturer',
      strength: medicine.strength ?? '',
      form: medicine.dosageForm ?? '',
      confidence: best?.ui ?? 'unknown',
      pharmacy: best?.signal.pharmacy?.name ?? 'No verified pharmacy nearby',
      distance: best?.distance ?? null,
      updated: best ? this.relativeTime(best.signal.computedAt) : 'No recent signal',
      rx: medicine.prescriptionCategory !== 'OTC',
      isGeneric,
      description:
        medicine.description ??
        `${medicine.genericName ?? medicine.canonicalName} — governed medicine identity.`,
      related,
    };
  }

  private toPharmacyDto(
    p: Pharmacy & { availabilitySignals?: { confidence: AvailabilityConfidence; computedAt: Date }[] },
    bounds: ReturnType<MeService['bounds']>,
    distance: number | null,
  ) {
    const latest = p.availabilitySignals?.[0];
    const confidence = latest
      ? CONFIDENCE_UI[latest.confidence]
      : this.confidenceFromScore(p.reliabilityScore);
    const eta = distance != null ? `${Math.max(2, Math.round(distance * 5))} min` : '—';
    const { x, y } = this.project(p.latitude, p.longitude, bounds);

    return {
      id: p.id,
      name: p.name,
      confidence,
      distance,
      x,
      y,
      eta,
      open: p.isParticipating || p.verificationStatus === 'VERIFIED',
      open24h: p.reliabilityScore >= 0.9,
      verified: p.verificationStatus === 'VERIFIED',
      address: [p.addressLine1, p.city].filter(Boolean).join(', ') || '—',
      phone: p.phone ?? '',
      updated: latest ? this.relativeTime(latest.computedAt) : '—',
    };
  }

  private toAlertsDto(p: {
    backToHigh: boolean;
    nearby: boolean;
    confidenceChange: boolean;
    shortage: boolean;
  }) {
    return {
      backToHigh: p.backToHigh,
      nearby: p.nearby,
      confidenceChange: p.confidenceChange,
      shortage: p.shortage,
    };
  }

  // --- geo / time utilities ------------------------------------------------

  private distanceFor(p?: { latitude: number | null; longitude: number | null }) {
    if (!p || p.latitude == null || p.longitude == null) return null;
    return this.haversine(ORIGIN.lat, ORIGIN.lng, p.latitude, p.longitude);
  }

  private haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
    const R = 6371; // km
    const dLat = this.rad(lat2 - lat1);
    const dLng = this.rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.rad(lat1)) * Math.cos(this.rad(lat2)) * Math.sin(dLng / 2) ** 2;
    const d = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
    return Math.round(d * 10) / 10;
  }

  private rad(deg: number) {
    return (deg * Math.PI) / 180;
  }

  private bounds(coords: { lat: number; lng: number }[]) {
    if (coords.length === 0) {
      return { minLat: ORIGIN.lat, maxLat: ORIGIN.lat, minLng: ORIGIN.lng, maxLng: ORIGIN.lng };
    }
    const lats = coords.map((c) => c.lat);
    const lngs = coords.map((c) => c.lng);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };
  }

  private project(
    lat: number | null,
    lng: number | null,
    b: ReturnType<MeService['bounds']>,
  ) {
    if (lat == null || lng == null) return { x: 200, y: 200 };
    const spanLat = b.maxLat - b.minLat || 1;
    const spanLng = b.maxLng - b.minLng || 1;
    // Longitude → x, latitude → y (north is up, so invert).
    const x = 60 + ((lng - b.minLng) / spanLng) * 280;
    const y = 60 + ((b.maxLat - lat) / spanLat) * 280;
    return { x: Math.round(x), y: Math.round(y) };
  }

  private confidenceFromScore(score: number) {
    if (score >= 0.75) return 'high';
    if (score >= 0.4) return 'moderate';
    if (score > 0) return 'low';
    return 'unknown';
  }

  private relativeTime(date: Date) {
    const mins = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs} hr${hrs > 1 ? 's' : ''} ago`;
    const days = Math.round(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
  }
}
