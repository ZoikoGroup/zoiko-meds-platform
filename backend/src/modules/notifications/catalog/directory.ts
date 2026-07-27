import { NotificationGate, NotificationStream } from '@prisma/client';

import type { RegisteredTemplate, TemplateSection } from '../template.types';

/**
 * The complete ZM-NOT-EMAIL-02 template directory — every deployable template
 * ID, the approved base event it maps to, its title, and its release gate.
 *
 * This is the coverage source of truth. A template that is not listed here
 * cannot be dispatched, and `notification-coverage.spec.ts` asserts the section
 * totals still match the document's authoritative counts:
 *
 *   122 external variants + 13 internal alerts + 16 commercial = 151 total
 *
 * Suffixes A/B/C/D identify distinct copy variants of the same base event.
 */

type Row = [id: string, baseEvent: string, title: string, gate: NotificationGate];

/** Stream assignment per section. Drives sender identity and suppression policy. */
export const SECTION_STREAM: Record<TemplateSection, NotificationStream> = {
  REG: NotificationStream.TRANSACTIONAL,
  SEC: NotificationStream.SECURITY,
  ORG: NotificationStream.TRANSACTIONAL,
  VER: NotificationStream.TRANSACTIONAL,
  INV: NotificationStream.OPERATIONAL,
  MED: NotificationStream.TRANSACTIONAL,
  SUP: NotificationStream.TRANSACTIONAL,
  PRI: NotificationStream.LEGAL,
  WEB: NotificationStream.TRANSACTIONAL,
  OPS: NotificationStream.OPERATIONAL,
  ADM: NotificationStream.INTERNAL,
  COM: NotificationStream.TRANSACTIONAL,
};

export const SECTION_TITLE: Record<TemplateSection, string> = {
  REG: 'Registration and Onboarding',
  SEC: 'Identity, Account and Security',
  ORG: 'Organization, Branch and Access Management',
  VER: 'Verification, Compliance and Network Status',
  INV: 'Inventory Integration and Data Quality',
  MED: 'Medicine Availability, Alerts and Pharmacy Inquiries',
  SUP: 'Support, Complaints and Resolution',
  PRI: 'Privacy, Consent and Legal Notices',
  WEB: 'Website Forms and Subscription Communications',
  OPS: 'Service Status and Operational Communications',
  ADM: 'Internal Super Admin and Operational Alerts',
  COM: 'Conditional Commercial, Billing and Transaction Communications',
};

const P0 = NotificationGate.P0;
const P1 = NotificationGate.P1;
const P2 = NotificationGate.P2;
const INT = NotificationGate.INTERNAL;
const CND = NotificationGate.CONDITIONAL;

