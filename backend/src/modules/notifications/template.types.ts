import {
  NotificationChannel,
  NotificationGate,
  NotificationStream,
} from '@prisma/client';

/**
 * ZM-NOT-EMAIL-02 template contract.
 *
 * Every deployable template in the library is described by one of these records.
 * The shape encodes the document's construction standard (section 5) so a
 * template cannot be registered without the elements the standard requires:
 * a specific subject, a preheader that adds context, one principal CTA, the
 * minimum reference data, and any safety qualification.
 *
 * Copy lives here rather than in the database on purpose — template text is
 * reviewed, versioned, and released like code. The database records only what
 * was emitted.
 */

/** Section of the directory a template belongs to. */
export type TemplateSection =
  | 'REG'
  | 'SEC'
  | 'ORG'
  | 'VER'
  | 'INV'
  | 'MED'
  | 'SUP'
  | 'PRI'
  | 'WEB'
  | 'OPS'
  | 'ADM'
  | 'COM';

/**
 * A single row of the "Reference details" block. Values are placeholder
 * expressions resolved against the event payload.
 */
export interface ReferenceRow {
  label: string;
  value: string;
}

/** The one principal call to action. Supporting actions stay in the body copy. */
export interface TemplateCta {
  /** Descriptive label — never "click here" (accessibility rule). */
  label: string;
  /** Placeholder resolving to an authenticated destination. */
  destination: string;
  /**
   * When set, the CTA block is omitted unless this payload field is truthy.
   * REG-011 uses this: the reapplication CTA must be hidden when no review
   * pathway exists.
   */
  visibleWhen?: string;
}

export interface TemplateCopy {
  /** Opening line(s). Placeholders allowed. */
  intro: string[];
  /** Numbered "Next steps" list. Omit when the message requires no steps. */
  nextSteps?: string[];
  /** Reference details block — minimum identifiers needed to act or support. */
  reference?: ReferenceRow[];
  /**
   * Safety notice: security, privacy, medicine-availability, regulatory, or
   * commercial qualification. Required by the construction standard wherever a
   * claim could be over-read.
   */
  importantInformation?: string[];
  /** Closing line above the signature. */
  closing?: string;
}

export interface EmailTemplate {
  /** Deployable template ID, e.g. "SEC-005A". Unique across the library. */
  id: string;
  /** Approved base event the variant maps to, e.g. "SEC-005". */
  baseEvent: string;
  /** Template family, e.g. "REG-F01 Application Progress". */
  family: string;
  /** Directory section. */
  section: TemplateSection;
  /** Human title from the directory. */
  title: string;
  /** Release gate. Only released gates dispatch. */
  gate: NotificationGate;
  /** Delivery stream — drives sender, footer, and suppression policy. */
  stream: NotificationStream;
  /** Channels this template renders to. */
  channels: NotificationChannel[];
  /** Single authoritative trigger, stated in prose for the audit record. */
  trigger: string;
  /** Primary audience, e.g. "Primary contact". */
  audience: string;
  /**
   * How the recipient is resolved, e.g. "application.primaryContact". Recorded
   * on every delivery so a misdirected message is traceable.
   */
  recipientResolution: string;
  subject: string;
  /** Must add context rather than repeat the subject. */
  preheader: string;
  cta?: TemplateCta;
  /**
   * Placeholder names that must be present and non-empty in the payload. The
   * renderer refuses to render when any are missing.
   */
  requiredFields: string[];
  copy?: TemplateCopy;
  /** Copy revision. Bumped whenever the wording changes. */
  version: string;
  /**
   * False until the template has passed acceptance (copy, triggers, suppression
   * logic, owners, support route, test cases). Registered-but-inactive templates
   * are catalogued for coverage reporting but refuse to dispatch.
   */
  active: boolean;
}

/**
 * Catalog entry for a template whose metadata is approved but whose copy has not
 * yet been authored and accepted. Rule 10 of the engineering pack forbids
 * activating these, so they carry no copy and are always inactive.
 */
export type RegisteredTemplate = Pick<
  EmailTemplate,
  'id' | 'baseEvent' | 'title' | 'gate' | 'section'
>;
