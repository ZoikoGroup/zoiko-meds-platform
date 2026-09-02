import { ReportScope, ReportType } from '@prisma/client';

/**
 * What a report is for, said on the report itself.
 *
 * A generated export used to carry its own metadata and the governance rules it
 * was produced under, and nothing about why anyone would read it. Someone
 * handed the PDF a week later had the title, the scope and four compliance
 * bullets to work out its purpose from.
 *
 * The wording is derived from the report's own type and scope rather than
 * written once and reused, because those two fields are what actually decide
 * what the export contains. It is deterministic text keyed on real enum values
 * — no model writes any of it.
 */

/** The uses every governed export supports, whatever it draws from. */
const COMMON_USES = [
  'operational monitoring',
  'data-quality review',
  'compliance and audit review',
  'management and executive reporting',
  'identifying areas that need investigation or improvement',
  'governed sharing of aggregate platform information',
];

/** What the report type is for, in the reader's terms. */
const TYPE_PURPOSE: Record<ReportType, string> = {
  EXECUTIVE_BRIEFING:
    'This report gives Super Admins a single view of platform scale and activity for management and board reporting.',
  REGIONAL_DIGEST:
    'This report summarises platform coverage by jurisdiction, so Super Admins can see where the network is established and where it is not.',
  GOVERNANCE_EXPORT:
    'This report is the governed record of an export: what was requested, by whom, and under which rules, for compliance and audit review.',
  NETWORK_REPORT:
    'This report describes the participating pharmacy network — how much of it is verified, active and reporting availability.',
  OPERATIONS:
    'This report supports day-to-day operational monitoring: what the platform is currently reporting to patients and what is waiting on someone.',
  DATA_QUALITY:
    'This report is for reviewing the quality, coverage and reliability of the governed data the platform publishes.',
  FORECAST:
    'This report type is intended for forward-looking demand and shortage projection.',
};

/** What the scope narrows the report to. */
const SCOPE_PURPOSE: Record<ReportScope, string> = {
  ALL: 'It covers every intelligence surface the platform holds — availability signals, the medicine catalog, the pharmacy network and recorded demand.',
  SIGNAL:
    'It is scoped to ZoikoSignal availability data: the confidence bands the platform publishes, how fresh those signals are, and which of them reach patients at all.',
  JURISDICTION:
    'It is scoped to jurisdictions: how many are configured and how much of the medicine catalog is governed by one.',
  NETWORK:
    'It is scoped to the partner pharmacy network: verification, participation and which pharmacies are contributing availability signals.',
}

/**
 * The one combination worth spelling out rather than composing.
 *
 * Data quality against ZoikoSignal is the report an operator actually reaches
 * for when availability looks wrong, and "review the quality of governed data,
 * scoped to signals" undersells what the sections below it contain.
 */
const SPECIFIC: Partial<Record<`${ReportType}:${ReportScope}`, string>> = {
  'DATA_QUALITY:SIGNAL':
    'This report helps Super Admins review the quality and reliability of ZoikoSignal availability data: identify stale or suppressed signals, understand how confidence is distributed across the estate, see how much of the medicine catalog and pharmacy network is actually covered, and support operational, compliance and management review.',
  'OPERATIONS:SIGNAL':
    'This report shows what ZoikoSignal is currently telling patients: how many signals are live, how many have gone stale against the freshness target, and how many are waiting on a pharmacy to confirm them.',
  'NETWORK_REPORT:NETWORK':
    'This report shows how much of the pharmacy network is verified, participating and actively reporting availability, so Super Admins can see the difference between pharmacies on record and pharmacies patients can rely on.',
};

/**
 * The Purpose / Intended Use paragraphs for a report.
 *
 * First the specific or composed statement of what this type and scope is for,
 * then the uses it supports, then the limit it is produced under — the limit
 * belongs here as well as in the governance block, because the reader deciding
 * whether they may forward the file is reading this section.
 */
export function reportPurpose(type: ReportType, scope: ReportScope): string[] {
  const specific = SPECIFIC[`${type}:${scope}`];
  const opening = specific ?? `${TYPE_PURPOSE[type]} ${SCOPE_PURPOSE[scope]}`;

  return [
    opening,
    `It can be used for: ${COMMON_USES.join('; ')}.`,
    'The report is aggregate-only. It does not expose patient data or exact pharmacy stock quantities.',
  ];
}
