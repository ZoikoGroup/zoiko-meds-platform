import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AvailabilityConfidence,
  LocationPrecision,
  MedicineEntity,
  Pharmacy,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  PUBLIC_PHARMACY_WHERE,
  PUBLIC_SIGNALS_INCLUDE,
  VISIBLE_SIGNAL_WHERE,
} from '../availability/availability.visibility';
import { NearbyPharmacyService } from '../nearby/nearby-pharmacy.service';
import { SignalIngestService } from '../signal/signal-ingest.service';
import { normalizeMedicineName } from '../saved-link/saved-medicine-link.service';
import { SaveMedicineDto } from './dto/save-medicine.dto';
import { SavedQueryDto } from './dto/saved-query.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { UpdateAlertsDto } from './dto/update-alerts.dto';

/**
 * Patient portal service — the authenticated end-user surface (search, saved
 * medicines, alert preferences, dashboard). Availability is always presented
 * as a governed CONFIDENCE band derived from verified-pharmacy signals, never
 * as exact stock.
 */

/**
 * Default search radius in km, matching the radius selector's default on the
 * patient search screen so an omitted value means the same thing on both sides.
 */
const DEFAULT_RADIUS_KM = 15;

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
    private readonly signal: SignalIngestService,
  ) {}

  // --- Search --------------------------------------------------------------

  async search(userId: string, query: SearchQueryDto) {
    const q = (query.q ?? '').trim();
    const maxDistance = query.maxDistance ?? DEFAULT_RADIUS_KM;
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
      include: { availabilitySignals: PUBLIC_SIGNALS_INCLUDE },
      take: 50,
    });

    // Emit an anonymized ZoikoSignal™ event for a real query (fire-and-forget).
    if (q) {
      if (medicines.length > 0) {
        void this.signal.recordSearch(medicines[0].id);
      } else {
        void this.signal.recordZeroResult(q);
      }
    }

    // Group medicines by generic to compute "related identities".
    const byGeneric = new Map<string, MedicineEntity[]>();
    for (const m of medicines) {
      const key = (m.genericName ?? m.canonicalName).toLowerCase();
      if (!byGeneric.has(key)) byGeneric.set(key, []);
      byGeneric.get(key)!.push(m);
    }

    // Measure from where the caller actually is, or from nowhere at all.
    //
    // There used to be a fixed fallback here — a demo address in Hyderabad —
    // and it did not degrade gracefully: a patient who had not shared a
    // location had every pharmacy in the country measured from that point, so
    // the ones genuinely near them were dropped for being "too far" while
    // pharmacies near the demo address were offered as local. A null origin
    // means distances are unknown, and unknown distances are not filtered on.
    const origin = await this.nearby.resolveOrigin({
      lat: query.lat,
      lng: query.lng,
      city: query.city,
    });

    const dtos = medicines
      .map((m) => this.toMedicineDto(m, medicines, origin))
      .filter((m) => m !== null)
      .filter((m) => origin == null || (m!.distance ?? 999) <= maxDistance)
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

    // Verified pharmacies that actually stock what was searched for. With no
    // search term this stays a plain nearby list, as before.
    //
    // A search term always scopes the list to the MediBase identities it
    // resolved to — including when it resolved to none. Passing the (possibly
    // empty) id list rather than dropping the argument is what stops a term the
    // catalog has never heard of from being answered with every nearby pharmacy.
    const pharmacies = await this.nearbyPharmacies(
      maxDistance,
      origin,
      q ? medicines.map((m) => m.id) : undefined,
    );

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

  /**
   * Nearby verified pharmacies, with no medicine in mind. `lat`/`lng` are the
   * caller's own position; without them the list is every verified pharmacy
   * rather than every verified pharmacy near a fixed point.
   */
  async pharmacies(maxDistance = DEFAULT_RADIUS_KM, origin?: { lat: number; lng: number } | null) {
    return this.nearbyPharmacies(maxDistance, origin ?? null);
  }

  // --- Saved medicines -----------------------------------------------------

  /**
   * The medicines this patient follows, each with the verified pharmacies near
   * THEM that stock it.
   *
   * The location is the caller's own, resolved the same way search resolves it.
   * Without one the list still returns — every pharmacy stocking the medicine,
   * no distances — rather than measuring from a fixed demo address, which is
   * what made a pharmacy on the other side of the country read as 4 km away.
   */
  async listSaved(userId: string, query: SavedQueryDto = {}) {
    const origin = await this.nearby.resolveOrigin({
      lat: query.lat,
      lng: query.lng,
      city: query.city,
    });
    const maxDistance = query.maxDistance ?? DEFAULT_RADIUS_KM;

    const rows = await this.prisma.savedMedicine.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        medicine: {
          include: { availabilitySignals: PUBLIC_SIGNALS_INCLUDE },
        },
      },
    });
    return rows
      .map((r) => {
        // Not yet in MediBase — return a name-only entry so the patient can see
        // and manage what they are following. `id` stays null so the client
        // knows there is no detail page or availability to link to.
        if (!r.medicine) {
          return {
            id: null,
            savedId: r.id,
            name: r.medicineName,
            generic: '',
            manufacturer: '',
            strength: '',
            form: '',
            confidence: 'unknown',
            pharmacy: 'Not stocked by a verified pharmacy yet',
            distance: null,
            updated: 'Waiting for a pharmacy to add it',
            rx: false,
            isGeneric: false,
            description: `${r.medicineName} is not in the MediBase catalog yet. We will alert you when a verified pharmacy adds it.`,
            related: [],
            pharmacies: [],
            inCatalog: false,
            alertsEnabled: r.alertsEnabled ?? true,
            priority: r.priority?.toLowerCase() ?? 'medium',
          };
        }
        const dto = this.toMedicineDto(r.medicine, [r.medicine], origin ?? undefined);
        if (!dto) return null;

        // Every verified pharmacy near the patient that reports this medicine
        // — not just the single strongest signal, which was all this page could
        // ever show: a patient with three pharmacies down the road saw one.
        const pharmacies = this.nearbySignalPharmacies(
          r.medicine!.availabilitySignals ?? [],
          origin,
          maxDistance,
        );

        // The headline has to be one of the pharmacies listed below it.
        //
        // `toMedicineDto` ranks every signal the medicine has, in range or not,
        // so its summary named the strongest pharmacy anywhere — and the client
        // printed that name whenever the list came back empty. A patient in
        // Delhi was told their medicine was at a pharmacy in Hyderabad, on the
        // same card whose list had just excluded it for being 1,200 km away.
        // With nothing in range there is no pharmacy to name, and saying so is
        // the whole point of the radius.
        const nearest = pharmacies[0] ?? null;
        return {
          ...dto,
          pharmacies,
          confidence: nearest?.confidence ?? 'unknown',
          pharmacy: nearest?.name ?? 'No verified pharmacy near you stocks this yet',
          distance: nearest?.distance ?? null,
          // Travels with the distance it qualifies: the summary line quotes the
          // same number the pharmacy row does, so it has to round the same way.
          approximate: nearest?.approximate ?? false,
          updated: nearest?.updated ?? 'No recent signal nearby',
          savedId: r.id,
          inCatalog: true,
          alertsEnabled: r.alertsEnabled ?? true,
          priority: r.priority?.toLowerCase() ?? 'medium',
        };
      })
      // A type predicate rather than `.filter(Boolean)`, which TypeScript
      // cannot narrow — callers were left with `| null` on every element.
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }

  /**
   * Save a medicine, with or without a governed identity.
   *
   * With `medicineId` the medicine must exist in MediBase. Without one, the
   * medicine is stored by name — a patient may follow something the catalog
   * has not seen yet, and SavedMedicineLinkService attaches the identity the
   * first time a verified pharmacy stocks it.
   */
  async save(userId: string, dto: SaveMedicineDto) {
    let medicineId: string | null = null;
    let medicineName = (dto.name ?? '').trim();

    if (dto.medicineId) {
      const medicine = await this.prisma.medicineEntity.findUnique({
        where: { id: dto.medicineId },
      });
      if (!medicine) throw new NotFoundException('Medicine not found');
      medicineId = medicine.id;
      // Prefer the governed name over whatever the client displayed.
      medicineName = medicine.canonicalName;
    }

    if (!medicineName) {
      throw new BadRequestException('Provide a medicineId or a medicine name');
    }

    const normalizedName = normalizeMedicineName(medicineName);
    if (!normalizedName) {
      throw new BadRequestException('Medicine name must contain letters or numbers');
    }

    // The medicine may already be in the catalog under this name even though
    // the client had no id for it (an off-catalog save raced with a pharmacy
    // adding it). Attach the identity now rather than creating a pending row
    // that would never be linked.
    if (!medicineId) {
      const existing = await this.prisma.medicineEntity.findFirst({
        where: { canonicalName: { equals: medicineName, mode: 'insensitive' }, isSuppressed: false },
        select: { id: true, canonicalName: true },
      });
      if (existing) {
        medicineId = existing.id;
        medicineName = existing.canonicalName;
      }
    }

    try {
      await this.prisma.savedMedicine.create({
        data: {
          userId,
          medicineId,
          medicineName,
          normalizedName,
          linkedAt: medicineId ? new Date() : null,
        },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException('Medicine already saved');
      }
      throw err;
    }
    return { saved: true, medicineId, medicineName };
  }

  /**
   * Remove a saved medicine. `key` is a MediBase id for catalog medicines, or
   * the medicine name for one saved off-catalog; both are matched, scoped to
   * the caller. Removing the row is what stops any future alert for it.
   */
  async unsave(userId: string, key: string) {
    const normalizedName = normalizeMedicineName(key);
    await this.prisma.savedMedicine.deleteMany({
      where: {
        userId,
        OR: [{ medicineId: key }, { normalizedName }],
      },
    });
    return { saved: false, medicineId: key };
  }

  /**
   * Toggle availability alerts for one saved medicine. `key` is a MediBase id,
   * or the medicine name for a save made before the catalog held it. Turning
   * this off is what stops future alerts without losing the saved medicine.
   */
  async updateSavedMedicineAlerts(
    userId: string,
    key: string,
    alertsEnabled: boolean,
  ) {
    // Scoped by userId, so one patient can never toggle another's alerts.
    // `updateMany` matches zero rows when the medicine is not saved by this
    // user, which previously still reported success — report the miss instead
    // of telling the client a preference was stored when none was.
    const { count } = await this.prisma.savedMedicine.updateMany({
      where: {
        userId,
        OR: [{ medicineId: key }, { normalizedName: normalizeMedicineName(key) }],
      },
      data: { alertsEnabled },
    });
    if (count === 0) {
      throw new NotFoundException('Medicine is not in your saved list');
    }
    return { success: true, medicineId: key, alertsEnabled };
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
          include: { availabilitySignals: PUBLIC_SIGNALS_INCLUDE },
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

  /**
   * Verified ZoikoMeds pharmacies near the caller.
   *
   * @param medicineIds an ARRAY scopes the list to pharmacies holding an
   *   availability signal for one of these MediBase identities, and the
   *   confidence shown is that medicine's signal at that pharmacy — not the
   *   pharmacy's most recent signal for anything, which previously made an
   *   unrelated restock look like stock of the medicine being searched. An
   *   EMPTY array scopes it to nothing. `undefined` (no medicine in mind) is
   *   the plain nearby-pharmacy list.
   */
  private async nearbyPharmacies(
    maxDistance: number,
    origin: { lat: number; lng: number } | null,
    medicineIds?: string[],
  ) {
    // The searched term resolved to no MediBase identity, so no pharmacy can be
    // holding it: the honest answer is an empty list, and the UI says so.
    // Falling through to the unscoped query below is the defect this guards —
    // it answered "is Atorvastatin available?" with every verified pharmacy in
    // range, badged with whatever each had most recently reported for something
    // else, while the pharmacy portal correctly showed no such medicine.
    if (medicineIds && medicineIds.length === 0) return [];

    const forMedicine = Array.isArray(medicineIds) && medicineIds.length > 0;
    const rows = await this.prisma.pharmacy.findMany({
      where: {
        // Governed visibility, shared with /availability: VERIFIED and still
        // participating. A pending, rejected or withdrawn pharmacy is not part
        // of the verified network and must never appear as one.
        ...PUBLIC_PHARMACY_WHERE,
        ...(forMedicine
          ? {
              availabilitySignals: {
                some: { medicineId: { in: medicineIds }, ...VISIBLE_SIGNAL_WHERE },
              },
            }
          : {}),
      },
      include: {
        availabilitySignals: forMedicine
          ? {
              where: { medicineId: { in: medicineIds }, ...VISIBLE_SIGNAL_WHERE },
              orderBy: { computedAt: 'desc' },
              // The identity the band belongs to travels with it, so a card can
              // never be read as a claim about a medicine the pharmacy did not
              // report on.
              include: { medicine: { select: { id: true, canonicalName: true } } },
            }
          : {
              where: VISIBLE_SIGNAL_WHERE,
              orderBy: { computedAt: 'desc' },
              take: 1,
              include: { medicine: { select: { id: true, canonicalName: true } } },
            },
      },
    });

    // Only pharmacies within range are shown — but only when there is a range
    // to be within. With no caller location every distance is null, and
    // filtering on null would empty the list; the pharmacies that stock the
    // medicine are still the answer, they just cannot be ordered by proximity.
    // Compute the SVG map bounds over THIS filtered set (not all rows) so
    // nearby pins spread across the map instead of collapsing onto a
    // global-scale corner.
    const near = rows
      .map((p) => ({ p, distance: this.distanceFor(p, origin) }))
      .filter((x) => (origin ? x.distance != null && x.distance <= maxDistance : true));
    const bounds = this.bounds(
      near
        .filter(({ p }) => p.latitude != null && p.longitude != null)
        .map(({ p }) => ({ lat: p.latitude!, lng: p.longitude! })),
    );

    return near
      .map(({ p, distance }) => this.toPharmacyDto(p, bounds, distance))
      .sort((a, b) => {
        const byDistance = (a.distance ?? 999) - (b.distance ?? 999);
        const byConfidence = CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence];
        // Searching a medicine: every result already stocks it, so proximity is
        // what the patient is choosing on. Browsing without a medicine: lead
        // with the strongest signal, as before.
        return forMedicine ? byDistance || byConfidence : byConfidence || byDistance;
      });
  }

  private toMedicineDto(
    medicine: MedicineEntity & { availabilitySignals?: SignalWithPharmacy[] },
    all: (MedicineEntity & { availabilitySignals?: SignalWithPharmacy[] })[],
    origin?: { lat: number; lng: number } | null,
  ) {
    const signals = medicine.availabilitySignals ?? [];
    // Best signal = strongest confidence, then freshest, then nearest.
    const ranked = signals
      .map((s) => ({
        signal: s,
        ui: CONFIDENCE_UI[s.confidence],
        distance: this.distanceFor(s.pharmacy, origin),
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
          distance: s ? this.distanceFor(s.pharmacy, origin) : null,
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
    p: Pharmacy & {
      availabilitySignals?: {
        confidence: AvailabilityConfidence;
        computedAt: Date;
        medicineId?: string;
        medicine?: { id: string; canonicalName: string } | null;
      }[];
    },
    bounds: ReturnType<MeService['bounds']>,
    distance: number | null,
  ) {
    const latest = p.availabilitySignals?.[0];
    // No signal means no availability claim. The reliability score measures how
    // promptly this pharmacy reports, not whether anything is in stock, so
    // deriving a band from it manufactured a signal the pharmacy never sent.
    const confidence = latest ? CONFIDENCE_UI[latest.confidence] : 'unknown';
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
      address:
        [p.addressLine1, p.addressLine2, p.city, p.region, p.postalCode]
          .filter(Boolean)
          .join(', ') || '—',
      // This branch's own number, straight off its record — the card offers it
      // as the confirm-before-you-travel action, so it can only ever be the
      // number of the pharmacy named on that card. Empty when the record has
      // none; the client then offers no call action rather than a dead one.
      phone: p.phone ?? '',
      // Which medicine the band above is about. Absent only on the browse list,
      // where no medicine was searched.
      medicineId: latest?.medicineId ?? latest?.medicine?.id ?? null,
      medicineName: latest?.medicine?.canonicalName ?? null,
      updated: latest ? this.relativeTime(latest.computedAt) : '—',
      // Coordinates let the client build an exact Directions pin instead of a
      // name/address text lookup, which misses for similarly-named branches.
      latitude: p.latitude,
      longitude: p.longitude,
      // This pharmacy was placed by geocoding an area — a city or a PIN code —
      // so the pin is the middle of that area and `distance` is a rough figure.
      // The client prints it as "~4 km" rather than "4.2 km": the pharmacy is
      // genuinely around there, which is worth showing, but quoting it to a
      // tenth of a kilometre claims a precision nobody has.
      approximate: p.locationPrecision === LocationPrecision.APPROXIMATE,
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

  /**
   * Distance from the caller to a pharmacy, in km.
   *
   * `origin` is the caller's resolved location, and null when they have not
   * shared one. Both a missing origin and a pharmacy without coordinates give
   * null: there is no distance to state, and stating one anyway is how a
   * pharmacy nobody has located ends up wearing a plausible "4.2 km".
   */
  private distanceFor(
    p?: { latitude: number | null; longitude: number | null } | null,
    origin?: { lat: number; lng: number } | null,
  ) {
    if (!origin) return null;
    if (!p || p.latitude == null || p.longitude == null) return null;
    return this.haversine(origin.lat, origin.lng, p.latitude, p.longitude);
  }

  /**
   * The verified pharmacies behind a medicine's signals, as a patient-facing
   * list ordered by how far away they are.
   *
   * With an origin the list is bounded by `maxDistance` and an unlocated
   * pharmacy is left out: it cannot be shown as nearby when nobody knows where
   * it is. Without an origin nothing can be bounded, so every stocking pharmacy
   * is returned with a null distance — an honest "here they all are" rather
   * than a radius measured from somewhere the patient has never been.
   *
   * One row per pharmacy: several signals for the same medicine from one
   * pharmacy are the same shop reporting more than once, and the freshest of
   * those is the one that stands.
   */
  private nearbySignalPharmacies(
    signals: SignalWithPharmacy[],
    origin: { lat: number; lng: number } | null,
    maxDistance: number,
  ) {
    const byPharmacy = new Map<string, SignalWithPharmacy>();
    for (const s of signals) {
      if (!s.pharmacy) continue;
      const held = byPharmacy.get(s.pharmacy.id);
      if (!held || s.computedAt > held.computedAt) byPharmacy.set(s.pharmacy.id, s);
    }

    return [...byPharmacy.values()]
      .map((s) => ({ signal: s, distance: this.distanceFor(s.pharmacy, origin) }))
      .filter(({ distance }) => (origin ? distance != null && distance <= maxDistance : true))
      .map(({ signal, distance }) => ({
        id: signal.pharmacy.id,
        name: signal.pharmacy.name,
        address:
          [
            signal.pharmacy.addressLine1,
            signal.pharmacy.addressLine2,
            signal.pharmacy.city,
            signal.pharmacy.region,
            signal.pharmacy.postalCode,
          ]
            .filter(Boolean)
            .join(', ') || '—',
        // The number to ring: availability is a confidence signal, so the one
        // action offered alongside it is to call and confirm before travelling.
        phone: signal.pharmacy.phone ?? '',
        latitude: signal.pharmacy.latitude,
        longitude: signal.pharmacy.longitude,
        // See toPharmacyDto: an area-level pin makes `distance` a rough figure.
        approximate: signal.pharmacy.locationPrecision === LocationPrecision.APPROXIMATE,
        confidence: CONFIDENCE_UI[signal.confidence],
        distance,
        updated: this.relativeTime(signal.computedAt),
      }))
      .sort(
        (a, b) =>
          (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY) ||
          CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence],
      );
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
    // Nothing to frame. A degenerate box centred on 0,0 is fine: `project`
    // collapses it to the middle of the map, and with no pins to place there is
    // nothing to be wrong about. It used to be centred on the demo address.
    if (coords.length === 0) {
      return { minLat: 0, maxLat: 0, minLng: 0, maxLng: 0 };
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
