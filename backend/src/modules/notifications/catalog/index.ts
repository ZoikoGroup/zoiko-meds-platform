import type { EmailTemplate, RegisteredTemplate } from '../template.types';
import { DIRECTORY_BY_ID, TEMPLATE_DIRECTORY } from './directory';
import { REGISTRATION_TEMPLATES } from './registration';

/**
 * The notification catalog: the full 151-template directory, plus authored copy
 * for the templates that have passed acceptance.
 *
 * A template is dispatchable only when it appears in AUTHORED_TEMPLATES with
 * `active: true`. Everything else is registered for coverage tracking and
 * refuses to send — the engineering pack forbids activating a template before
 * its copy, triggers, suppression logic, owners, and test cases are complete.
 */

const AUTHORED: EmailTemplate[] = [...REGISTRATION_TEMPLATES];

// Fail fast at import time on a duplicate template ID or an authored template
// that is missing from the approved directory. Both are release-blocking.
const seen = new Set<string>();
for (const template of AUTHORED) {
  if (seen.has(template.id)) {
    throw new Error(`Duplicate notification template ID: ${template.id}`);
  }
  seen.add(template.id);

  const row = DIRECTORY_BY_ID.get(template.id);
  if (!row) {
    throw new Error(
      `Template ${template.id} is not present in the approved directory`,
    );
  }
  if (row.gate !== template.gate) {
    throw new Error(
      `Template ${template.id} gate ${template.gate} does not match directory gate ${row.gate}`,
    );
  }
  if (row.baseEvent !== template.baseEvent) {
    throw new Error(
      `Template ${template.id} base event ${template.baseEvent} does not match directory base event ${row.baseEvent}`,
    );
  }
}

export const AUTHORED_TEMPLATES = AUTHORED;

export const TEMPLATES_BY_ID = new Map<string, EmailTemplate>(
  AUTHORED.map((template) => [template.id, template]),
);

/** Look up an authored template. Returns undefined for registered-only IDs. */
export function findTemplate(id: string): EmailTemplate | undefined {
  return TEMPLATES_BY_ID.get(id);
}

/** Every directory row, including templates that have no copy yet. */
export function listDirectory(): RegisteredTemplate[] {
  return TEMPLATE_DIRECTORY;
}

/** Directory rows that have no authored copy — the outstanding work queue. */
export function listUnauthored(): RegisteredTemplate[] {
  return TEMPLATE_DIRECTORY.filter((row) => !TEMPLATES_BY_ID.has(row.id));
}

export { DIRECTORY_BY_ID, TEMPLATE_DIRECTORY };
export { SECTION_STREAM, SECTION_TITLE } from './directory';
