/**
 * Promote directory records that had already earned the network classification.
 *
 * A preloaded pharmacy stays DIRECTORY_UNCLAIMED through verification on
 * purpose: approving a licence says the pharmacy exists, not that anybody has
 * taken responsibility for what it reports. Reporting stock is that act, so
 * PharmacyService.promoteClaimedByReporting() now promotes on the first
 * patient-visible signal.
 *
 * Rows that reported stock *before* that existed never got the promotion, and
 * the patient-visibility allowlist hides DIRECTORY_UNCLAIMED — so they are
 * verified, participating, holding real signals, and invisible. This is the
 * one-off pass for them (MSA-54).
 *
 *   cd backend
 *   npx ts-node scripts/backfill-claimed-classification.ts            # dry run
 *   npx ts-node scripts/backfill-claimed-classification.ts --apply    # write
 *
 * Reads DATABASE_URL from the environment, so point it at the database you mean
 * to change and check the banner it prints before answering the prompt.
 *
 * Idempotent, and deliberately unable to do more than one thing: the conditions
 * below are the same ones promoteClaimedByReporting() uses, and the update can
 * only ever match DIRECTORY_UNCLAIMED — so no other classification can be
 * downgraded or overwritten, and a second run promotes nothing.
 */
import {
  AvailabilityConfidence,
  CommercialClassification,
  Prisma,
  PrismaClient,
  VerificationStatus,
} from '@prisma/client';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');

/** The audit action this pass records, distinct from the automatic promotion. */
const ACTION = 'pharmacy.classification.backfill';

/**
 * Eligibility, stated once.
 *
 * Kept identical to promoteClaimedByReporting(): verified, participating, still
 * unclaimed, and holding at least one signal a patient could actually be shown.
 * A pharmacy whose only signals are SUPPRESSED has nothing to show and is not
 * promoted.
 */
const ELIGIBLE: Prisma.PharmacyWhereInput = {
  commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED,
  verificationStatus: VerificationStatus.VERIFIED,
  isParticipating: true,
  availabilitySignals: {
    some: { confidence: { not: AvailabilityConfidence.SUPPRESSED } },
  },
};

/** Which database this is about to read, without printing the credentials. */
function describeTarget(): string {
  const raw = process.env.DATABASE_URL ?? '';
  try {
    const url = new URL(raw);
    return `${url.host}${url.pathname}`;
  } catch {
    return '(DATABASE_URL not set or unparseable)';
  }
}

async function main(): Promise<void> {
  console.log(`Target database : ${describeTarget()}`);
  console.log(`Mode            : ${apply ? 'APPLY — rows will be written' : 'dry run'}\n`);

  const eligible = await prisma.pharmacy.findMany({
    where: ELIGIBLE,
    select: { id: true, name: true, city: true, country: true },
    orderBy: { name: 'asc' },
  });

  // Counted separately so the report distinguishes "left alone on purpose"
  // from "nothing to do".
  const [unclaimedTotal, alreadyNetwork] = await Promise.all([
    prisma.pharmacy.count({
      where: { commercialClassification: CommercialClassification.DIRECTORY_UNCLAIMED },
    }),
    prisma.pharmacy.count({
      where: { commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE },
    }),
  ]);

  console.log(`DIRECTORY_UNCLAIMED rows      : ${unclaimedTotal}`);
  console.log(`  of which eligible           : ${eligible.length}`);
  console.log(`  of which left alone         : ${unclaimedTotal - eligible.length}`);
  console.log(`Already VERIFIED_NETWORK_CORE : ${alreadyNetwork}\n`);

  if (eligible.length === 0) {
    console.log('Nothing to promote.');
    return;
  }

  console.log('Would promote:');
  for (const p of eligible) {
    const where = [p.city, p.country].filter(Boolean).join(', ');
    console.log(`  ${p.id}  ${p.name}${where ? `  (${where})` : ''}`);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to persist.');
    return;
  }

  let promoted = 0;
  for (const p of eligible) {
    // Re-checked per row rather than one blanket update: the conditions are
    // evaluated again at write time, so a pharmacy that changed since the read
    // above — claimed by its owner, suspended, signals suppressed — is skipped
    // rather than promoted on stale information.
    const { count } = await prisma.pharmacy.updateMany({
      where: { id: p.id, ...ELIGIBLE },
      data: {
        commercialClassification: CommercialClassification.VERIFIED_NETWORK_CORE,
      },
    });

    if (count === 0) {
      console.log(`  skipped ${p.name} — no longer eligible`);
      continue;
    }

    // Same shape AuditWriter produces, with an action that says this was the
    // one-off pass and not the automatic promotion.
    await prisma.auditLog.create({
      data: {
        actorId: null,
        actorEmail: null,
        action: ACTION,
        entityType: 'Pharmacy',
        entityId: p.id,
        severity: 'INFO',
        metadata: {
          pharmacyId: p.id,
          pharmacyName: p.name,
          from: CommercialClassification.DIRECTORY_UNCLAIMED,
          to: CommercialClassification.VERIFIED_NETWORK_CORE,
          reason:
            'One-time backfill: pharmacy already had a patient-visible availability signal.',
          script: 'backfill-claimed-classification',
          module: 'Pharmacy Management',
        },
      },
    });
    promoted += 1;
  }

  console.log(`\nPromoted ${promoted} of ${eligible.length}.`);
  console.log(
    `Rollback: the promoted ids are in AuditLog where action = '${ACTION}'. See the script header.`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
