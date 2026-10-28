/**
 * Report on — and, only when told to, grant — the initial 30-day trial for
 * pharmacies that joined the network before it was granted automatically.
 *
 * Why this exists: patient visibility requires a live trial or a paid term, and
 * until the trial was granted on network join (initial-evaluation.ts) nothing
 * created one unless an administrator did it by hand. Every pharmacy that
 * joined without that step holds no subscription at all, and is hidden.
 *
 *   cd backend
 *   npx ts-node scripts/backfill-initial-evaluations.ts                    # report only
 *   npx ts-node scripts/backfill-initial-evaluations.ts --apply            # grant
 *   npx ts-node scripts/backfill-initial-evaluations.ts --apply --limit=25 # staged
 *
 * Reads DATABASE_URL from the environment, so point it at the database you mean
 * to read, and check the banner before anything else. The report is read-only
 * and safe against a read replica or a read-only role; run it before deploying
 * the visibility change to see who it will hide.
 *
 * What --apply does, and cannot do. It runs the same grant as network join —
 * the same eligibility rule, imported rather than restated, under the same
 * per-pharmacy row lock — so it can only ever give a verified, listable,
 * operated VERIFIED_NETWORK_CORE pharmacy that has never held an Intelligence
 * Pro subscription its first trial, starting now. It never touches a live
 * trial, a paid term, a grace period, an enterprise or pilot pharmacy, and
 * never restarts or extends a trial that already ran. A second run grants
 * nothing. The same report and backfill are available to a Super Admin at
 * GET/POST /admin/commercial/evaluations/{remediation,backfill}.
 *
 * Rollback, if a grant was a mistake: each one is in AuditLog as
 * action = 'commercial.subscription.evaluation_start' with metadata.trigger =
 * 'backfill' and metadata.script = 'backfill-initial-evaluations'; its
 * entityId is the subscription. Ending that subscription (state CANCELED,
 * link released) and returning the pharmacy to VERIFIED_NETWORK_CORE undoes it.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import type { PrismaService } from '../src/prisma/prisma.service';
import type { AuditWriter } from '../src/modules/admin/audit.writer';
import { InitialEvaluationService } from '../src/modules/commercial/initial-evaluation.service';

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice('--limit='.length)) : undefined;

const SCRIPT = 'backfill-initial-evaluations';

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

/** Same shape AuditWriter produces, tagged so this pass can be found and undone. */
const audit = {
  async write(
    actorId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    metadata?: Prisma.InputJsonValue,
  ) {
    await prisma.auditLog.create({
      data: {
        actorId,
        actorEmail: null,
        action,
        entityType,
        entityId,
        severity: 'INFO',
        metadata: { ...((metadata as Prisma.JsonObject) ?? {}), script: SCRIPT },
      },
    });
  },
};

async function main(): Promise<void> {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive whole number.');
  }

  console.log(`Target database : ${describeTarget()}`);
  console.log(`Mode            : ${apply ? 'APPLY — trials will be granted' : 'report only (read-only)'}\n`);

  const service = new InitialEvaluationService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditWriter,
  );
  const report = await service.remediationReport();
  const t = report.totals;

  console.log(`Verified pharmacies                     : ${t.verified}`);
  console.log(`  participating (located)               : ${t.verifiedParticipating}`);
  console.log(`Listed under the safety gates alone     : ${t.visibleBefore}`);
  console.log(`Listed with commercial eligibility      : ${t.visibleAfter}`);
  console.log(`  hidden by the commercial rule         : ${t.hiddenByCommercialRule}`);
  console.log(`Would receive an initial trial          : ${t.backfillCandidates}`);
  console.log(`Listed after the backfill               : ${t.visibleAfterBackfill}\n`);

  console.log('By classification and standing (pharmacies / participating / before / after / after backfill):');
  for (const g of report.groups) {
    console.log(
      `  ${g.classification.padEnd(28)} ${g.standing.padEnd(26)} ` +
        `${g.pharmacies} / ${g.participating} / ${g.visibleBefore} / ${g.visibleAfter} / ${g.visibleAfterBackfill}`,
    );
  }

  if (report.hiddenWithoutBackfill.length > 0) {
    console.log('\nHidden, and not restored by the backfill (needs a decision):');
    for (const p of report.hiddenWithoutBackfill) {
      console.log(`  ${p.pharmacyId}  ${p.name}  [${p.standing}${p.reason ? `, ${p.reason}` : ''}]`);
    }
  }

  if (report.candidates.length === 0) {
    console.log('\nNo pharmacy qualifies for an initial trial. Nothing to grant.');
    return;
  }

  console.log('\nWould grant an initial trial to:');
  for (const p of report.candidates) console.log(`  ${p.pharmacyId}  ${p.name}`);

  if (!apply) {
    console.log('\nReport only. Re-run with --apply to grant.');
    return;
  }

  const result = await service.backfill({ actorId: null, dryRun: false, limit });
  for (const g of result.granted) {
    console.log(`  granted ${g.pharmacyId} — trial ends ${g.evaluationEndsAt}`);
  }
  for (const s of result.skipped) {
    console.log(`  skipped ${s.pharmacyId} — ${s.reason}`);
  }
  console.log(
    `\nGranted ${result.granted.length} of ${result.attempted} attempted (${result.candidates} eligible).`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
