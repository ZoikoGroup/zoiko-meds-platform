import { CommercialClassification } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isCommerciallyEligibleForVisibility } from './commercial.doctrine';

/**
 * Whether a pharmacy's commercial standing currently entitles it to be shown to
 * patients, read from the subscription rows rather than from its classification.
 *
 * One function, used by every caller that has to answer this about a single
 * pharmacy already in hand — the operator's own portal and the Super Admin
 * console — for the same reason `isPatientVisible` exists next to
 * `publicPharmacyWhere`: the screen that tells somebody "patients can find you"
 * must be deciding it the same way the patient query does. A second copy here
 * would drift, and the drift is silent and in the worst direction.
 *
 * `releasedAt: null` is the only filter on the link rows: a released location is
 * one the subscription no longer covers. Which of the remaining subscriptions
 * entitles anything is decided by the doctrine, on dates and states, so a trial
 * that lapsed a second ago stops counting here without waiting for the
 * background job to rewrite the classification.
 */
export async function loadCommercialEligibility(
  prisma: PrismaService,
  pharmacyId: string,
  commercialClassification: CommercialClassification,
  now: Date = new Date(),
): Promise<boolean> {
  const links = await prisma.subscriptionLocation.findMany({
    where: { pharmacyId, releasedAt: null },
    select: { subscription: { select: { state: true, evaluationEndsAt: true } } },
  });

  return isCommerciallyEligibleForVisibility({
    commercialClassification,
    subscriptions: links.map((link) => link.subscription),
    now,
  });
}