const ROWS: Record<TemplateSection, Row[]> = {
  REG: [
    ['REG-001', 'REG-001', 'Registration started but not submitted', P2],
    ['REG-002', 'REG-002', 'Application completion reminder', P2],
    ['REG-003', 'REG-003', 'Final completion and closure warning', P2],
    ['REG-004', 'REG-004', 'Registration received and pending review', P0],
    ['REG-005', 'REG-005', 'Supporting documents received', P1],
    ['REG-006', 'REG-006', 'Further information required', P0],
    ['REG-007', 'REG-007', 'Outstanding information reminder', P1],
    ['REG-008', 'REG-008', 'Final response and closure warning', P1],
    ['REG-009', 'REG-009', 'Application review delayed', P1],
    ['REG-010', 'REG-010', 'Registration approved', P0],
    ['REG-011', 'REG-011', 'Registration declined', P0],
    ['REG-012', 'REG-012', 'Application withdrawn', P1],
    ['REG-013', 'REG-013', 'Application closed due to inactivity', P1],
    ['REG-014', 'REG-014', 'Duplicate application or existing profile detected', P1],
  ],
  SEC: [
    ['SEC-001', 'SEC-001', 'Verify your email address', P0],
    ['SEC-002', 'SEC-002', 'Email verified and account activated', P0],
    ['SEC-003', 'SEC-003', 'Password reset requested', P0],
    ['SEC-004', 'SEC-004', 'Password changed successfully', P0],
    ['SEC-005A', 'SEC-005', 'Primary email changed - notice to former address', P0],
    ['SEC-005B', 'SEC-005', 'Primary email changed - confirmation to new address', P0],
    ['SEC-006', 'SEC-006', 'Recovery method changed', P0],
    ['SEC-007', 'SEC-007', 'Multi-factor authentication enabled', P0],
    ['SEC-008', 'SEC-008', 'Multi-factor authentication disabled or reset', P0],
    ['SEC-009', 'SEC-009', 'New sign-in detected', P1],
    ['SEC-010', 'SEC-010', 'Suspicious sign-in or account activity', P0],
    ['SEC-011', 'SEC-011', 'Account temporarily locked', P0],
    ['SEC-012', 'SEC-012', 'Account access restored', P1],
    ['SEC-013', 'SEC-013', 'Account deletion or deactivation requested', P0],
    ['SEC-014', 'SEC-014', 'Account deletion or deactivation completed', P0],
  ],
  ORG: [
    ['ORG-001A', 'ORG-001', 'Organization administrator invitation', P0],
    ['ORG-001B', 'ORG-001', 'Organization team-member invitation', P0],
    ['ORG-002A', 'ORG-002', 'Invitation expired', P1],
    ['ORG-002B', 'ORG-002', 'Invitation canceled', P1],
    ['ORG-003', 'ORG-003', 'Role or permission changed', P0],
    ['ORG-004A', 'ORG-004', 'Primary administrator transfer - outgoing administrator', P0],
    ['ORG-004B', 'ORG-004', 'Primary administrator transfer - incoming administrator', P0],
    ['ORG-005', 'ORG-005', 'Branch or pharmacy location submitted', P1],
    ['ORG-006A', 'ORG-006', 'Branch or location approved', P1],
    ['ORG-006B', 'ORG-006', 'Further information required for branch or location', P1],
    ['ORG-006C', 'ORG-006', 'Branch or location declined', P1],
    ['ORG-007A', 'ORG-007', 'Verified organization profile change approved', P1],
    ['ORG-007B', 'ORG-007', 'Verified profile change returned for correction', P1],
    ['ORG-007C', 'ORG-007', 'Verified organization profile change declined', P1],
    ['ORG-008', 'ORG-008', 'Branch or location removed from the network', P1],
  ],
  VER: [
    ['VER-001', 'VER-001', 'Verification renewal due', P0],
    ['VER-002A', 'VER-002', 'Verification renewal reminder', P0],
    ['VER-002B', 'VER-002', 'Final verification renewal warning', P0],
    ['VER-003', 'VER-003', 'Verification expired', P0],
    ['VER-004', 'VER-004', 'License, permit, or certificate approaching expiration', P0],
    ['VER-005', 'VER-005', 'License, permit, or certificate expired', P0],
    ['VER-006', 'VER-006', 'Compliance document accepted', P1],
    ['VER-007', 'VER-007', 'Compliance document rejected or replacement required', P0],
    ['VER-008', 'VER-008', 'Material organization change under review', P1],
    ['VER-009', 'VER-009', 'Network participation temporarily restricted', P0],
    ['VER-010', 'VER-010', 'Network participation suspended', P0],
    ['VER-011', 'VER-011', 'Network participation terminated', P0],
    ['VER-012', 'VER-012', 'Network participation reinstated', P0],
    ['VER-013', 'VER-013', 'Offboarding completed', P1],
  ],
  INV: [
    ['INV-001', 'INV-001', 'Inventory integration connected', P1],
    ['INV-002A', 'INV-002', 'Integration authorization failed', P0],
    ['INV-002B', 'INV-002', 'Inventory integration disconnected', P0],
    ['INV-003', 'INV-003', 'Inventory synchronization failed', P0],
    ['INV-004', 'INV-004', 'Inventory data is stale', P0],
    ['INV-005', 'INV-005', 'Inventory data restored', P1],
    ['INV-006A', 'INV-006', 'Bulk inventory upload received', P1],
    ['INV-006B', 'INV-006', 'Bulk inventory upload completed', P1],
    ['INV-007A', 'INV-007', 'Bulk upload completed with errors', P1],
    ['INV-007B', 'INV-007', 'Bulk inventory upload failed', P1],
    ['INV-008A', 'INV-008', 'Medicine listing requires correction', P1],
    ['INV-008B', 'INV-008', 'Medicine listing rejected', P1],
  ],
  MED: [
    ['MED-001', 'MED-001', 'Medicine availability request received', P0],
    ['MED-002', 'MED-002', 'Availability request update', P1],
    ['MED-003', 'MED-003', 'Potential medicine availability identified', P0],
    ['MED-004', 'MED-004', 'No verified availability currently identified', P0],
    ['MED-005', 'MED-005', 'Search radius or criteria expanded', P1],
    ['MED-006A', 'MED-006', 'Availability request canceled', P1],
    ['MED-006B', 'MED-006', 'Availability request expired', P1],
    ['MED-006C', 'MED-006', 'Availability request closed', P1],
    ['MED-007A', 'MED-007', 'Medicine availability alert created', P1],
    ['MED-007B', 'MED-007', 'Medicine availability alert paused', P1],
    ['MED-007C', 'MED-007', 'Medicine availability alert expired', P1],
    ['MED-007D', 'MED-007', 'Medicine availability alert removed', P1],
    ['MED-008', 'MED-008', 'Medicine availability alert triggered', P0],
    ['MED-009', 'MED-009', 'New medicine availability inquiry', P0],
    ['MED-010A', 'MED-010', 'Pharmacy inquiry response reminder', P1],
    ['MED-010B', 'MED-010', 'Pharmacy inquiry expired', P1],
    ['MED-010C', 'MED-010', 'Pharmacy inquiry response accepted', P1],
    ['MED-010D', 'MED-010', 'Pharmacy inquiry response rejected', P1],
  ],
  SUP: [
    ['SUP-001', 'SUP-001', 'Support request received', P0],
    ['SUP-002A', 'SUP-002', 'Further information required for support case', P1],
    ['SUP-002B', 'SUP-002', 'Support case updated', P1],
    ['SUP-003', 'SUP-003', 'Support case escalated', P1],
    ['SUP-004A', 'SUP-004', 'Support case resolved', P1],
    ['SUP-004B', 'SUP-004', 'Support case closed due to inactivity', P1],
    ['SUP-005', 'SUP-005', 'Complaint received and acknowledged', P0],
    ['SUP-006A', 'SUP-006', 'Complaint investigation update', P0],
    ['SUP-006B', 'SUP-006', 'Complaint outcome issued', P0],
    ['SUP-006C', 'SUP-006', 'Complaint review or escalation path confirmed', P0],
  ],
  PRI: [
    ['PRI-001', 'PRI-001', 'Privacy or data-rights request received', P0],
    ['PRI-002', 'PRI-002', 'Identity verification required for privacy request', P0],
    ['PRI-003A', 'PRI-003', 'Privacy request completed', P0],
    ['PRI-003B', 'PRI-003', 'Privacy request formally closed', P0],
    ['PRI-004', 'PRI-004', 'Consent or communication preferences updated', P1],
    ['PRI-005A', 'PRI-005', 'Material Privacy Policy update', P0],
    ['PRI-005B', 'PRI-005', 'Material Terms of Use update', P0],
    ['PRI-006', 'PRI-006', 'Security or personal-data incident notification', P0],
  ],
  WEB: [
    ['WEB-001', 'WEB-001', 'General contact form confirmation', P0],
    ['WEB-002A', 'WEB-002', 'Pharmacy network inquiry received', P0],
    ['WEB-002B', 'WEB-002', 'Institutional partnership inquiry received', P0],
    ['WEB-002C', 'WEB-002', 'Product demonstration request received', P0],
    ['WEB-003', 'WEB-003', 'Press or media inquiry received', P1],
    ['WEB-004', 'WEB-004', 'Accessibility issue report received', P0],
    ['WEB-005', 'WEB-005', 'Security vulnerability report received', P0],
    ['WEB-006A', 'WEB-006', 'Subscription confirmed', P0],
    ['WEB-006B', 'WEB-006', 'Unsubscription confirmed', P0],
    ['WEB-006C', 'WEB-006', 'Subscription preferences updated', P0],
  ],
  OPS: [
    ['OPS-001A', 'OPS-001', 'Planned maintenance announcement', P1],
    ['OPS-001B', 'OPS-001', 'Planned maintenance reminder', P1],
    ['OPS-002', 'OPS-002', 'Service disruption identified', P0],
    ['OPS-003', 'OPS-003', 'Incident or degraded-service update', P0],
    ['OPS-004A', 'OPS-004', 'Service restored', P0],
    ['OPS-004B', 'OPS-004', 'Required user action after service event', P0],
  ],
  ADM: [
    ['ADM-001', 'ADM-001', 'New pharmacy or stakeholder registration submitted', INT],
    ['ADM-002', 'ADM-002', 'Registration review target approaching breach', INT],
    ['ADM-003', 'ADM-003', 'Registration review target breached', INT],
    ['ADM-004', 'ADM-004', 'High-risk compliance discrepancy detected', INT],
    ['ADM-005', 'ADM-005', 'Verification, license, or permit expiration approaching', INT],
    ['ADM-006', 'ADM-006', 'Inventory feed stale or integration repeatedly failing', INT],
    ['ADM-007', 'ADM-007', 'High-priority complaint or medicine-safety concern received', INT],
    ['ADM-008', 'ADM-008', 'Privacy or data-rights request received', INT],
    ['ADM-009', 'ADM-009', 'Security vulnerability report received', INT],
    ['ADM-010', 'ADM-010', 'Suspicious account activity or fraud threshold exceeded', INT],
    ['ADM-011', 'ADM-011', 'Critical platform or regional service incident opened', INT],
    ['ADM-012', 'ADM-012', 'Transactional email delivery failure or bounce threshold exceeded', INT],
    ['ADM-013', 'ADM-013', 'Notification dead-letter queue, template-rendering, or localization failure', INT],
  ],
  COM: [
    ['COM-001', 'COM-001', 'Trial or paid subscription started', CND],
    ['COM-002A', 'COM-002', 'Trial ending', CND],
    ['COM-002B', 'COM-002', 'Trial converted to paid subscription', CND],
    ['COM-003', 'COM-003', 'Invoice issued', CND],
    ['COM-004', 'COM-004', 'Payment received', CND],
    ['COM-005', 'COM-005', 'Payment failed', CND],
    ['COM-006', 'COM-006', 'Payment method expiring', CND],
    ['COM-007', 'COM-007', 'Subscription renewed', CND],
    ['COM-008', 'COM-008', 'Plan changed', CND],
    ['COM-009A', 'COM-009', 'Subscription canceled', CND],
    ['COM-009B', 'COM-009', 'Subscription expired', CND],
    ['COM-010', 'COM-010', 'Credit or refund issued', CND],
    ['COM-011', 'COM-011', 'Medicine reservation, referral, or transaction accepted', CND],
    ['COM-012A', 'COM-012', 'Reservation, referral, or transaction canceled', CND],
    ['COM-012B', 'COM-012', 'Reservation, referral, or transaction rejected', CND],
    ['COM-012C', 'COM-012', 'Reservation, referral, or transaction expired', CND],
  ],
};

/** Every template in the library, flattened in directory order. */
export const TEMPLATE_DIRECTORY: RegisteredTemplate[] = (
  Object.keys(ROWS) as TemplateSection[]
).flatMap((section) =>
  ROWS[section].map(([id, baseEvent, title, gate]) => ({
    id,
    baseEvent,
    title,
    gate,
    section,
  })),
);

/** Directory rows keyed by template ID. */
export const DIRECTORY_BY_ID = new Map<string, RegisteredTemplate>(
  TEMPLATE_DIRECTORY.map((row) => [row.id, row]),
);
