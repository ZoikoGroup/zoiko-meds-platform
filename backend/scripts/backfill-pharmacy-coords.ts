/**
 * Give already-registered pharmacies the coordinates they need to appear in
 * patient search.
 *
 * Pharmacies created through Pharmacy Management before this change were stored
 * with an address but no latitude/longitude. Every patient search is distance
 * bounded, so those records could never be returned — they were invisible to
 * the public search regardless of verification status or inventory.
 *
 * New and edited pharmacies are geocoded automatically by PharmacyAdminService;
 * this is the one-off pass for the existing rows.
 *
 *   cd backend
 *   npx ts-node scripts/backfill-pharmacy-coords.ts            # dry run
 *   npx ts-node scripts/backfill-pharmacy-coords.ts --apply    # write
 *
 * Requires GOOGLE_PLACES_API_KEY (Geocoding API enabled). Idempotent: it only
 * touches rows where latitude or longitude is null, so it is safe to re-run.
 */
import { PrismaClient } from '@prisma/client';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';
const prisma = new PrismaClient();

const apply = process.argv.includes('--apply');
const apiKey = (process.env.GOOGLE_PLACES_API_KEY ?? '').trim();

async function geocode(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    status?: string;
    results?: { geometry?: { location?: { lat: number; lng: number } } }[];
  };
  const loc = data.results?.[0]?.geometry?.location;
  return data.status === 'OK' && loc ? loc : null;
}

async function main() {
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not set — cannot geocode. Aborting.');
    process.exit(1);
  }

  const rows = await prisma.pharmacy.findMany({
    where: { OR: [{ latitude: null }, { longitude: null }] },
    select: {
      id: true, name: true, addressLine1: true, city: true,
      region: true, postalCode: true, country: true, verificationStatus: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`${rows.length} pharmac${rows.length === 1 ? 'y' : 'ies'} without coordinates.`);
  if (!apply) console.log('DRY RUN — pass --apply to write.\n');

  let located = 0;
  let skipped = 0;

  for (const p of rows) {
    const address = [p.addressLine1, p.city, p.region, p.postalCode, p.country]
      .filter(Boolean)
      .join(', ')
      .trim();

    if (!address) {
      console.log(`  SKIP  ${p.name} — no address to geocode`);
      skipped += 1;
      continue;
    }

    const point = await geocode(address);
    if (!point) {
      console.log(`  MISS  ${p.name} — "${address}" did not geocode`);
      skipped += 1;
      continue;
    }

    console.log(
      `  OK    ${p.name} [${p.verificationStatus}] → ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`,
    );
    if (apply) {
      await prisma.pharmacy.update({
        where: { id: p.id },
        data: { latitude: point.lat, longitude: point.lng },
      });
    }
    located += 1;

    // Stay well inside Google's rate limits on large estates.
    await new Promise((resolve) => setTimeout(resolve, 120));
  }

  console.log(`\nLocated ${located}, skipped ${skipped}.`);
  if (!apply && located > 0) console.log('Re-run with --apply to persist.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
