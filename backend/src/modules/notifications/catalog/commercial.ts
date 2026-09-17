import {
  NotificationChannel,
  NotificationGate,
  NotificationStream,
} from '@prisma/client';

import type { EmailTemplate } from '../template.types';

/**
 * Commercial, Billing and Transaction Communications (COM section) — authored.
 *
 * The three confirmations a paying pharmacy actually needs after a self-serve
 * Intelligence Pro checkout: the subscription starting, an invoice opening, and
 * a payment settling. Emitted from stripe-webhook.service.ts.
 *
 * The COM section carries the CONDITIONAL gate, so these dispatch only while
 * NOTIFICATION_RELEASED_GATES includes CONDITIONAL (it does by default — see
 * notifications.service.ts). Dropping CONDITIONAL from that variable suppresses
 * every commercial message with GATE_NOT_RELEASED without a code change, which
 * is the intended lever if commercial or regulatory review ever needs them
 * paused.
 *
 * Copy must not be reworded without a version bump and re-acceptance, in line
 * with the rest of the catalog.
 *
 * CTA destinations point at the in-app billing page, not directly at Stripe's
 * hosted invoice/receipt page: the renderer only allows an https destination
 * whose host is APP_BASE_URL's host or in NOTIFICATION_ALLOWED_LINK_HOSTS, and
 * invoice.stripe.com is neither by default. The pharmacy reaches the
 * Stripe-hosted document by clicking through from the billing page, which
 * already lists invoices (pharmacy.service.ts) and links out to
 * hostedInvoiceUrl itself.
 */

const EMAIL_AND_IN_APP = [
  NotificationChannel.EMAIL,
  NotificationChannel.IN_APP,
];

/** Anti-phishing qualification, worded for a payment-adjacent message. */
const PAYMENT_SECURITY_NOTICE =
  'ZoikoMeds will never ask you to confirm payment details, card numbers, or one-time codes by email. This message never asks you to enter payment information — manage billing only from your authenticated ZoikoMeds account.';

/** The doctrine already enforced in code (subscription.service, stripe-webhook.service): Pro is additive, never a condition of free Network Core participation. */
const NETWORK_CORE_NOTICE =
  'This message concerns your paid Intelligence Pro subscription only. Your pharmacy’s free participation in the ZoikoMeds Network Core is separate and is never conditioned on a paid plan.';

export const COMMERCIAL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'COM-001',
    baseEvent: 'COM-001',
    family: 'COM-F01 Subscription Lifecycle',
    section: 'COM',
    title: 'Trial or paid subscription started',
    gate: NotificationGate.CONDITIONAL,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'A provider-hosted checkout is confirmed paid and the internal subscription is created (Stripe checkout.session.completed, reconciled by webhook or by the pharmacy’s own return from checkout).',
    audience: 'Billing contact',
    recipientResolution: 'billingProfile.billingEmail',
    subject: 'Your {{Plan Name}} subscription is active',
    preheader:
      '{{Organization Name}} now has {{Plan Name}} access, effective {{Subscription Start Date}}.',
    cta: {
      label: 'Manage your subscription',
      destination: '{{Billing Portal Link}}',
    },
    requiredFields: [
      'Organization Name',
      'Plan Name',
      'Billing Amount',
      'Billing Interval',
      'Subscription Start Date',
      'Billing Portal Link',
    ],
    copy: {
      intro: [
        'Thank you for subscribing to {{Plan Name}} for {{Organization Name}}.',
        'Your subscription is now active and billing has started.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Plan', value: '{{Plan Name}}' },
        { label: 'Billing amount', value: '{{Billing Amount}} / {{Billing Interval}}' },
        { label: 'Subscription start', value: '{{Subscription Start Date}}' },
      ],
      importantInformation: [NETWORK_CORE_NOTICE, PAYMENT_SECURITY_NOTICE],
      closing: 'You can review or manage your subscription at any time from your billing portal.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'COM-003',
    baseEvent: 'COM-003',
    family: 'COM-F02 Invoicing',
    section: 'COM',
    title: 'Invoice issued',
    gate: NotificationGate.CONDITIONAL,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'Stripe finalizes an invoice for a subscription (invoice.finalized). Sent when an invoice becomes payable, which may be before or independent of payment confirmation.',
    audience: 'Billing contact',
    recipientResolution: 'billingProfile.billingEmail',
    subject: 'Invoice {{Invoice Number}} from ZoikoMeds',
    preheader:
      '{{Invoice Total}} for the billing period ending {{Period End Date}}.',
    cta: {
      label: 'View invoice in your billing portal',
      destination: '{{Billing Portal Link}}',
    },
    requiredFields: [
      'Organization Name',
      'Invoice Number',
      'Invoice Total',
      'Period Start Date',
      'Period End Date',
      'Billing Portal Link',
    ],
    copy: {
      intro: [
        'A new invoice has been issued for {{Organization Name}}’s ZoikoMeds subscription.',
      ],
      reference: [
        { label: 'Invoice number', value: '{{Invoice Number}}' },
        { label: 'Billing period', value: '{{Period Start Date}} – {{Period End Date}}' },
        { label: 'Amount due', value: '{{Invoice Total}}' },
      ],
      importantInformation: [
        'This is an invoice, not a payment confirmation. A separate message confirms when payment is received.',
        PAYMENT_SECURITY_NOTICE,
      ],
      closing: 'View the full invoice and payment status from your billing portal at any time.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'COM-004',
    baseEvent: 'COM-004',
    family: 'COM-F03 Payment Confirmation',
    section: 'COM',
    title: 'Payment received',
    gate: NotificationGate.CONDITIONAL,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'Stripe confirms an invoice paid (invoice.paid). For self-serve Intelligence Pro this typically follows COM-001 within moments, since checkout charges the card immediately.',
    audience: 'Billing contact',
    recipientResolution: 'billingProfile.billingEmail',
    subject: 'Payment received — Invoice {{Invoice Number}}',
    preheader:
      'We received {{Amount Paid}} for {{Organization Name}}’s {{Plan Name}} subscription.',
    cta: {
      label: 'View receipt in your billing portal',
      destination: '{{Billing Portal Link}}',
    },
    requiredFields: [
      'Organization Name',
      'Plan Name',
      'Invoice Number',
      'Amount Paid',
      'Payment Date',
      'Billing Portal Link',
    ],
    copy: {
      intro: [
        'This confirms we received your payment for {{Organization Name}}’s {{Plan Name}} subscription.',
      ],
      reference: [
        { label: 'Invoice number', value: '{{Invoice Number}}' },
        { label: 'Amount paid', value: '{{Amount Paid}}' },
        { label: 'Payment date', value: '{{Payment Date}}' },
      ],
      importantInformation: [PAYMENT_SECURITY_NOTICE],
      closing: 'Thank you for your business. Your subscription remains active.',
    },
    version: '1.0',
    active: true,
  },
];
