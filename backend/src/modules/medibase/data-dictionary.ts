import {
  PrescriptionCategory,
  QualityState,
} from '@prisma/client';
import { IDENTIFIER_SYSTEMS, SUPPORTED_IDENTIFIER_SYSTEMS } from './identifier-systems';
import { QUALITY_STATE_TRANSITIONS } from './quality-state';

/**
 * MediBase™ data dictionary generator.
 *
 * Produces a machine- and human-readable description of the governed medicine
 * identity schema: field definitions, exposure classification (public vs
 * internal), enumerations, supported identifier systems, and the quality-state
 * transition graph. This is the "data dictionary generation" deliverable of the
 * MediBase phase and is served read-only from the API so integrators have a
 * single source of truth for the contract.
 */

// Version of the MediBase entity contract this dictionary describes. Bump when
// the public shape of MedicineEntity changes; mirrors MedicineEntity.schemaVersion.
export const MEDIBASE_SCHEMA_VERSION = 1;

export type FieldExposure = 'public' | 'internal';

export interface FieldDefinition {
  name: string;
  type: string;
  exposure: FieldExposure;
  description: string;
  nullable: boolean;
}

const MEDICINE_FIELDS: FieldDefinition[] = [
  { name: 'id', type: 'string (cuid)', exposure: 'public', nullable: false, description: 'Stable canonical identity key for the medicine entity.' },
  { name: 'canonicalName', type: 'string', exposure: 'public', nullable: false, description: 'Preferred display name for the medicine identity.' },
  { name: 'genericName', type: 'string', exposure: 'public', nullable: true, description: 'International non-proprietary / generic name.' },
  { name: 'brandNames', type: 'string[]', exposure: 'public', nullable: false, description: 'Known brand names associated with this identity.' },
  { name: 'manufacturer', type: 'string', exposure: 'public', nullable: true, description: 'Primary marketing-authorisation holder (public label).' },
  { name: 'description', type: 'string', exposure: 'public', nullable: true, description: 'Short public-safe description; no clinical guidance.' },
  { name: 'activeIngredient', type: 'string', exposure: 'public', nullable: true, description: 'Primary active ingredient (informational).' },
  { name: 'strength', type: 'string', exposure: 'public', nullable: true, description: 'Labeled strength, e.g. "650 mg", "100 U/mL".' },
  { name: 'dosageForm', type: 'string', exposure: 'public', nullable: true, description: 'Canonical dosage form, e.g. Tablet, Injection.' },
  { name: 'route', type: 'string', exposure: 'public', nullable: true, description: 'Route of administration (informational).' },
  { name: 'presentation', type: 'string', exposure: 'public', nullable: true, description: 'Pack/presentation descriptor.' },
  { name: 'atcCode', type: 'string', exposure: 'public', nullable: true, description: 'WHO ATC classification code.' },
  { name: 'prescriptionCategory', type: 'enum PrescriptionCategory', exposure: 'public', nullable: false, description: 'Regulatory supply category. Not a dispensing decision.' },
  { name: 'qualityState', type: 'enum QualityState', exposure: 'public', nullable: false, description: 'Data-quality classification of the identity.' },
  { name: 'isControlled', type: 'boolean', exposure: 'public', nullable: false, description: 'Whether the medicine is controlled/restricted (governs masking).' },
  { name: 'isSuppressed', type: 'boolean', exposure: 'internal', nullable: false, description: 'When true the entity is never returned on public surfaces.' },
  { name: 'schemaVersion', type: 'int', exposure: 'internal', nullable: false, description: 'Contract version of this entity record.' },
  { name: 'jurisdictionId', type: 'string', exposure: 'internal', nullable: true, description: 'Owning jurisdiction; scopes licensed data.' },
  { name: 'identifiers', type: 'IdentifierMapping[]', exposure: 'public', nullable: false, description: 'External identifier mappings (NDC, RxCUI, GTIN, …).' },
  { name: 'createdAt', type: 'datetime', exposure: 'internal', nullable: false, description: 'Record creation timestamp.' },
  { name: 'updatedAt', type: 'datetime', exposure: 'internal', nullable: false, description: 'Last modification timestamp.' },
];

function enumValues<T extends Record<string, string>>(e: T): string[] {
  return Object.values(e);
}

/**
 * Build the full data dictionary. Deterministic (no timestamps) so responses
 * are cacheable and diffable across deployments.
 */
export function buildDataDictionary() {
  return {
    schemaVersion: MEDIBASE_SCHEMA_VERSION,
    entity: 'MedicineEntity',
    governance: {
      note: 'MediBase provides medicine identity & normalization only. No clinical advice, substitution, prescribing, or dispensing eligibility is expressed or implied.',
      publicExposure: 'Fields marked internal are never returned on public surfaces. Entities with qualityState=SUPPRESSED (or isSuppressed=true) are excluded from all public responses.',
    },
    fields: MEDICINE_FIELDS,
    enums: {
      QualityState: enumValues(QualityState),
      PrescriptionCategory: enumValues(PrescriptionCategory),
    },
    qualityStateTransitions: QUALITY_STATE_TRANSITIONS,
    identifierSystems: SUPPORTED_IDENTIFIER_SYSTEMS.map((code) => ({
      code,
      label: IDENTIFIER_SYSTEMS[code].label,
      description: IDENTIFIER_SYSTEMS[code].description,
    })),
  };
}
