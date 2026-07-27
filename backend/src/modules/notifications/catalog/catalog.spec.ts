import { NotificationGate } from '@prisma/client';

import type { TemplateSection } from '../template.types';
import {
  AUTHORED_TEMPLATES,
  listDirectory,
  listUnauthored,
  TEMPLATE_DIRECTORY,
} from './index';

/**
 * Coverage guardrails for the ZM-NOT-EMAIL-02 directory.
 *
 * These assert the counts the document declares authoritative. A failure here
 * means the catalog has drifted from the approved register — either a template
 * was dropped or one was added without updating the document.
 */
describe('notification template directory', () => {
  it('contains exactly 151 deployable templates', () => {
    expect(TEMPLATE_DIRECTORY).toHaveLength(151);
  });

  it('matches the declared external / internal / commercial split', () => {
    const internal = TEMPLATE_DIRECTORY.filter((t) => t.section === 'ADM');
    const commercial = TEMPLATE_DIRECTORY.filter((t) => t.section === 'COM');
    const external = TEMPLATE_DIRECTORY.filter(
      (t) => t.section !== 'ADM' && t.section !== 'COM',
    );

    expect(external).toHaveLength(122);
    expect(internal).toHaveLength(13);
    expect(commercial).toHaveLength(16);
  });

  it('matches the per-section totals in the directory tables', () => {
    const expected: Record<TemplateSection, number> = {
      REG: 14,
      SEC: 15,
      ORG: 15,
      VER: 14,
      INV: 12,
      MED: 18,
      SUP: 10,
      PRI: 8,
      WEB: 10,
      OPS: 6,
      ADM: 13,
      COM: 16,
    };
    for (const [section, count] of Object.entries(expected)) {
      const actual = TEMPLATE_DIRECTORY.filter((t) => t.section === section);
      expect(`${section}=${actual.length}`).toBe(`${section}=${count}`);
    }
  });

  it('has no duplicate template identifiers', () => {
    const ids = TEMPLATE_DIRECTORY.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gates every internal alert as INTERNAL and every commercial template as CONDITIONAL', () => {
    for (const row of TEMPLATE_DIRECTORY) {
      if (row.section === 'ADM') {
        expect(row.gate).toBe(NotificationGate.INTERNAL);
      }
      if (row.section === 'COM') {
        expect(row.gate).toBe(NotificationGate.CONDITIONAL);
      }
    }
  });

  it('maps every variant suffix back to a base event that exists', () => {
    for (const row of TEMPLATE_DIRECTORY) {
      // "SEC-005A" -> base "SEC-005"; unsuffixed IDs are their own base event.
      expect(row.id.startsWith(row.baseEvent)).toBe(true);
      const suffix = row.id.slice(row.baseEvent.length);
      expect(suffix).toMatch(/^[A-D]?$/);
    }
  });
});

describe('authored templates', () => {
  it('are all present in the approved directory', () => {
    const directoryIds = new Set(TEMPLATE_DIRECTORY.map((t) => t.id));
    for (const template of AUTHORED_TEMPLATES) {
      expect(directoryIds.has(template.id)).toBe(true);
    }
  });

  it('declare copy and a distinct preheader', () => {
    for (const template of AUTHORED_TEMPLATES) {
      expect(template.copy).toBeDefined();
      expect(template.copy!.intro.length).toBeGreaterThan(0);
      expect(template.preheader.trim()).not.toBe(template.subject.trim());
    }
  });

  it('never use a vague call-to-action label', () => {
    const vague = /^(click here|here|learn more|go)$/i;
    for (const template of AUTHORED_TEMPLATES) {
      if (template.cta) {
        expect(template.cta.label).not.toMatch(vague);
      }
    }
  });

  it('are all active — an authored-but-inactive template is a release defect', () => {
    for (const template of AUTHORED_TEMPLATES) {
      expect(template.active).toBe(true);
    }
  });

  it('reports the remaining unauthored templates as outstanding work', () => {
    const outstanding = listUnauthored();
    expect(outstanding.length).toBe(
      listDirectory().length - AUTHORED_TEMPLATES.length,
    );
    // Nothing authored may appear in the outstanding queue.
    const authoredIds = new Set(AUTHORED_TEMPLATES.map((t) => t.id));
    for (const row of outstanding) {
      expect(authoredIds.has(row.id)).toBe(false);
    }
  });
});
