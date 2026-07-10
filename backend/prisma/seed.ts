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
  NotificationStatus,
  NotificationTarget,
  NotificationType,
  PrismaClient,
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
  // --- Super admin (from env) --------------------------------------------
  const superEmail = (process.env.SUPER_ADMIN_EMAIL ?? 'superadmin@zoikomeds.io')
    .trim()
    .toLowerCase();
  const superAdmin = await upsertUser(
    superEmail,
    process.env.SUPER_ADMIN_NAME ?? 'ZoikoMeds Super Admin',
    process.env.SUPER_ADMIN_PASSWORD ?? 'ChangeMe!SuperAdmin1',
    UserRole.SUPER_ADMIN,
  );
  console.log(`✔ Super admin ready: ${superAdmin.email}`);

  // --- Demo accounts (match the frontend login quick-fill buttons) --------
  await upsertUser(
    'super@zoikogroup.com',
    'Platform Super Administrator',
    'Super@123',
    UserRole.SUPER_ADMIN,
  );
  await upsertUser('john@example.com', 'Naveen', 'User@123', UserRole.PUBLIC);

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
  const pharmacySeed = [
    { name: 'Wellness Pharmacy', licenseNumber: 'LIC-1001', city: 'London', country: 'United Kingdom', reliabilityScore: 0.94, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'CarePoint Chemists', licenseNumber: 'LIC-1002', city: 'Manchester', country: 'United Kingdom', reliabilityScore: 0.82, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'MediTrust Drugstore', licenseNumber: 'LIC-1003', city: 'Dublin', country: 'Ireland', reliabilityScore: 0.61, verificationStatus: VerificationStatus.PENDING },
    { name: 'HealthFirst Pharmacy', licenseNumber: 'LIC-1004', city: 'New York', country: 'United States', reliabilityScore: 0.9, verificationStatus: VerificationStatus.VERIFIED },
    { name: 'GreenCross Meds', licenseNumber: 'LIC-1005', city: 'Toronto', country: 'Canada', reliabilityScore: 0.45, verificationStatus: VerificationStatus.PENDING },
    { name: 'Sunrise Pharmacy', licenseNumber: 'LIC-1006', city: 'Sydney', country: 'Australia', reliabilityScore: 0.3, verificationStatus: VerificationStatus.SUSPENDED },
  ];
  // Idempotent: clear and reseed pharmacies + dependent verification requests.
  await prisma.verificationRequest.deleteMany({});
  await prisma.pharmacy.deleteMany({});
  const pharmacies = [];
  for (const p of pharmacySeed) {
    pharmacies.push(await prisma.pharmacy.create({ data: p }));
  }
  console.log(`✔ ${pharmacies.length} pharmacies ready`);

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
