import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { countryDisplayName } from './countries';

/**
 * Ensures a Jurisdiction row exists for this alpha-2 country code and returns
 * its id.
 *
 * A pharmacy's own declared country is the only jurisdiction data this
 * platform actually has, so registering or editing a pharmacy is what
 * creates and assigns a jurisdiction — there is no separate
 * jurisdiction-management step, and none is needed (MSA-35). Before this,
 * Jurisdiction had zero rows in every deployment and nothing ever wrote to
 * it, so every pharmacy — and every medicine identity it reported — carried
 * `jurisdictionId: null` forever, and the MediBase dashboard's market counts
 * never moved off zero.
 *
 * `null` in, `null` out: a pharmacy with no recognisable country stays
 * without a jurisdiction rather than one being invented for it.
 */
export async function resolveJurisdictionId(
  db: PrismaService | Prisma.TransactionClient,
  alpha2: string | null | undefined,
): Promise<string | null> {
  if (!alpha2) return null;
  const jurisdiction = await db.jurisdiction.upsert({
    where: { code: alpha2 },
    create: { code: alpha2, name: countryDisplayName(alpha2) },
    update: {},
  });
  return jurisdiction.id;
}
