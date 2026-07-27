import { findTemplate } from './catalog';
import {
  renderTemplate,
  TemplateRenderError,
  type RenderContext,
} from './template.renderer';
import type { EmailTemplate } from './template.types';

const BASE_CTX: Omit<RenderContext, 'payload'> = {
  allowedLinkHosts: ['zoikomeds.com'],
  supportEmail: 'support@zoikomeds.com',
  supportCenterLink: 'https://app.zoikomeds.com/support',
};

function ctx(payload: Record<string, unknown>): RenderContext {
  return { ...BASE_CTX, payload };
}

const REG_004_PAYLOAD = {
  'Recipient First Name': 'Amara',
  'Organization Name': 'Northside Pharmacy',
  'Organization Type': 'Community pharmacy',
  'Registration Reference': 'ZM-REG-10241',
  'Submission Date': 'July 24, 2026',
  'Registration Status Link': 'https://app.zoikomeds.com/registration/10241',
};

function template(id: string): EmailTemplate {
  const found = findTemplate(id);
  if (!found) throw new Error(`fixture template ${id} missing`);
  return found;
}

describe('renderTemplate', () => {
  it('renders subject, preheader, HTML and a plain-text alternative', () => {
    const out = renderTemplate(template('REG-004'), ctx(REG_004_PAYLOAD));

    expect(out.subject).toBe("We've received your ZoikoMeds network registration");
    expect(out.html).toContain('Hello Amara,');
    expect(out.text).toContain('Hello Amara,');
    expect(out.html).toContain('Northside Pharmacy');
    expect(out.text).toContain('ZM-REG-10241');
    // Both alternatives are always produced.
    expect(out.html.length).toBeGreaterThan(0);
    expect(out.text.length).toBeGreaterThan(0);
  });

  it('leaves no unresolved placeholders in either alternative', () => {
    const out = renderTemplate(template('REG-004'), ctx(REG_004_PAYLOAD));
    expect(out.html).not.toMatch(/\{\{/);
    expect(out.text).not.toMatch(/\{\{/);
    expect(out.subject).not.toMatch(/\{\{/);
  });

  it('refuses to render when a required field is missing', () => {
    const payload = { ...REG_004_PAYLOAD };
    delete (payload as Record<string, unknown>)['Registration Reference'];

    expect(() => renderTemplate(template('REG-004'), ctx(payload))).toThrow(
      TemplateRenderError,
    );
    expect(() => renderTemplate(template('REG-004'), ctx(payload))).toThrow(
      /Registration Reference/,
    );
  });

  it('treats a blank required field as missing rather than rendering an empty gap', () => {
    const payload = { ...REG_004_PAYLOAD, 'Organization Name': '   ' };
    expect(() => renderTemplate(template('REG-004'), ctx(payload))).toThrow(
      /Organization Name/,
    );
  });

  it("resolves the {{Field or 'fallback'}} form when the value is absent", () => {
    const out = renderTemplate(
      template('REG-010'),
      ctx({
        'Recipient First Name': 'Amara',
        'Organization Name': 'Northside Pharmacy',
        'Registration Reference': 'ZM-REG-10241',
        'Decision Date': 'July 24, 2026',
        'Onboarding Link': 'https://app.zoikomeds.com/onboarding/10241',
        // 'Approval Conditions' deliberately omitted
      }),
    );
    expect(out.text).toContain('Approval conditions: None');
  });

  it('escapes HTML in merge data so payload content cannot inject markup', () => {
    const out = renderTemplate(
      template('REG-004'),
      ctx({
        ...REG_004_PAYLOAD,
        'Organization Name': '<script>alert(1)</script>Pharmacy',
      }),
    );
    expect(out.html).not.toContain('<script>');
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('rejects a CTA destination outside the approved hosts', () => {
    const payload = {
      ...REG_004_PAYLOAD,
      'Registration Status Link': 'https://evil.example.com/phish',
    };
    expect(() => renderTemplate(template('REG-004'), ctx(payload))).toThrow(
      /not an approved destination/,
    );
  });

  it('rejects a non-https CTA destination', () => {
    const payload = {
      ...REG_004_PAYLOAD,
      'Registration Status Link': 'http://app.zoikomeds.com/registration/10241',
    };
    expect(() => renderTemplate(template('REG-004'), ctx(payload))).toThrow(
      /must use https/,
    );
  });

  it('accepts a subdomain of an approved host', () => {
    const payload = {
      ...REG_004_PAYLOAD,
      'Registration Status Link': 'https://portal.zoikomeds.com/registration/1',
    };
    expect(() => renderTemplate(template('REG-004'), ctx(payload))).not.toThrow();
  });

  it('refuses to emit a payload that looks like a credential', () => {
    const payload = {
      ...REG_004_PAYLOAD,
      'Organization Type': 'password: hunter2',
    };
    expect(() => renderTemplate(template('REG-004'), ctx(payload))).toThrow(
      /must never be emailed/,
    );
  });

  it('refuses to emit a payload containing a payment card number', () => {
    const payload = { ...REG_004_PAYLOAD, 'Organization Type': '4111111111111111' };
    expect(() => renderTemplate(template('REG-004'), ctx(payload))).toThrow(
      /payment card number/,
    );
  });

  it('enforces the administrator-entered length limit', () => {
    const payload = { ...REG_004_PAYLOAD, 'Organization Type': 'x'.repeat(2001) };
    expect(() => renderTemplate(template('REG-004'), ctx(payload))).toThrow(
      /exceeds the 2000-character limit/,
    );
  });

  it('hides a conditional CTA when its visibility flag is not set', () => {
    const payload = {
      'Recipient First Name': 'Amara',
      'Organization Name': 'Northside Pharmacy',
      'Registration Reference': 'ZM-REG-10241',
      'Decision Date': 'July 24, 2026',
      'Decision Reason Category': 'Licensing evidence incomplete',
      'Applicant-Facing Decision Explanation':
        'The submitted permit could not be validated against the issuing register.',
      // No reapplication pathway, and therefore no decision-details link.
    };
    const out = renderTemplate(template('REG-011'), ctx(payload));
    expect(out.html).not.toContain('View decision details');
    expect(out.text).not.toContain('VIEW DECISION DETAILS');
  });

  it('shows the conditional CTA when a reapplication pathway exists', () => {
    const out = renderTemplate(
      template('REG-011'),
      ctx({
        'Recipient First Name': 'Amara',
        'Organization Name': 'Northside Pharmacy',
        'Registration Reference': 'ZM-REG-10241',
        'Decision Date': 'July 24, 2026',
        'Decision Reason Category': 'Licensing evidence incomplete',
        'Applicant-Facing Decision Explanation': 'The permit could not be validated.',
        'Reapplication Pathway Available': true,
        'Decision Details Link': 'https://app.zoikomeds.com/decisions/10241',
      }),
    );
    expect(out.html).toContain('View decision details');
  });

  it('carries the healthcare and network-status qualifications on the approval notice', () => {
    const out = renderTemplate(
      template('REG-010'),
      ctx({
        'Recipient First Name': 'Amara',
        'Organization Name': 'Northside Pharmacy',
        'Registration Reference': 'ZM-REG-10241',
        'Decision Date': 'July 24, 2026',
        'Onboarding Link': 'https://app.zoikomeds.com/onboarding/10241',
      }),
    );
    expect(out.text).toContain(
      'does not replace any license, permit, professional authorization',
    );
  });

  it('labels the stream in the footer', () => {
    const out = renderTemplate(template('REG-004'), ctx(REG_004_PAYLOAD));
    expect(out.text).toContain('automated ZoikoMeds service communication');
  });

  it('renders a hidden preheader that differs from the subject', () => {
    const out = renderTemplate(template('REG-004'), ctx(REG_004_PAYLOAD));
    expect(out.preheader).not.toBe(out.subject);
    expect(out.html).toContain(out.preheader);
  });

  it('renders every authored template against a permissive payload', () => {
    // Smoke test: catches a template whose copy references a placeholder it
    // never declared as required.
    for (const tpl of [
      'REG-001',
      'REG-002',
      'REG-003',
      'REG-005',
      'REG-006',
      'REG-007',
      'REG-008',
      'REG-009',
      'REG-012',
    ]) {
      const t = template(tpl);
      const payload: Record<string, unknown> = {
        'Recipient First Name': 'Amara',
      };
      for (const field of t.requiredFields) {
        payload[field] = field.endsWith('Link')
          ? 'https://app.zoikomeds.com/x'
          : `value-for-${field}`;
      }
      expect(() => renderTemplate(t, ctx(payload))).not.toThrow();
    }
  });
});
