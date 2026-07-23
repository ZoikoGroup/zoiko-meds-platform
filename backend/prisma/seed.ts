/**
 * Seeds the platform: SUPER_ADMIN + demo accounts, sample pharmacies,
 * verification requests, notifications and audit-log entries so the admin
 * console has real, dynamic data on first boot.
 *
 * Super-admin credentials come from the environment so no secret is committed:
 *   SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_NAME
 *
 * Run with: npm run prisma:seed
 */
import {
  AuditSeverity,
  AvailabilityConfidence,
  MedicinePriority,
  NotificationStatus,
  NotificationTarget,
  NotificationType,
  PrescriptionCategory,
  PrismaClient,
  QualityState,
  UserRole,
  VerificationRequestStatus,
  VerificationStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function upsertUser(
  email: string,
  fullName: string,
  password: string,
  role: UserRole,
) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email: email.toLowerCase() },
    update: { role, isActive: true, fullName },
    create: { email: email.toLowerCase(), fullName, passwordHash, role },
  });
}

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  // Demo data (sample pharmacies, medicines, demo logins) is DESTRUCTIVE — it
  // clears and reseeds tables. It only runs outside production, and can be
  // disabled anywhere by setting SEED_DEMO_DATA=false. Production seeding only
  // ever ensures the SUPER_ADMIN exists and never touches existing rows.
  const seedDemo = !isProd && process.env.SEED_DEMO_DATA !== 'false';

  // --- Super admin (from env) --------------------------------------------
  const superEmail = (process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@zoikomeds.io')
    .trim()
    .toLowerCase();
  const superPassword = process.env.SUPER_ADMIN_PASSWORD ?? '';
  if (isProd && (!superPassword || superPassword === 'ChangeMe!SuperAdmin1')) {
    throw new Error(
      'SUPER_ADMIN_PASSWORD must be set to a unique, strong value before seeding production.',
    );
  }
  const superAdmin = await upsertUser(
    superEmail,
    process.env.SUPER_ADMIN_NAME ?? 'ZoikoMeds Super Admin',
    superPassword || 'ChangeMe!SuperAdmin1',
    UserRole.SUPER_ADMIN,
  );
  console.log(`✔ Super admin ready: ${superAdmin.email}`);

  if (!seedDemo) {
    console.log(
      '• Skipping demo data (production or SEED_DEMO_DATA=false). Super admin ensured; no tables were cleared.',
    );
    return;
  }

  // --- Demo accounts (non-production only) --------------------------------
  const patient = await upsertUser(
    'john@example.com',
    'Naveen',
    'User@123',
    UserRole.PUBLIC,
  );

  // --- A spread of role demo users ---------------------------------------
  const demoUsers: Array<[string, string, UserRole]> = [
    ['admin@zoikomeds.io', 'Rafael Silva', UserRole.ADMIN],
    ['manager@zoikomeds.io', 'Keiko Tanaka', UserRole.PHARMACY_ADMIN],
    ['pharmacist@zoikomeds.io', 'Lena Hoffmann', UserRole.PHARMACY_STAFF],
    ['enterprise@zoikomeds.io', 'Marcus Bell', UserRole.ENTERPRISE],
    ['gov@zoikomeds.io', 'Priya Nair', UserRole.GOVERNMENT],
  ];
  for (const [email, name, role] of demoUsers) {
    await upsertUser(email, name, 'Passw0rd!', role);
  }
  console.log('✔ Demo users ready');

  // --- Pharmacies ---------------------------------------------------------
  // The first four are geolocated near the demo service area (Hyderabad) so the
  // patient portal map, distance and availability signals are fully dynamic.
  // The remainder give the admin console geographic variety.
  const pharmacySeed = [
    { name: 'Apollo Pharmacy', licenseNumber: 'LIC-HYD-01', addressLine1: 'Kompally Main Rd', city: 'Hyderabad', country: 'India', phone: '+91 40 2345 6789', latitude: 17.5480, longitude: 78.4181, reliabilityScore: 0.95, isParticipating: true, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'Netmeds Store', licenseNumber: 'LIC-HYD-02', addressLine1: 'Dundigal', city: 'Hyderabad', country: 'India', phone: '+91 40 4444 9090', latitude: 17.5561, longitude: 78.4285, reliabilityScore: 0.91, isParticipating: true, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'MedPlus', licenseNumber: 'LIC-HYD-03', addressLine1: 'Gandimaisamma X Roads', city: 'Hyderabad', country: 'India', phone: '+91 40 8765 4321', latitude: 17.5435, longitude: 78.4181, reliabilityScore: 0.66, isParticipating: true, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'Wellness Forever', licenseNumber: 'LIC-HYD-04', addressLine1: 'Bowrampet', city: 'Hyderabad', country: 'India', phone: '+91 40 5555 1212', latitude: 17.5375, longitude: 78.4181, reliabilityScore: 0.38, isParticipating: false, verificationStatus: VerificationStatus.PENDING },
    { name: 'Wellness Pharmacy', licenseNumber: 'LIC-1001', city: 'London', country: 'United Kingdom', latitude: 51.5074, longitude: -0.1278, reliabilityScore: 0.94, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'CarePoint Chemists', licenseNumber: 'LIC-1002', city: 'Manchester', country: 'United Kingdom', latitude: 53.4808, longitude: -2.2426, reliabilityScore: 0.82, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'MediTrust Drugstore', licenseNumber: 'LIC-1003', city: 'Dublin', country: 'Ireland', latitude: 53.3498, longitude: -6.2603, reliabilityScore: 0.61, verificationStatus: VerificationStatus.PENDING },
    { name: 'HealthFirst Pharmacy', licenseNumber: 'LIC-1004', city: 'New York', country: 'United States', latitude: 40.7128, longitude: -74.006, reliabilityScore: 0.9, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'GreenCross Meds', licenseNumber: 'LIC-1005', city: 'Toronto', country: 'Canada', latitude: 43.6532, longitude: -79.3832, reliabilityScore: 0.45, verificationStatus: VerificationStatus.PENDING },
    { name: 'Sunrise Pharmacy', licenseNumber: 'LIC-1006', city: 'Sydney', country: 'Australia', latitude: -33.8688, longitude: 151.2093, reliabilityScore: 0.3, verificationStatus: VerificationStatus.SUSPENDED },
  ];
  // Idempotent: clear and reseed pharmacies + everything that depends on them.
  await prisma.signalEvent.deleteMany({});
  await prisma.signalAggregate.deleteMany({});
  await prisma.availabilitySignal.deleteMany({});
  await prisma.savedMedicine.deleteMany({});
  await prisma.verificationRequest.deleteMany({});
  await prisma.medicineEntity.deleteMany({});
  await prisma.pharmacy.deleteMany({});
  const pharmacies = [];
  for (const p of pharmacySeed) {
    pharmacies.push(await prisma.pharmacy.create({ data: p }));
  }
  const pharmacyByName = Object.fromEntries(pharmacies.map((p) => [p.name, p]));
  console.log(`✔ ${pharmacies.length} pharmacies ready`);

  // Associate demo pharmacy users (manager & pharmacist) with Apollo Pharmacy
  const apollo = pharmacyByName['Apollo Pharmacy'];
  if (apollo) {
    await prisma.user.updateMany({
      where: { email: { in: ['manager@zoikomeds.io', 'pharmacist@zoikomeds.io'] } },
      data: { pharmacyId: apollo.id },
    });
  }

  // --- MediBase™ medicines + ZoikoAvail™ signals -------------------------
  // Confidence bands (HIGH/MODERATE/LOW) are the public-safe signal — never
  // exact stock. computedAt drives the "last confirmed" freshness display.
  const min = (n: number) => new Date(Date.now() - n * 60_000);
  const C = AvailabilityConfidence;

  type MedSeed = {
    canonicalName: string;
    genericName: string;
    manufacturer: string;
    description: string;
    strength: string;
    dosageForm: string;
    brandNames?: string[];
    rx: PrescriptionCategory;
    atcCode?: string;
    quality?: QualityState;
    controlled?: boolean;
    // External identifier mappings [system, value, qualityState?]
    identifiers?: Array<[string, string, QualityState?]>;
    signals: Array<[string, AvailabilityConfidence, number]>; // [pharmacyName, confidence, ageMinutes]
  };

  const medicineSeed: MedSeed[] = [
    {
      canonicalName: 'Dolo 650',
      genericName: 'Paracetamol',
      manufacturer: 'Micro Labs Ltd',
      description:
        'Analgesic and antipyretic used for mild-to-moderate pain and fever.',
      strength: '650 mg',
      dosageForm: 'Tablet',
      brandNames: ['Dolo 650'],
      rx: PrescriptionCategory.OTC,
      atcCode: 'N02BE01',
      identifiers: [
        ['ATC', 'N02BE01', QualityState.VERIFIED],
        ['RXCUI', '198440'],
      ],
      signals: [
        ['Apollo Pharmacy', C.HIGH, 2],
        ['Netmeds Store', C.HIGH, 40],
        ['MedPlus', C.MODERATE, 180],
      ],
    },
    {
      canonicalName: 'Paracetamol 500 mg',
      genericName: 'Paracetamol',
      manufacturer: 'GSK',
      description:
        'Common over-the-counter analgesic and fever reducer.',
      strength: '500 mg',
      dosageForm: 'Tablet',
      rx: PrescriptionCategory.OTC,
      signals: [
        ['MedPlus', C.MODERATE, 90],
        ['Netmeds Store', C.HIGH, 15],
      ],
    },
    {
      canonicalName: 'Metformin 500 mg',
      genericName: 'Metformin',
      manufacturer: 'Merck & Co',
      description: 'First-line oral therapy for type 2 diabetes.',
      strength: '500 mg',
      dosageForm: 'Extended-release tablet',
      rx: PrescriptionCategory.PRESCRIPTION,
      atcCode: 'A10BA02',
      identifiers: [
        ['ATC', 'A10BA02', QualityState.VERIFIED],
        ['RXCUI', '860975'],
      ],
      signals: [
        ['MedPlus', C.MODERATE, 180],
        ['Apollo Pharmacy', C.HIGH, 25],
      ],
    },
    {
      canonicalName: 'Insulin Glargine',
      genericName: 'Insulin glargine',
      manufacturer: 'Sanofi',
      description:
        'Long-acting insulin analogue for type 1 and type 2 diabetes.',
      strength: '100 U/mL',
      dosageForm: 'Injection pen',
      brandNames: ['Lantus', 'Basaglar'],
      rx: PrescriptionCategory.PRESCRIPTION,
      signals: [['Wellness Forever', C.LOW, 4320]],
    },
    {
      canonicalName: 'Lantus Pen',
      genericName: 'Insulin glargine',
      manufacturer: 'Sanofi',
      description: 'Branded insulin glargine pre-filled pen.',
      strength: '100 U/mL',
      dosageForm: 'Injection pen',
      brandNames: ['Lantus'],
      rx: PrescriptionCategory.PRESCRIPTION,
      signals: [['Apollo Pharmacy', C.HIGH, 20]],
    },
    {
      canonicalName: 'Basaglar Pen',
      genericName: 'Insulin glargine',
      manufacturer: 'Eli Lilly',
      description: 'Branded insulin glargine pre-filled pen.',
      strength: '100 U/mL',
      dosageForm: 'Injection pen',
      brandNames: ['Basaglar'],
      rx: PrescriptionCategory.PRESCRIPTION,
      signals: [['Netmeds Store', C.MODERATE, 70]],
    },
    {
      canonicalName: 'Cetirizine 10 mg',
      genericName: 'Cetirizine',
      manufacturer: 'Johnson & Johnson',
      description: 'Second-generation antihistamine for allergy symptoms.',
      strength: '10 mg',
      dosageForm: 'Tablet',
      rx: PrescriptionCategory.OTC,
      signals: [
        ['Netmeds Store', C.HIGH, 60],
        ['Apollo Pharmacy', C.HIGH, 12],
      ],
    },
    {
      canonicalName: 'Azithromycin 500 mg',
      genericName: 'Azithromycin',
      manufacturer: 'Pfizer',
      description: 'Macrolide antibiotic for bacterial infections.',
      strength: '500 mg',
      dosageForm: 'Tablet',
      rx: PrescriptionCategory.PRESCRIPTION,
      signals: [['Apollo Pharmacy', C.HIGH, 8]],
    },
    {
      canonicalName: 'Pantoprazole 40 mg',
      genericName: 'Pantoprazole',
      manufacturer: 'Sun Pharma',
      description: 'Proton-pump inhibitor for acid reflux and ulcers.',
      strength: '40 mg',
      dosageForm: 'Gastro-resistant tablet',
      rx: PrescriptionCategory.PRESCRIPTION,
      signals: [['Netmeds Store', C.MODERATE, 130]],
    },
    {
      canonicalName: 'Amoxicillin 500 mg',
      genericName: 'Amoxicillin',
      manufacturer: 'Cipla',
      description: 'Penicillin-class antibiotic for bacterial infections.',
      strength: '500 mg',
      dosageForm: 'Capsule',
      rx: PrescriptionCategory.PRESCRIPTION,
      atcCode: 'J01CA04',
      identifiers: [['ATC', 'J01CA04', QualityState.VERIFIED]],
      signals: [
        ['MedPlus', C.LOW, 300],
        ['Wellness Forever', C.UNKNOWN, 5000],
      ],
    },
    {
      // NEEDS_REVIEW: freshly ingested, not yet curator-verified. Still public.
      canonicalName: 'Ibuprofen 400 mg',
      genericName: 'Ibuprofen',
      manufacturer: 'Abbott',
      description: 'NSAID for pain, inflammation and fever.',
      strength: '400 mg',
      dosageForm: 'Tablet',
      rx: PrescriptionCategory.OTC,
      atcCode: 'M01AE01',
      quality: QualityState.NEEDS_REVIEW,
      identifiers: [['ATC', 'M01AE01', QualityState.INFERRED]],
      signals: [['MedPlus', C.MODERATE, 150]],
    },
    {
      // SUPPRESSED: must NEVER appear on public search / match / lookup surfaces.
      canonicalName: 'Zolpidem 10 mg',
      genericName: 'Zolpidem',
      manufacturer: 'Sanofi',
      description: 'Controlled sedative-hypnotic — suppressed on public surfaces.',
      strength: '10 mg',
      dosageForm: 'Tablet',
      rx: PrescriptionCategory.CONTROLLED,
      atcCode: 'N05CF02',
      quality: QualityState.SUPPRESSED,
      controlled: true,
      identifiers: [['ATC', 'N05CF02', QualityState.VERIFIED]],
      signals: [],
    },
  ];

  let signalCount = 0;
  const medicineByName: Record<string, { id: string; jurisdictionId: string | null }> = {};
  for (const m of medicineSeed) {
    const quality = m.quality ?? QualityState.VERIFIED;
    const medicine = await prisma.medicineEntity.create({
      data: {
        canonicalName: m.canonicalName,
        genericName: m.genericName,
        manufacturer: m.manufacturer,
        description: m.description,
        strength: m.strength,
        dosageForm: m.dosageForm,
        brandNames: m.brandNames ?? [],
        activeIngredient: m.genericName,
        atcCode: m.atcCode ?? null,
        prescriptionCategory: m.rx,
        qualityState: quality,
        isControlled: m.controlled ?? false,
        isSuppressed: quality === QualityState.SUPPRESSED,
        identifiers: m.identifiers?.length
          ? {
              create: m.identifiers.map(([system, value, qs]) => ({
                system,
                value,
                qualityState: qs ?? QualityState.MAPPED,
              })),
            }
          : undefined,
      },
    });
    medicineByName[m.canonicalName] = {
      id: medicine.id,
      jurisdictionId: medicine.jurisdictionId,
    };
    for (const [pharmacyName, confidence, age] of m.signals) {
      const pharmacy = pharmacyByName[pharmacyName];
      if (!pharmacy) continue;
      await prisma.availabilitySignal.create({
        data: {
          medicineId: medicine.id,
          pharmacyId: pharmacy.id,
          confidence,
          freshnessMinutes: age,
          requiresConfirmation: confidence !== C.HIGH,
          computedAt: min(age),
        },
      });
      signalCount++;
    }
  }
  console.log(
    `✔ ${medicineSeed.length} medicines + ${signalCount} availability signals ready`,
  );

  // --- Patient saved medicines (ZoikoSignal™ personal surface) ------------
  // Give the demo patient a spread of statuses so the patient ZoikoSignal page
  // has real, dynamic content. `notifiedStatus` seeds a prior state so the
  // generator emits a "back in stock" transition on first load.
  // [canonicalName, priority, notifiedStatus?]
  const savedSeed: Array<[string, MedicinePriority, string?]> = [
    ['Amoxicillin 500 mg', MedicinePriority.HIGH],
    ['Insulin Glargine', MedicinePriority.HIGH],
    ['Pantoprazole 40 mg', MedicinePriority.MEDIUM],
    ['Dolo 650', MedicinePriority.MEDIUM, 'out-of-stock'], // → back in stock
    ['Metformin 500 mg', MedicinePriority.LOW],
  ];
  await prisma.savedMedicine.deleteMany({ where: { userId: patient.id } });
  let savedCount = 0;
  for (const [name, priority, notifiedStatus] of savedSeed) {
    const med = medicineByName[name];
    if (!med) continue;
    await prisma.savedMedicine.create({
      data: {
        userId: patient.id,
        medicineId: med.id,
        priority,
        notifiedStatus: notifiedStatus ?? null,
      },
    });
    savedCount++;
  }
  console.log(`✔ ${savedCount} saved medicines ready for ${patient.email}`);

  // --- ZoikoSignal™ intelligence -----------------------------------------
  // Time-bucketed, jurisdiction-scoped aggregate cells + a pool of raw
  // zero-result events. Cells with sampleSize below the k-anonymity threshold
  // (default 5) are marked suppressed so the intelligence API masks them.
  const K = Number(process.env.SIGNAL_K_ANONYMITY) || 5;
  const dayStart = (daysAgo: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    return d;
  };

  // [canonicalName, daysAgo, searchCount, zeroResultCount, restockEvents, confirmationCount]
  const aggregateSeed: Array<[string, number, number, number, number, number]> = [
    ['Dolo 650', 1, 120, 4, 3, 18],
    ['Dolo 650', 2, 95, 2, 2, 14],
    ['Metformin 500 mg', 1, 60, 9, 1, 7],
    ['Metformin 500 mg', 3, 48, 12, 0, 5],
    ['Amoxicillin 500 mg', 1, 40, 22, 0, 2], // high shortage pressure
    ['Insulin Glargine', 2, 30, 19, 0, 1], // high shortage pressure
    ['Cetirizine 10 mg', 1, 3, 1, 0, 0], // below k → suppressed
  ];

  let aggCount = 0;
  for (const [name, daysAgo, search, zero, restock, confirm] of aggregateSeed) {
    const med = medicineByName[name];
    if (!med) continue;
    const periodStart = dayStart(daysAgo);
    const periodEnd = new Date(periodStart.getTime() + 86_400_000);
    const sampleSize = search + zero + restock + confirm;
    await prisma.signalAggregate.create({
      data: {
        medicineId: med.id,
        jurisdictionId: med.jurisdictionId,
        bucket: 'DAY',
        periodStart,
        periodEnd,
        searchCount: search,
        zeroResultCount: zero,
        restockEvents: restock,
        confirmationCount: confirm,
        sampleSize,
        suppressed: sampleSize < K,
      },
    });
    aggCount++;
  }

  // Raw zero-result events for the "unmet demand" term ranking. Terms searched
  // at least K times surface; the rare one stays below threshold and is hidden.
  const zeroTerms: Array<[string, number]> = [
    ['ozempic', 9],
    ['wegovy', 6],
    ['mounjaro', 5],
    ['some rare compound', 2], // below k → never surfaced
  ];
  const zeroEvents = zeroTerms.flatMap(([term, n]) =>
    Array.from({ length: n }, () => ({
      type: 'ZERO_RESULT' as const,
      searchTerm: term,
      occurredAt: dayStart(1),
      aggregatedAt: dayStart(1),
    })),
  );
  await prisma.signalEvent.createMany({ data: zeroEvents });
  console.log(
    `✔ ZoikoSignal ready: ${aggCount} aggregate cells + ${zeroEvents.length} zero-result events`,
  );

  // --- Verification requests ---------------------------------------------
  const pending = pharmacies.filter(
    (p) => p.verificationStatus === VerificationStatus.PENDING,
  );
  await prisma.verificationRequest.createMany({
    data: [
      {
        pharmacyId: pending[0]?.id ?? null,
        pharmacyName: pending[0]?.name ?? 'MediTrust Drugstore',
        licenseNumber: pending[0]?.licenseNumber ?? 'LIC-1003',
        submittedBy: 'k.tanaka@zoikomeds.io',
        status: VerificationRequestStatus.PENDING,
        docName: 'license-scan.pdf',
        docUrl: '#',
      },
      {
        pharmacyId: pending[1]?.id ?? null,
        pharmacyName: pending[1]?.name ?? 'GreenCross Meds',
        licenseNumber: pending[1]?.licenseNumber ?? 'LIC-1005',
        submittedBy: 'l.hoffmann@zoikomeds.io',
        status: VerificationRequestStatus.UNDER_REVIEW,
        reviewer: 'Rafael Silva',
        docName: 'permit.pdf',
        docUrl: '#',
      },
      {
        pharmacyName: 'Apex Pharmacy',
        licenseNumber: 'LIC-2001',
        submittedBy: 'apex@partners.io',
        status: VerificationRequestStatus.ESCALATED,
        docName: 'application.pdf',
        docUrl: '#',
        notes: 'Escalated: license region mismatch, needs manual check.',
      },
    ],
  });
  console.log('✔ Verification requests ready');

  // --- Notifications ------------------------------------------------------
  await prisma.notification.deleteMany({});
  await prisma.notification.createMany({
    data: [
      { title: 'Platform v2.3 released', message: 'New availability engine is live.', type: NotificationType.PLATFORM_UPDATE, target: NotificationTarget.ALL_USERS, status: NotificationStatus.DISPATCHED, createdBy: superEmail },
      { title: 'Scheduled maintenance', message: 'Downtime Sunday 02:00–03:00 UTC.', type: NotificationType.MAINTENANCE, target: NotificationTarget.PHARMACY_MANAGERS, status: NotificationStatus.DISPATCHED, createdBy: superEmail },
      { title: 'Shortage alert: amoxicillin', message: 'Elevated shortage pressure in APAC.', type: NotificationType.EMERGENCY_ALERT, target: NotificationTarget.GOVERNMENT_PARTNERS, status: NotificationStatus.DRAFT, createdBy: superEmail },
      // Dispatched patient-facing broadcasts — fanned out to every patient's
      // ZoikoSignal feed as SAFETY / RECALL notifications.
      { title: 'Government safety advisory', message: 'A national health advisory has been issued for a medicine class you follow. Review the guidance.', type: NotificationType.EMERGENCY_ALERT, target: NotificationTarget.ALL_USERS, status: NotificationStatus.DISPATCHED, createdBy: superEmail },
      { title: 'Recall notice for batch #A2231', message: 'A manufacturer recall affects certain batches. Please check the batch number on your packaging.', type: NotificationType.EMERGENCY_ALERT, target: NotificationTarget.ALL_USERS, status: NotificationStatus.DISPATCHED, createdBy: superEmail },
    ],
  });
  console.log('✔ Notifications ready');

  // --- Seed a few audit-log entries --------------------------------------
  await prisma.auditLog.createMany({
    data: [
      { actorId: superAdmin.id, actorEmail: superAdmin.email, action: 'auth.login', entityType: 'Authentication', severity: AuditSeverity.INFO, ipAddress: '10.0.0.1' },
      { actorId: superAdmin.id, actorEmail: superAdmin.email, action: 'admin.seed', entityType: 'System Admin', severity: AuditSeverity.INFO, ipAddress: '10.0.0.1' },
    ],
  });
  console.log('✔ Audit log seeded');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
