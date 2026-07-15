import { BadRequestException } from '@nestjs/common';
import { QualityState } from '@prisma/client';

/**
 * MediBase™ quality-state machine.
 *
 * Governs the lifecycle of a medicine identity's data-quality classification.
 * The canonical progression from the build plan is
 *   VERIFIED → NEEDS_REVIEW → DEPRECATED → SUPPRESSED
 * extended to cover the provenance states the schema carries
 * (PARTNER_SUPPLIED / MAPPED / INFERRED). Transitions are constrained so an
 * entity cannot skip governance review in an unsafe direction; every applied
 * transition is recorded in the medicine change-log.
 */

export const QUALITY_STATE_TRANSITIONS: Record<QualityState, QualityState[]> = {
  // Provenance / ingestion states can be promoted toward VERIFIED or held for review.
  INFERRED: ['MAPPED', 'PARTNER_SUPPLIED', 'NEEDS_REVIEW', 'VERIFIED', 'DEPRECATED', 'SUPPRESSED'],
  MAPPED: ['PARTNER_SUPPLIED', 'NEEDS_REVIEW', 'VERIFIED', 'INFERRED', 'DEPRECATED', 'SUPPRESSED'],
  PARTNER_SUPPLIED: ['MAPPED', 'NEEDS_REVIEW', 'VERIFIED', 'DEPRECATED', 'SUPPRESSED'],
  NEEDS_REVIEW: ['VERIFIED', 'MAPPED', 'PARTNER_SUPPLIED', 'DEPRECATED', 'SUPPRESSED'],
  VERIFIED: ['NEEDS_REVIEW', 'DEPRECATED', 'SUPPRESSED'],
  // Retired states: a suppressed/deprecated entity can only re-enter via review.
  DEPRECATED: ['NEEDS_REVIEW', 'SUPPRESSED'],
  SUPPRESSED: ['NEEDS_REVIEW'],
};

/** States that must be hidden from every public/consumer surface. */
export const NON_PUBLIC_STATES: QualityState[] = ['SUPPRESSED'];

/** True if `to` is a permitted next state from `from` (self-transition allowed). */
export function canTransition(from: QualityState, to: QualityState): boolean {
  if (from === to) return true;
  return QUALITY_STATE_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throws a 400 unless the transition is permitted. */
export function assertTransition(from: QualityState, to: QualityState): void {
  if (!canTransition(from, to)) {
    const allowed = QUALITY_STATE_TRANSITIONS[from]?.join(', ') || 'none';
    throw new BadRequestException(
      `Illegal quality-state transition ${from} → ${to}. Allowed from ${from}: ${allowed}.`,
    );
  }
}

/**
 * Whether an entity in this state should carry `isSuppressed = true`. Keeps the
 * denormalized suppression flag consistent with the quality state.
 */
export function isSuppressedState(state: QualityState): boolean {
  return state === 'SUPPRESSED';
}
