import { AvailabilityConfidence } from '@prisma/client';
import { PatientSignalService } from './patient-signal.service';

/**
 * A saved-medicine card has to describe one place.
 *
 * The card states an availability band, an estimate of how long stock will
 * last, and the nearest pharmacy holding it — and only the last of those was
 * measured from the patient. So a patient in Delhi whose medicine was stocked
 * only in Hyderabad was shown "Running Low · 2–3 days" directly above "No
 * nearby pharmacy currently has this medicine": the band came from every
 * signal anywhere, the pharmacy line from the ones within 15 km, and the two
 * were describing different sets of pharmacies.
 *
 * Stock 1,200 km away is not stock the patient can act on, and how long it
 * will last there is not information about them.
 */

const USER = 'user_1';
const DELHI = { lat: 28.6139, lng: 77.209 };

const pharmacy = (over: Record<string, unknown> = {}) => ({
  id: 'ph_far',
  name: 'Apollo Kompally',
  // Hyderabad — ~1,250 km from Delhi.
  latitude: 17.5561,
  longitude: 78.4181,
  isParticipating: true,
  verificationStatus: 'VERIFIED',
  reliabilityScore: 0.8,
  locationPrecision: 'EXACT',
  ...over,
});

const signal = (over: Record<string, unknown> = {}) => ({
  id: 'sig_1',
  medicineId: 'med_1',
  pharmacyId: 'ph_far',
  confidence: AvailabilityConfidence.LOW,
  freshnessMinutes: null,
  requiresConfirmation: false,
  computedAt: new Date(),
  pharmacy: pharmacy(),
  ...over,
});

const savedRow = (signals: Record<string, unknown>[]) => ({
  id: 'saved_1',
  userId: USER,
  medicineId: 'med_1',
  medicineName: 'Dolo 650',
  priority: 'MEDIUM',
  notifiedStatus: null,
  createdAt: new Date(),
  medicine: {
    id: 'med_1',
    canonicalName: 'Dolo 650',
    genericName: 'Paracetamol',
    strength: '650 mg',
    availabilitySignals: signals,
  },
});

function buildService(
  rows: Record<string, unknown>[],
  origin: { lat: number; lng: number } | null,
) {
  const prisma = {
    savedMedicine: {
      findMany: jest.fn().mockResolvedValue(rows),
      update: jest.fn().mockResolvedValue({}),
    },
    signalNotification: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockResolvedValue({}),
    },
    medicineEntity: { findMany: jest.fn().mockResolvedValue([]) },
    notification: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const service = new PatientSignalService(prisma as never, {
    resolveOrigin: jest.fn().mockResolvedValue(origin),
  } as never);
  return { service, prisma };
}

describe('saved-medicine status is bounded by the same radius as its pharmacy list', () => {
  it('reads as out of stock when the only stocking pharmacy is out of range', async () => {
    const { service } = buildService([savedRow([signal()])], DELHI);

    const [row] = await service.savedStatus(USER, { ...DELHI, maxDistance: 15 });

    // Not "running low with 2-3 days left" — that describes a shelf in another
    // state. Nothing is reachable, and the card says so in both places.
    expect(row.status).toBe('out-of-stock');
    expect(row.nearest).toBeNull();
    expect(row.estDuration).toBeNull();
  });

  it('bands on the in-range pharmacy when both near and far ones stock it', async () => {
    const near = pharmacy({
      id: 'ph_near',
      name: 'Delhi Chemists',
      latitude: 28.62,
      longitude: 77.21,
    });
    const { service } = buildService(
      [
        savedRow([
          // Strongest signal, but a thousand kilometres away.
          signal({ id: 'sig_far', confidence: AvailabilityConfidence.HIGH }),
          signal({
            id: 'sig_near',
            pharmacyId: 'ph_near',
            confidence: AvailabilityConfidence.LOW,
            pharmacy: near,
          }),
        ]),
      ],
      DELHI,
    );

    const [row] = await service.savedStatus(USER, { ...DELHI, maxDistance: 15 });

    // The HIGH signal must not set the band for a patient who cannot reach it.
    expect(row.status).toBe('running-low');
    expect(row.nearest?.name).toBe('Delhi Chemists');
  });

  it('counts a medicine as low only when it is low within reach', async () => {
    const { service } = buildService([savedRow([signal()])], DELHI);

    const summary = await service.summary(USER, { ...DELHI, maxDistance: 15 });

    // The tile sits directly above the cards, so it counts what they count.
    expect(summary.runningLow).toBe(1);
  });

  it('keeps every signal in scope when the patient shared no location', async () => {
    const { service } = buildService([savedRow([signal()])], null);

    const [row] = await service.savedStatus(USER, {});

    // Nothing to measure from, so nothing can be excluded for being far. The
    // band is the network's, and the pharmacy is named without a distance.
    expect(row.status).toBe('running-low');
    expect(row.nearest?.name).toBe('Apollo Kompally');
    expect(row.nearest?.distance).toBeNull();
  });

  it('treats an unlocated pharmacy as out of reach, not nearby', async () => {
    const { service } = buildService(
      [savedRow([signal({ pharmacy: pharmacy({ latitude: null, longitude: null }) })])],
      DELHI,
    );

    const [row] = await service.savedStatus(USER, { ...DELHI, maxDistance: 15 });

    // Nobody knows where it is, so it cannot be counted as near this patient.
    expect(row.status).toBe('out-of-stock');
    expect(row.nearest).toBeNull();
  });

  it('marks a distance derived from an area-level pin as approximate', async () => {
    const near = pharmacy({
      id: 'ph_near',
      name: 'Delhi Chemists',
      latitude: 28.62,
      longitude: 77.21,
      locationPrecision: 'APPROXIMATE',
    });
    const { service } = buildService(
      [savedRow([signal({ pharmacyId: 'ph_near', pharmacy: near })])],
      DELHI,
    );

    const [row] = await service.savedStatus(USER, { ...DELHI, maxDistance: 15 });

    expect(row.nearest?.approximate).toBe(true);
  });
});

describe('availability alerts do not claim a proximity they cannot know', () => {
  it('describes a running-low medicine without asserting it is near the patient', async () => {
    // Regeneration runs on reads that carry no location at all, so the copy it
    // writes cannot be about where the patient is. It used to say "decreasing
    // near your location" about a pharmacy in another state.
    const { service, prisma } = buildService([savedRow([signal()])], null);

    await service.listNotifications(USER);

    const written = prisma.signalNotification.upsert.mock.calls[0][0];
    expect(written.create.description).not.toMatch(/near your location/i);
    expect(written.create.description).toMatch(/verified network/i);
  });
});
