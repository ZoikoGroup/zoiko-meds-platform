import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationStream } from '@prisma/client';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { appBaseUrl } from '../../config/app-urls';

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * Outbound mail for account lifecycle events (credentials, invites, password
 * resets, welcome). Uses SMTP when SMTP_HOST is configured; otherwise falls
 * back to a log-only transport so local development works without secrets
 * (the message — including any reset link — is written to the app log).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter: Transporter | null = null;
  private readonly enabled: boolean;
  private readonly fromAddress: string;
  private readonly fromName: string;
  private readonly appBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('SMTP_HOST');
    this.fromAddress =
      this.config.get<string>('SMTP_FROM_ADDRESS') ||
      this.config.get<string>('SMTP_USERNAME') ||
      'no-reply@zoikomeds.com';
    this.fromName = this.config.get<string>('SMTP_FROM_NAME') || 'ZoikoMeds';
    // Links in outbound mail must point at the SPA host, not the marketing site.
    this.appBaseUrl = appBaseUrl(this.config);
    this.enabled = Boolean(host);

    if (this.enabled) {
      const port = Number(this.config.get<string>('SMTP_PORT') ?? 465);
      const useTls =
        String(this.config.get<string>('SMTP_USE_TLS') ?? 'true') === 'true';
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: useTls, // implicit TLS on 465
        auth: {
          user: this.config.get<string>('SMTP_USERNAME'),
          pass: this.config.get<string>('SMTP_PASSWORD'),
        },
      });
      this.logger.log(`SMTP mailer enabled (${host}:${port})`);
    } else {
      this.logger.warn(
        'SMTP_HOST not set — using log-only mailer. Emails will be printed to the log, not sent.',
      );
    }
  }

  // --- public API ----------------------------------------------------------

  /** Notify a user that an admin provisioned their account, with temp password. */
  async sendAccountCredentials(params: {
    to: string;
    fullName: string;
    temporaryPassword: string;
    roleLabel: string;
  }): Promise<void> {
    const loginUrl = `${this.appBaseUrl}/login`;
    const body = `
      ${this.greeting(params.fullName)}
      <p>An administrator has created a ZoikoMeds account for you with the role
      <strong>${escapeHtml(params.roleLabel)}</strong>.</p>
      ${this.credBox(params.to, params.temporaryPassword)}
      <p>For your security, please sign in and change this password right away.</p>
      ${this.button(loginUrl, 'Sign in to ZoikoMeds')}
    `;
    await this.send({
      to: params.to,
      subject: 'Your ZoikoMeds account is ready',
      html: this.layout('Your account is ready', body),
      text: `An administrator created a ZoikoMeds account for you.\nEmail: ${params.to}\nTemporary password: ${params.temporaryPassword}\nSign in: ${loginUrl}\nPlease change your password after signing in.`,
    });
  }

  /** Invite link (no password) for admin-provisioned accounts using set-password flow. */
  async sendInvite(params: {
    to: string;
    fullName: string;
    token: string;
    roleLabel: string;
  }): Promise<void> {
    const link = `${this.appBaseUrl}/reset-password?token=${encodeURIComponent(params.token)}`;
    const body = `
      ${this.greeting(params.fullName)}
      <p>You have been invited to ZoikoMeds with the role
      <strong>${escapeHtml(params.roleLabel)}</strong>. Set a password to
      activate your account.</p>
      ${this.button(link, 'Set your password')}
      <p class="muted">This link expires in 24 hours. If you did not expect this
      invitation you can ignore this email.</p>
    `;
    await this.send({
      to: params.to,
      subject: 'You are invited to ZoikoMeds',
      html: this.layout('Activate your account', body),
      text: `You have been invited to ZoikoMeds.\nSet your password: ${link}\nThis link expires in 24 hours.`,
    });
  }

  /** Password reset link for the forgot-password flow. */
  async sendPasswordReset(params: {
    to: string;
    fullName: string;
    token: string;
  }): Promise<void> {
    const link = `${this.appBaseUrl}/reset-password?token=${encodeURIComponent(params.token)}`;
    const body = `
      ${this.greeting(params.fullName)}
      <p>We received a request to reset your ZoikoMeds password. Click below to
      choose a new one.</p>
      ${this.button(link, 'Reset password')}
      <p class="muted">This link expires in 1 hour. If you didn't request a
      reset, no action is needed — your password stays the same.</p>
    `;
    await this.send({
      to: params.to,
      subject: 'Reset your ZoikoMeds password',
      html: this.layout('Reset your password', body),
      text: `Reset your ZoikoMeds password: ${link}\nThis link expires in 1 hour. If you didn't request it, ignore this email.`,
    });
  }

  /** Welcome message on self-service registration. */
  async sendWelcome(params: { to: string; fullName: string }): Promise<void> {
    const body = `
      ${this.greeting(params.fullName)}
      <p>Welcome to ZoikoMeds — your governed view of medicine availability
      confidence from verified pharmacies.</p>
      <p>Search a medicine, save the ones you follow, and set alerts so we can
      tell you when availability confidence changes near you.</p>
      ${this.button(`${this.appBaseUrl}/dashboard`, 'Open ZoikoMeds')}
    `;
    await this.send({
      to: params.to,
      subject: 'Welcome to ZoikoMeds',
      html: this.layout('Welcome to ZoikoMeds', body),
      text: `Welcome to ZoikoMeds, ${params.fullName}! Open the app: ${this.appBaseUrl}/dashboard`,
    });
  }

  /**
   * Sends copy already rendered by the notification template library.
   *
   * Unlike the lifecycle helpers above, this throws on transport failure so the
   * caller can record the outcome on its delivery row. Streams are sent from
   * distinct senders so a complaint against one cannot degrade the others'
   * reputation.
   */
  async sendRendered(params: {
    to: string;
    subject: string;
    html: string;
    text: string;
    stream: NotificationStream;
  }): Promise<{ providerMessageId?: string }> {
    const sender = this.senderFor(params.stream);
    if (!this.transporter) {
      this.logger.log(
        `[log-only mail] stream=${params.stream} to=${params.to} subject="${params.subject}"\n${params.text}`,
      );
      return {};
    }
    const info = (await this.transporter.sendMail({
      from: sender,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      headers: { 'X-ZoikoMeds-Stream': params.stream },
    })) as { messageId?: string };
    this.logger.log(`Sent "${params.subject}" to ${params.to} [${params.stream}]`);
    return { providerMessageId: info?.messageId };
  }

  /**
   * Per-stream sender. Falls back to the default transactional identity when a
   * stream-specific address is not configured.
   */
  private senderFor(stream: NotificationStream): string {
    const key = `SMTP_FROM_${stream}`;
    const address = this.config.get<string>(key) || this.fromAddress;
    const name =
      stream === 'SECURITY'
        ? 'ZoikoMeds Security'
        : stream === 'LEGAL'
          ? 'ZoikoMeds Privacy and Legal'
          : stream === 'OPERATIONAL'
            ? 'ZoikoMeds Service Status'
            : stream === 'INTERNAL'
              ? 'ZoikoMeds Internal Alerts'
              : stream === 'MARKETING'
                ? 'ZoikoMeds Updates'
                : 'ZoikoMeds Network Operations';
    return `"${name}" <${address}>`;
  }

  // --- transport -----------------------------------------------------------

  private async send(args: SendArgs): Promise<void> {
    const from = `"${this.fromName}" <${this.fromAddress}>`;
    if (!this.transporter) {
      // Log-only fallback — surfaces links so dev flows still work.
      this.logger.log(
        `[log-only mail] to=${args.to} subject="${args.subject}"\n${args.text ?? args.html}`,
      );
      return;
    }
    try {
      await this.transporter.sendMail({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      });
      this.logger.log(`Sent "${args.subject}" to ${args.to}`);
    } catch (err) {
      // Never let a mail failure break the primary request (account created,
      // reset requested, etc.). Log and move on.
      this.logger.error(
        `Failed to send "${args.subject}" to ${args.to}: ${(err as Error).message}`,
      );
    }
  }

  // --- templates -----------------------------------------------------------

  private greeting(name?: string) {
    return `<p>Hi ${escapeHtml(name?.split(' ')[0] || 'there')},</p>`;
  }

  private credBox(email: string, password: string) {
    return `
      <table role="presentation" class="cred" cellpadding="0" cellspacing="0">
        <tr><td class="k">Email</td><td class="v">${escapeHtml(email)}</td></tr>
        <tr><td class="k">Temporary password</td><td class="v mono">${escapeHtml(password)}</td></tr>
      </table>`;
  }

  private button(href: string, label: string) {
    return `<p style="margin:28px 0"><a class="btn" href="${href}">${escapeHtml(label)}</a></p>`;
  }

  private layout(title: string, inner: string) {
    return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a}
  .wrap{max-width:560px;margin:0 auto;padding:32px 16px}
  .card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden}
  .head{background:#0f766e;padding:22px 28px;color:#fff}
  .head h1{margin:0;font-size:18px;font-weight:700;letter-spacing:-.01em}
  .body{padding:28px}
  .body p{font-size:14px;line-height:1.6;margin:0 0 12px}
  .muted{color:#64748b;font-size:12px!important}
  .btn{display:inline-block;background:#0f766e;color:#fff!important;text-decoration:none;font-weight:600;font-size:14px;padding:11px 20px;border-radius:10px}
  .cred{width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px}
  .cred td{padding:10px 14px;font-size:13px;border-bottom:1px solid #eef2f7}
  .cred tr:last-child td{border-bottom:0}
  .cred .k{color:#64748b;width:42%}
  .cred .v{font-weight:600;text-align:right}
  .mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .foot{padding:18px 28px;color:#94a3b8;font-size:11px;line-height:1.5;border-top:1px solid #eef2f7}
</style></head>
<body><div class="wrap"><div class="card">
  <div class="head"><h1>ZoikoMeds</h1></div>
  <div class="body"><h2 style="margin:0 0 16px;font-size:16px">${escapeHtml(title)}</h2>${inner}</div>
  <div class="foot">ZoikoMeds shows governed availability confidence from verified pharmacies — not exact stock. It is not a pharmacy, marketplace, or dispensing service and does not provide medical advice.</div>
</div></div></body></html>`;
  }
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
