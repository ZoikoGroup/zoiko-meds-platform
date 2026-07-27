import { NotificationStream } from '@prisma/client';

import type { EmailTemplate } from './template.types';

/**
 * Renders a template into an accessible HTML body and a plain-text alternative.
 *
 * The renderer is deliberately strict. It refuses to emit a message when a
 * required field is missing, when a placeholder cannot be resolved, or when a
 * dynamic link points outside the approved destinations — a blank merge field in
 * a registration decision or a security notice is a defect, not a cosmetic
 * problem.
 */

export interface RenderContext {
  /** Validated merge data. Keys are placeholder names without braces. */
  payload: Record<string, unknown>;
  /** Hosts a dynamic link may point at. */
  allowedLinkHosts: string[];
  supportEmail: string;
  supportCenterLink: string;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

export class TemplateRenderError extends Error {
  constructor(
    readonly templateId: string,
    message: string,
  ) {
    super(`[${templateId}] ${message}`);
    this.name = 'TemplateRenderError';
  }
}

/** `{{Field}}` or `{{Field or 'fallback'}}`. */
const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;
/** Administrator-entered values are capped to keep layouts and logs sane. */
const MAX_FIELD_LENGTH = 2000;

/** Values that must never appear in an email body, whatever the payload says. */
const FORBIDDEN_FIELD_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bpassword\s*[:=]/i, label: 'password' },
  { pattern: /\b(otp|one[- ]time (?:code|password))\s*[:=]/i, label: 'one-time code' },
  { pattern: /\b\d{13,19}\b/, label: 'payment card number' },
  { pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, label: 'private key' },
];

export function renderTemplate(
  template: EmailTemplate,
  ctx: RenderContext,
): RenderedEmail {
  assertRequiredFields(template, ctx.payload);

  const resolve = (input: string) => interpolate(template, input, ctx);

  const subject = resolve(template.subject);
  const preheader = resolve(template.preheader);
  if (subject.trim() === preheader.trim()) {
    throw new TemplateRenderError(
      template.id,
      'preheader must add context, not repeat the subject',
    );
  }

  const copy = template.copy;
  if (!copy) {
    throw new TemplateRenderError(template.id, 'template has no authored copy');
  }

  const greetingName = String(ctx.payload['Recipient First Name'] ?? '').trim();
  const greeting = greetingName ? `Hello ${greetingName},` : 'Hello,';

  const intro = copy.intro.map(resolve).filter((line) => line.trim().length > 0);
  const nextSteps = (copy.nextSteps ?? []).map(resolve);
  const reference = (copy.reference ?? []).map((row) => ({
    label: row.label,
    value: resolve(row.value),
  }));
  const important = (copy.importantInformation ?? []).map(resolve);
  const closing = copy.closing ? resolve(copy.closing) : undefined;

  const cta = resolveCta(template, ctx, resolve);

  return {
    subject,
    preheader,
    html: buildHtml({
      template,
      subject,
      preheader,
      greeting,
      intro,
      nextSteps,
      reference,
      important,
      closing,
      cta,
      ctx,
    }),
    text: buildText({
      template,
      subject,
      preheader,
      greeting,
      intro,
      nextSteps,
      reference,
      important,
      closing,
      cta,
      ctx,
    }),
  };
}

// --- placeholder handling ----------------------------------------------------

function assertRequiredFields(
  template: EmailTemplate,
  payload: Record<string, unknown>,
): void {
  const missing = template.requiredFields.filter((field) => {
    const value = payload[field];
    return value === undefined || value === null || String(value).trim() === '';
  });
  if (missing.length > 0) {
    throw new TemplateRenderError(
      template.id,
      `missing required field(s): ${missing.join(', ')}`,
    );
  }
}

function interpolate(
  template: EmailTemplate,
  input: string,
  ctx: RenderContext,
): string {
  return input.replace(PLACEHOLDER, (_match, expression: string) => {
    const { field, fallback } = parseExpression(expression);

    const raw =
      field === 'Support Email'
        ? ctx.supportEmail
        : field === 'Support Center Link'
          ? ctx.supportCenterLink
          : ctx.payload[field];

    const value =
      raw === undefined || raw === null || String(raw).trim() === ''
        ? fallback
        : String(raw);

    if (value === undefined) {
      throw new TemplateRenderError(
        template.id,
        `unresolved placeholder "${field}" and no fallback declared`,
      );
    }

    return sanitizeFieldValue(template, field, value);
  });
}

