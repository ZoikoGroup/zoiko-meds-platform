/**
 * Why is a pharmacy missing from patient search?
 *
 * Patient search (`GET /me/search`) only ever returns a pharmacy that passes
 * ALL of these, and drops it silently otherwise:
 *
 *   1. verificationStatus = VERIFIED      (PUBLIC_PHARMACY_WHERE)
 *   2. isParticipating = true             (PUBLIC_PHARMACY_WHERE)
 *   3. latitude AND longitude are set     (distanceFor() returns null otherwise)
 *   4. distance from the patient <= maxDistance km
 *   5. it holds a non-SUPPRESSED AvailabilitySignal for the searched medicine
 *
 * This prints which of those each pharmacy fails, so "the DB pharmacies are not
 * showing" becomes a fact rather than a guess. Read-only — it writes nothing.
 *
 *   cd backend
 *   npx ts-node scripts/diagnose-pharmacy-visibility.ts
 *   npx ts-node scripts/diagnose-pharmacy-visibility.ts --q=paracetamol --lat=17.5561 --lng=78.4181 --km=15
 *
 * --q    medicine term, matched exactly as /me/search matches it
 * --lat/--lng  the patient's position; without them rules 3-4 are reported but
 *              no distance is computed
 * --km   search radius, default 15 (the frontend's default)
 */
import { AvailabilityConfidence, PrismaClient, VerificationStatus } from '@prisma/client';

const prisma = new PrismaClient();

