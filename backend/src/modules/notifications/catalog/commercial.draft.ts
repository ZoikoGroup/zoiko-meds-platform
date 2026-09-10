import {
  NotificationChannel,
  NotificationGate,
  NotificationStream,
} from '@prisma/client';

import type { EmailTemplate } from '../template.types';

/**
 * DRAFT — Commercial, Billing and Transaction Communications (COM section).
 *
 * NOT WIRED IN. This file is deliberately not imported by ./index.ts and has
 * no effect on the running system: it adds nothing to AUTHORED_TEMPLATES,
 * changes no catalog counts, and cannot be dispatched. It exists purely for
 * review.
 *
 * Two independent things must happen before any of this can reach a real
 * pharmacy, by this system's own design:
 *
 *  1. This copy needs actual commercial, tax, payment, refund and regulatory
 *     sign-off (per the COM section's CONDITIONAL gate) — the wording below
 *     is a draft, not approved text. Once accepted, move the relevant
 *     template(s) into a real `commercial.ts`, add it to AUTHORED_TEMPLATES
 *     in ./index.ts alongside REGISTRATION_TEMPLATES, and set active: true —
 *     catalog.spec.ts enforces that every authored template is active, so
 *     there is no partial "authored but not yet active" state to land this
 *     in halfway.
 *  2. NOTIFICATION_RELEASED_GATES must include CONDITIONAL. It does not
 *     today (default is P0,P1,P2,INTERNAL) — notifications.service.ts warns
 *     loudly at boot if this is ever changed, on purpose.
 *
 * Family groupings (COM-F01/F02/F03) are my own organization proposal, not
 * transcribed from an existing ZM-NOT-EMAIL-02 Part III — there was no such
 * document in this repo to transcribe from. Confirm against the real one if
 * it exists elsewhere.
 *
 * CTA destinations point at the in-app billing page, not directly at
 * Stripe's hosted invoice/receipt page: the renderer only allows an https
 * destination whose host is APP_BASE_URL's host or in
 * NOTIFICATION_ALLOWED_LINK_HOSTS, and invoice.stripe.com is neither by
 * default. The pharmacy reaches the Stripe-hosted document by clicking
 * through from the billing page, which already lists invoices
 * (pharmacy.service.ts) and can link out to hostedInvoiceUrl itself.
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

export const COMMERCIAL_TEMPLATES_DRAFT: EmailTemplate[] = [
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
    version: '0.1-draft',
    active: false,
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
    version: '0.1-draft',
    active: false,
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
    version: '0.1-draft',
    active: false,
  },
];