/** Parses `Field` and `Field or 'fallback'` forms. */
function parseExpression(expression: string): {
  field: string;
  fallback?: string;
} {
  const match = expression.match(/^(.*?)\s+or\s+'(.*)'$/s);
  if (match) {
    return { field: match[1].trim(), fallback: match[2] };
  }
  return { field: expression.trim() };
}

function sanitizeFieldValue(
  template: EmailTemplate,
  field: string,
  value: string,
): string {
  if (value.length > MAX_FIELD_LENGTH) {
    throw new TemplateRenderError(
      template.id,
      `field "${field}" exceeds the ${MAX_FIELD_LENGTH}-character limit`,
    );
  }
  for (const { pattern, label } of FORBIDDEN_FIELD_PATTERNS) {
    if (pattern.test(value)) {
      throw new TemplateRenderError(
        template.id,
        `field "${field}" appears to contain a ${label}, which must never be emailed`,
      );
    }
  }
  // Strip control characters; HTML escaping happens at the render boundary.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\x00-\x1F\x7F]/g, '');
}

interface ResolvedCta {
  label: string;
  destination: string;
}

function resolveCta(
  template: EmailTemplate,
  ctx: RenderContext,
  resolve: (input: string) => string,
): ResolvedCta | undefined {
  if (!template.cta) return undefined;

  if (template.cta.visibleWhen) {
    const flag = ctx.payload[template.cta.visibleWhen];
    const visible =
      flag === true || (typeof flag === 'string' && flag.toLowerCase() === 'true');
    if (!visible) return undefined;
  }

  const destination = resolve(template.cta.destination);
  assertAllowedDestination(template, destination, ctx.allowedLinkHosts);
  return { label: resolve(template.cta.label), destination };
}

function assertAllowedDestination(
  template: EmailTemplate,
  destination: string,
  allowedHosts: string[],
): void {
  let url: URL;
  try {
    url = new URL(destination);
  } catch {
    throw new TemplateRenderError(
      template.id,
      `CTA destination "${destination}" is not an absolute URL`,
    );
  }
  if (url.protocol !== 'https:') {
    throw new TemplateRenderError(
      template.id,
      `CTA destination must use https, got "${url.protocol}"`,
    );
  }
  const permitted = allowedHosts.some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
  if (!permitted) {
    throw new TemplateRenderError(
      template.id,
      `CTA host "${url.hostname}" is not an approved destination`,
    );
  }
}

// --- output ------------------------------------------------------------------

interface BuildArgs {
  template: EmailTemplate;
  subject: string;
  preheader: string;
  greeting: string;
  intro: string[];
  nextSteps: string[];
  reference: Array<{ label: string; value: string }>;
  important: string[];
  closing?: string;
  cta?: ResolvedCta;
  ctx: RenderContext;
}

/** Footer text identifying the communication class, per the construction standard. */
function footerFor(stream: NotificationStream): string {
  switch (stream) {
    case NotificationStream.SECURITY:
      return 'This is an automated ZoikoMeds security communication. You cannot unsubscribe from messages required to protect your account.';
    case NotificationStream.LEGAL:
      return 'This is a required ZoikoMeds legal and privacy communication.';
    case NotificationStream.OPERATIONAL:
      return 'This is an automated ZoikoMeds service-status communication.';
    case NotificationStream.INTERNAL:
      return 'ZoikoMeds internal operational alert. Restricted to authorized personnel. Do not forward outside the organization.';
    case NotificationStream.MARKETING:
      return 'You are receiving this because you subscribed to ZoikoMeds updates. You may unsubscribe at any time.';
    case NotificationStream.TRANSACTIONAL:
    default:
      return 'This is an automated ZoikoMeds service communication.';
  }
}