const arg = (name: string) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};
const num = (name: string) => {
  const raw = arg(name);
  if (raw == null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

const q = (arg('q') ?? '').trim();
const lat = num('lat');
const lng = num('lng');
const km = num('km') ?? 15;

const rad = (d: number) => (d * Math.PI) / 180;
function haversine(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function main() {
  // --- What is actually in here? -------------------------------------------
  // Printed first and unconditionally. "No other pharmacy is showing" has a
  // very different fix depending on whether the table holds one pharmacy or
  // forty, and this answers that before any rule is evaluated.
  const [pharmacyCount, verifiedCount, participatingCount, locatedCount,
         medicineCount, signalCount, pharmaciesWithSignals] = await Promise.all([
    prisma.pharmacy.count(),
    prisma.pharmacy.count({ where: { verificationStatus: VerificationStatus.VERIFIED } }),
    prisma.pharmacy.count({ where: { isParticipating: true } }),
    prisma.pharmacy.count({ where: { latitude: { not: null }, longitude: { not: null } } }),
    prisma.medicineEntity.count({ where: { isSuppressed: false } }),
    prisma.availabilitySignal.count(),
    prisma.pharmacy.count({ where: { availabilitySignals: { some: {} } } }),
  ]);

  console.log('--- What the database holds ---');
  console.log(`Pharmacies:            ${pharmacyCount}`);
  console.log(`  VERIFIED:            ${verifiedCount}`);
  console.log(`  isParticipating:     ${participatingCount}`);
  console.log(`  with lat AND lng:    ${locatedCount}   <-- anything below this never appears in search`);
  console.log(`  holding any signal:  ${pharmaciesWithSignals}   <-- only these can stock anything`);
  console.log(`Medicines (unsuppressed): ${medicineCount}`);
  console.log(`Availability signals:  ${signalCount}`);

  if (pharmacyCount > 0 && locatedCount < pharmacyCount) {
    console.log(
      `
!! ${pharmacyCount - locatedCount} pharmac${pharmacyCount - locatedCount === 1 ? 'y has' : 'ies have'} no coordinates. ` +
        'Those are invisible to patient search no matter what else is true.',
    );
  }
  if (pharmaciesWithSignals <= 1) {
    console.log(
      `
!! Only ${pharmaciesWithSignals} pharmac${pharmaciesWithSignals === 1 ? 'y holds' : 'ies hold'} availability signals. ` +
        'A pharmacy with no signal stocks nothing, so no medicine search can return it ' +
        '- this is inventory missing, not a search bug.',
    );
  }

  // --- Which medicine identities does the term resolve to? -----------------
  // Copied from MeService.search so this reports on the same rows it would.
  let medicineIds: string[] | undefined;
  if (q) {
    const medicines = await prisma.medicineEntity.findMany({
      where: {
        isSuppressed: false,
        OR: [
          { canonicalName: { contains: q, mode: 'insensitive' } },
          { genericName: { contains: q, mode: 'insensitive' } },
          { manufacturer: { contains: q, mode: 'insensitive' } },
          { brandNames: { has: q } },
        ],
      },
      select: { id: true, canonicalName: true },
      take: 50,
    });
    medicineIds = medicines.map((m) => m.id);
    console.log(`\nTerm "${q}" resolved to ${medicines.length} MediBase identit${medicines.length === 1 ? 'y' : 'ies'}:`);
    for (const m of medicines) console.log(`   - ${m.canonicalName}`);
    if (medicines.length === 0) {
      console.log('   (none — search returns an empty pharmacy list for this term by design)');
    }
  }

  const pharmacies = await prisma.pharmacy.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, name: true, city: true, region: true, country: true,
      addressLine1: true, latitude: true, longitude: true,
      verificationStatus: true, isParticipating: true,
      _count: { select: { availabilitySignals: true } },
    },
  });

  console.log(`\n${pharmacies.length} pharmac${pharmacies.length === 1 ? 'y' : 'ies'} in the database.\n`);

  let visible = 0;
  const totals = { unverified: 0, notParticipating: 0, noCoords: 0, tooFar: 0, noSignal: 0 };

  for (const p of pharmacies) {
    const fails: string[] = [];

    if (p.verificationStatus !== VerificationStatus.VERIFIED) {
      fails.push(`not VERIFIED (${p.verificationStatus})`);
      totals.unverified++;
    }
    if (!p.isParticipating) {
      fails.push('isParticipating = false');
      totals.notParticipating++;
    }

    const located = p.latitude != null && p.longitude != null;
    if (!located) {
      fails.push('NO latitude/longitude — invisible to every distance-bounded search');
      totals.noCoords++;
    }

    let distance: number | null = null;
    if (located && lat != null && lng != null) {
      distance = haversine(lat, lng, p.latitude!, p.longitude!);
      if (distance > km) {
        fails.push(`${distance.toFixed(1)} km away, outside the ${km} km radius`);
        totals.tooFar++;
      }
    }

    // Rule 5 — only meaningful when a medicine term was given.
    if (medicineIds) {
      const stocking = medicineIds.length
        ? await prisma.availabilitySignal.count({
            where: {
              pharmacyId: p.id,
              medicineId: { in: medicineIds },
              confidence: { not: AvailabilityConfidence.SUPPRESSED },
            },
          })
        : 0;
      if (stocking === 0) {
        fails.push(`no visible signal for "${q}"`);
        totals.noSignal++;
      }
    }

    const where = [p.addressLine1, p.city, p.region, p.country].filter(Boolean).join(', ') || 'no address';
    const coords = located ? `${p.latitude!.toFixed(5)},${p.longitude!.toFixed(5)}` : '—';
    const dist = distance != null ? `${distance.toFixed(1)} km` : '—';

    if (fails.length === 0) {
      visible++;
      console.log(`VISIBLE  ${p.name}`);
      console.log(`         ${where}  |  ${coords}  |  ${dist}  |  ${p._count.availabilitySignals} signal(s)`);
    } else {
      console.log(`HIDDEN   ${p.name}`);
      console.log(`         ${where}  |  ${coords}  |  ${dist}  |  ${p._count.availabilitySignals} signal(s)`);
      for (const f of fails) console.log(`         ✗ ${f}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`${visible} of ${pharmacies.length} would appear in patient search${q ? ` for "${q}"` : ''}${lat != null && lng != null ? ` from ${lat},${lng} within ${km} km` : ''}.`);
  console.log(`Excluded: ${totals.unverified} not verified, ${totals.notParticipating} not participating, ${totals.noCoords} without coordinates, ${totals.tooFar} out of radius, ${totals.noSignal} not stocking the term.`);
  if (totals.noCoords > 0) {
    console.log(`\n${totals.noCoords} pharmac${totals.noCoords === 1 ? 'y has' : 'ies have'} no coordinates. Locate them with:`);
    console.log(`   npx ts-node scripts/backfill-pharmacy-coords.ts --apply   (needs GOOGLE_PLACES_API_KEY)`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