function buildHtml(a: BuildArgs): string {
  const parts: string[] = [];

  parts.push(`<p>${esc(a.greeting)}</p>`);
  for (const line of a.intro) parts.push(`<p>${esc(line)}</p>`);

  if (a.nextSteps.length > 0) {
    parts.push('<h3 class="h3">Next steps</h3>');
    parts.push(
      `<ol class="steps">${a.nextSteps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`,
    );
  }

  if (a.reference.length > 0) {
    parts.push('<h3 class="h3">Reference details</h3>');
    const rows = a.reference
      .map(
        (r) =>
          `<tr><th scope="row" class="k">${esc(r.label)}</th><td class="v">${esc(r.value)}</td></tr>`,
      )
      .join('');
    parts.push(
      `<table role="presentation" class="ref" cellpadding="0" cellspacing="0"><tbody>${rows}</tbody></table>`,
    );
  }

  if (a.cta) {
    parts.push(
      `<p class="cta"><a class="btn" href="${escAttr(a.cta.destination)}">${esc(a.cta.label)}</a></p>`,
    );
  }

  if (a.important.length > 0) {
    parts.push('<h3 class="h3">Important information</h3>');
    for (const line of a.important) parts.push(`<p class="muted">${esc(line)}</p>`);
  }

  if (a.closing) parts.push(`<p>${esc(a.closing)}</p>`);

  parts.push('<p class="sig">ZoikoMeds Network Operations</p>');
  parts.push(
    `<p class="muted">For assistance, contact <a href="mailto:${escAttr(a.ctx.supportEmail)}">${esc(a.ctx.supportEmail)}</a> or visit <a href="${escAttr(a.ctx.supportCenterLink)}">the ZoikoMeds Support Center</a>.</p>`,
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(a.subject)}</title>
<style>
  body{margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a}
  .wrap{max-width:600px;margin:0 auto;padding:32px 16px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden}
  .head{background:#0f766e;padding:22px 28px;color:#fff}
  .head h1{margin:0;font-size:18px;font-weight:700;letter-spacing:-.01em}
  .body{padding:28px}
  .body p{font-size:14px;line-height:1.65;margin:0 0 12px}
  .h3{font-size:14px;margin:22px 0 8px;color:#0f172a}
  .steps{font-size:14px;line-height:1.65;padding-left:20px;margin:0 0 12px}
  .muted{color:#475569;font-size:12px!important;line-height:1.6!important}
  .sig{margin-top:22px!important;font-weight:600}
  .cta{margin:26px 0!important}
  .btn{display:inline-block;background:#0f766e;color:#fff!important;text-decoration:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:10px}
  .ref{width:100%;border-collapse:collapse;margin:12px 0 4px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px}
  .ref th,.ref td{padding:10px 14px;font-size:13px;border-bottom:1px solid #eef2f7;text-align:left}
  .ref tr:last-child th,.ref tr:last-child td{border-bottom:0}
  .ref .k{color:#475569;font-weight:500;width:42%}
  .ref .v{font-weight:600}
  .foot{padding:18px 28px;color:#64748b;font-size:11px;line-height:1.55;border-top:1px solid #eef2f7}
  .pre{display:none!important;visibility:hidden;opacity:0;height:0;width:0;overflow:hidden;mso-hide:all}
  a{color:#0f766e}
</style>
</head>
<body>
<div class="pre">${esc(a.preheader)}</div>
<div class="wrap"><div class="card">
  <div class="head"><h1>ZoikoMeds</h1></div>
  <main class="body">
    <h2 style="margin:0 0 16px;font-size:16px">${esc(a.template.title)}</h2>
    ${parts.join('\n    ')}
  </main>
  <div class="foot">${esc(footerFor(a.template.stream))}</div>
</div></div>
</body>
</html>`;
}

function buildText(a: BuildArgs): string {
  const lines: string[] = [];
  lines.push(a.greeting, '');
  for (const line of a.intro) lines.push(line, '');

  if (a.nextSteps.length > 0) {
    lines.push('NEXT STEPS');
    a.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('');
  }

  if (a.reference.length > 0) {
    lines.push('REFERENCE DETAILS');
    for (const r of a.reference) lines.push(`${r.label}: ${r.value}`);
    lines.push('');
  }

  if (a.cta) {
    lines.push(`${a.cta.label.toUpperCase()}: ${a.cta.destination}`, '');
  }

  if (a.important.length > 0) {
    lines.push('IMPORTANT INFORMATION');
    for (const line of a.important) lines.push(line);
    lines.push('');
  }

  if (a.closing) lines.push(a.closing, '');

  lines.push('ZoikoMeds Network Operations');
  lines.push(
    `For assistance, contact ${a.ctx.supportEmail} or visit ${a.ctx.supportCenterLink}.`,
  );
  lines.push('', footerFor(a.template.stream));

  return lines.join('\n');
}

function esc(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(input: string): string {
  return esc(input);
}
