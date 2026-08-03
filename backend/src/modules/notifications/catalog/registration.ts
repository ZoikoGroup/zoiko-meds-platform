import {
  NotificationChannel,
  NotificationGate,
  NotificationStream,
} from '@prisma/client';

import type { EmailTemplate } from '../template.types';

/**
 * Registration and Onboarding — authored templates.
 *
 * Copy is transcribed from ZM-NOT-EMAIL-02 Part II and must not be reworded
 * without a version bump and re-acceptance. REG-013 and REG-014 are catalogued
 * in the directory but remain unauthored, so they stay inactive under Rule 10.
 */

const EMAIL_AND_IN_APP = [
  NotificationChannel.EMAIL,
  NotificationChannel.IN_APP,
];

/** Standard anti-phishing qualification carried by every applicant-facing message. */
const SECURITY_NOTICE =
  'ZoikoMeds will never ask you to disclose your password, one-time security code, or complete payment credentials by email. Use only authenticated ZoikoMeds links and portals.';

/** Network status must never be read as regulatory authority. */
const NETWORK_STATUS_NOTICE =
  'ZoikoMeds network status does not replace any license, permit, professional authorization, regulatory approval, accreditation, or legal requirement applicable to the organization.';

const F01 = 'REG-F01 Application Progress';
const F02 = 'REG-F02 Application Receipt';
const F03 = 'REG-F03 Information Request';
const F04 = 'REG-F04 Review Status';
const F05 = 'REG-F05 Application Decision';
const F06 = 'REG-F06 Application Closure';

export const REGISTRATION_TEMPLATES: EmailTemplate[] = [
  {
    id: 'REG-001',
    baseEvent: 'REG-001',
    family: F01,
    section: 'REG',
    title: 'Registration started but not submitted',
    gate: NotificationGate.P2,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'Application record remains incomplete beyond the configured interval.',
    audience: 'Applicant',
    recipientResolution: 'application.applicant',
    subject: 'Complete your ZoikoMeds network registration',
    preheader:
      'Your saved application is incomplete and has not been submitted for review.',
    cta: {
      label: 'Continue registration',
      destination: '{{Application Resume Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Application Start Date',
      'Application Resume Link',
    ],
    copy: {
      intro: [
        'You started an application for {{Organization Name}} to join the ZoikoMeds network, but the application has not yet been submitted.',
        'Your information has been saved. ZoikoMeds cannot begin its review until all required sections are completed and the application is formally submitted.',
        'Review the application carefully and make sure the organization, licensing, location, contact, ownership, and supporting-document information is complete and accurate.',
      ],
      nextSteps: [
        'Open the saved application.',
        'Complete each required section.',
        'Upload required evidence through the secure portal.',
        'Review the declaration and submit the application.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Application reference', value: '{{Registration Reference}}' },
        { label: 'Saved on', value: '{{Application Start Date}}' },
        { label: 'Current status', value: 'Draft - not submitted' },
      ],
      importantInformation: [
        'Creating or saving an application does not constitute submission, approval, verification, activation, or admission to the ZoikoMeds network.',
        SECURITY_NOTICE,
      ],
      closing: 'We look forward to receiving your completed application.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-002',
    baseEvent: 'REG-002',
    family: F01,
    section: 'REG',
    title: 'Application completion reminder',
    gate: NotificationGate.P2,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger: 'Incomplete application reaches the first reminder threshold.',
    audience: 'Applicant',
    recipientResolution: 'application.applicant',
    subject: 'Reminder: complete your ZoikoMeds network registration',
    preheader:
      'Your application remains in draft and cannot be reviewed until it is submitted.',
    cta: {
      label: 'Continue registration',
      destination: '{{Application Resume Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Application Resume Link',
      'Draft Retention Date',
    ],
    copy: {
      intro: [
        "This is a reminder to complete and submit {{Organization Name}}'s ZoikoMeds network registration.",
        'The application remains in draft. No reviewer has assessed it, and no decision can be made until it is submitted.',
        'Before submitting, confirm that all information is current and that any licenses, permits, certificates, or supporting records are legible and valid.',
      ],
      nextSteps: [
        'Complete the remaining sections shown in the portal.',
        'Resolve any validation messages.',
        'Submit the application when it is complete.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Application reference', value: '{{Registration Reference}}' },
        { label: 'Current status', value: 'Draft - action required' },
        { label: 'Draft retention date', value: '{{Draft Retention Date}}' },
      ],
      importantInformation: [
        'The application will remain outside the review queue until submission.',
        SECURITY_NOTICE,
      ],
      closing: 'Please complete the application when you are ready to proceed.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-003',
    baseEvent: 'REG-003',
    family: F01,
    section: 'REG',
    title: 'Final completion and closure warning',
    gate: NotificationGate.P2,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger: 'Incomplete application reaches the final reminder threshold.',
    audience: 'Applicant',
    recipientResolution: 'application.applicant',
    subject:
      'Final reminder: submit your ZoikoMeds application by {{Closure Date}}',
    preheader:
      'Your incomplete application is scheduled to close unless it is submitted by the stated date.',
    cta: {
      label: 'Complete and submit application',
      destination: '{{Application Resume Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Application Resume Link',
      'Closure Date',
    ],
    copy: {
      intro: [
        "{{Organization Name}}'s saved ZoikoMeds network application is still incomplete and is scheduled to close on {{Closure Date}}.",
        'To preserve the application, complete all required sections and submit it before the closure date.',
        'If the application closes, the saved draft may no longer be available and a new application may be required. Closure of an incomplete draft is not a decline decision.',
      ],
      nextSteps: [
        'Open the application.',
        'Complete missing information and uploads.',
        'Submit before {{Closure Date}}.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Application reference', value: '{{Registration Reference}}' },
        { label: 'Current status', value: 'Draft - final action required' },
        { label: 'Scheduled closure', value: '{{Closure Date}}' },
      ],
      importantInformation: [
        'The closure date and retention treatment must match the approved ZoikoMeds records policy.',
        SECURITY_NOTICE,
      ],
      closing:
        'No further reminder will be sent before the scheduled closure unless the application status changes.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-004',
    baseEvent: 'REG-004',
    family: F02,
    section: 'REG',
    title: 'Registration received and pending review',
    gate: NotificationGate.P0,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger: 'Applicant successfully submits a complete registration request.',
    audience: 'Primary contact',
    recipientResolution: 'application.primaryContact',
    subject: "We've received your ZoikoMeds network registration",
    preheader: 'Your application has been received and is pending controlled review.',
    cta: {
      label: 'View registration status',
      destination: '{{Registration Status Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Organization Type',
      'Registration Reference',
      'Submission Date',
      'Registration Status Link',
    ],
    copy: {
      intro: [
        'Thank you for registering {{Organization Name}} to join the ZoikoMeds network.',
        'Your registration request has been received successfully and is now pending review by ZoikoMeds Network Operations.',
        'An authorized reviewer will assess the information and supporting documentation submitted with the application. Following review, the application may be approved, declined, or returned for further information.',
        'No action is required unless ZoikoMeds contacts you. Please monitor the designated email address, including its spam or junk folder.',
      ],
      nextSteps: [
        'Approved: you will receive controlled onboarding and activation instructions.',
        'Further information required: the message will identify what is needed and how to submit it securely.',
        'Declined: the decision notice will explain available next steps where disclosure and reapplication are permitted.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Organization type', value: '{{Organization Type}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        { label: 'Submission date', value: '{{Submission Date}}' },
        { label: 'Current status', value: 'Pending review' },
      ],
      importantInformation: [
        'The organization must not be represented as approved, verified, active, or participating in the ZoikoMeds network until formal approval and all applicable activation controls have been completed.',
        NETWORK_STATUS_NOTICE,
        SECURITY_NOTICE,
      ],
      closing:
        'Thank you for helping improve access to accurate medicine availability information.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-005',
    baseEvent: 'REG-005',
    family: F02,
    section: 'REG',
    title: 'Supporting documents received',
    gate: NotificationGate.P1,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger: 'Secure upload service validates receipt of supporting documents.',
    audience: 'Submitting contact',
    recipientResolution: 'application.submittingContact',
    subject: 'Supporting documents received for {{Organization Name}}',
    preheader:
      'Your files were received securely and will be reviewed as part of the application.',
    cta: {
      label: 'View uploaded documents',
      destination: '{{Registration Documents Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Upload Reference',
      'Received File Count',
      'Upload Date',
      'Registration Documents Link',
    ],
    copy: {
      intro: [
        'ZoikoMeds has received the supporting documents submitted for {{Organization Name}}.',
        'Receipt confirms that the files reached the secure upload service. It does not mean that the documents have been accepted, verified, or approved.',
        'A reviewer may request a clearer copy, an updated record, a translation, additional evidence, or clarification if a document is unreadable, expired, incomplete, inconsistent, or outside the accepted requirements.',
      ],
      nextSteps: [
        'Confirm that the document list in the portal is complete.',
        'Retain the originals and any supporting records.',
        'Respond through the portal if ZoikoMeds requests additional information.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        { label: 'Upload reference', value: '{{Upload Reference}}' },
        { label: 'Files received', value: '{{Received File Count}}' },
        { label: 'Received on', value: '{{Upload Date}}' },
      ],
      importantInformation: [
        'For privacy and security, this email does not list sensitive document contents, license numbers, identification numbers, or file attachments.',
        SECURITY_NOTICE,
      ],
      closing:
        'The application review will continue in accordance with its current status.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-006',
    baseEvent: 'REG-006',
    family: F03,
    section: 'REG',
    title: 'Further information required',
    gate: NotificationGate.P0,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger: 'Authorized reviewer issues a structured information request.',
    audience: 'Primary contact',
    recipientResolution: 'application.primaryContact',
    subject:
      'Action required: additional information for your ZoikoMeds registration',
    preheader:
      'Submit the requested information by {{Response Due Date}} so the review can continue.',
    cta: {
      label: 'Provide requested information',
      destination: '{{Secure Information Request Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Response Due Date',
      'Requested Information Summary',
      'Secure Information Request Link',
    ],
    copy: {
      intro: [
        "We are continuing our review of {{Organization Name}}'s application to join the ZoikoMeds network. Before a final decision can be made, additional information or clarification is required.",
        'The authenticated portal contains the complete request, applicant-facing instructions, and secure upload fields.',
        'Once the requested information is received, the application will return to active review. ZoikoMeds may contact you again if further clarification is reasonably required.',
        'If the information is not received by the due date, the application may be closed or declined in accordance with the approved workflow. Contact ZoikoMeds before the deadline if additional time is required.',
      ],
      nextSteps: [
        'Review each requested item in the portal.',
        'Provide complete, current, and accurate information.',
        'Submit all items through the secure link by {{Response Due Date}}.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        { label: 'Current status', value: 'Further information required' },
        { label: 'Response due date', value: '{{Response Due Date}}' },
        { label: 'Request summary', value: '{{Requested Information Summary}}' },
      ],
      importantInformation: [
        'Do not send passwords, security codes, complete payment credentials, or sensitive registration documents in an ordinary email reply.',
      ],
      closing:
        'Providing complete and accurate information will help ZoikoMeds progress the review efficiently.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-007',
    baseEvent: 'REG-007',
    family: F03,
    section: 'REG',
    title: 'Outstanding information reminder',
    gate: NotificationGate.P1,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'Requested information remains outstanding at the reminder threshold.',
    audience: 'Primary contact',
    recipientResolution: 'application.primaryContact',
    subject:
      'Reminder: information is still required for your ZoikoMeds registration',
    preheader:
      'Your application cannot progress until the requested information is submitted.',
    cta: {
      label: 'Complete information request',
      destination: '{{Secure Information Request Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Response Due Date',
      'Requested Information Summary',
      'Secure Information Request Link',
    ],
    copy: {
      intro: [
        "This is a reminder that additional information is still required to continue reviewing {{Organization Name}}'s application.",
        "The application remains in the 'Further information required' status. If all requested items have already been submitted, no further action is required unless ZoikoMeds contacts you.",
        'If you cannot meet the deadline, contact ZoikoMeds before the due date and include the registration reference.',
      ],
      nextSteps: [
        'Review the outstanding items in the portal.',
        'Submit the requested information by {{Response Due Date}}.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        { label: 'Current status', value: 'Further information required' },
        { label: 'Response due date', value: '{{Response Due Date}}' },
        { label: 'Outstanding request', value: '{{Requested Information Summary}}' },
      ],
      importantInformation: [
        'This reminder is suppressed immediately when all items are submitted, the application status changes, or the request is withdrawn.',
        SECURITY_NOTICE,
      ],
      closing: 'Please act by the stated deadline to keep the application open.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-008',
    baseEvent: 'REG-008',
    family: F03,
    section: 'REG',
    title: 'Final response and closure warning',
    gate: NotificationGate.P1,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'Outstanding information request reaches the final response threshold.',
    audience: 'Primary contact',
    recipientResolution: 'application.primaryContact',
    subject: 'Final action required: respond by {{Response Due Date}}',
    preheader:
      'Your ZoikoMeds registration may close if the required information is not received by the deadline.',
    cta: {
      label: 'Submit outstanding information',
      destination: '{{Secure Information Request Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Response Due Date',
      'Secure Information Request Link',
    ],
    copy: {
      intro: [
        "ZoikoMeds has not yet received all information required to continue reviewing {{Organization Name}}'s registration.",
        'This is the final scheduled reminder before the response deadline.',
        'If the outstanding information is not received by {{Response Due Date}}, ZoikoMeds may close or decline the application under the applicable process. If the application closes, a new application or formal reactivation request may be required.',
      ],
      nextSteps: [
        'Open the secure information request.',
        'Submit every outstanding item.',
        'Contact {{Support Email}} before the deadline if a documented extension is needed.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        {
          label: 'Current status',
          value: 'Further information required - final action',
        },
        { label: 'Response due date', value: '{{Response Due Date}}' },
      ],
      importantInformation: [
        'The system verifies that information remains outstanding immediately before sending.',
        SECURITY_NOTICE,
      ],
      closing:
        'No further scheduled reminder will be sent before the deadline unless the status changes.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-009',
    baseEvent: 'REG-009',
    family: F04,
    section: 'REG',
    title: 'Application review delayed',
    gate: NotificationGate.P1,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'Approved service target cannot be met or a required dependency remains unresolved.',
    audience: 'Primary contact',
    recipientResolution: 'application.primaryContact',
    subject: 'Update on your ZoikoMeds network registration',
    preheader:
      'The review is taking longer than expected; no action is required unless stated below.',
    cta: {
      label: 'View registration status',
      destination: '{{Registration Status Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Applicant-Facing Delay Reason',
      'Applicant Action Required Statement',
      'Registration Status Link',
    ],
    copy: {
      intro: [
        "We are writing with an update on {{Organization Name}}'s application to join the ZoikoMeds network.",
        'The review has not yet been completed because {{Applicant-Facing Delay Reason}}.',
        'The application remains active. This delay is not an approval or decline decision. ZoikoMeds will provide a further update when the dependency is resolved or when a decision is ready.',
        '{{Applicant Action Required Statement}}',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        { label: 'Current status', value: 'Pending review' },
        {
          label: 'Updated review date',
          value: "{{Updated Review Date or 'Not yet available'}}",
        },
      ],
      importantInformation: [
        'Internal risk, fraud, sanctions, or third-party review details are never disclosed in this notice, and no completion date is stated unless Operations has approved and can meet it.',
      ],
      closing: 'Thank you for your patience while the review is completed.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-010',
    baseEvent: 'REG-010',
    family: F05,
    section: 'REG',
    title: 'Registration approved',
    gate: NotificationGate.P0,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'Super Admin records an approved decision and all approval controls pass.',
    audience: 'Primary contact and organization administrator',
    recipientResolution: 'application.primaryContact+organizationAdministrator',
    subject: 'Your ZoikoMeds network registration has been approved',
    preheader:
      'Welcome to the ZoikoMeds network. Complete the required onboarding and activation steps.',
    cta: { label: 'Begin onboarding', destination: '{{Onboarding Link}}' },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Decision Date',
      'Onboarding Link',
    ],
    copy: {
      intro: [
        "We are pleased to confirm that {{Organization Name}}'s registration to join the ZoikoMeds network has been approved.",
        'The organization may now proceed to the applicable onboarding and activation steps.',
        "Approval and public activation are separate states. The organization's profile, locations, medicine information, inventory, integrations, and services will become active only after all applicable onboarding, validation, terms, and publication controls have passed.",
        'The organization is responsible for keeping its licensing, contact, location, service, medicine, inventory, and authorized-user information accurate and current.',
      ],
      nextSteps: [
        'Review and confirm the organization profile and authorized locations.',
        'Add authorized users and assign appropriate roles.',
        'Accept current network terms, policies, and data responsibilities where required.',
        'Configure applicable inventory, integration, service, and notification settings.',
        'Complete all final activation checks shown in the portal.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        { label: 'Decision date', value: '{{Decision Date}}' },
        { label: 'Current status', value: 'Approved - onboarding required' },
        {
          label: 'Approval conditions',
          value: "{{Approval Conditions or 'None'}}",
        },
      ],
      importantInformation: [
        NETWORK_STATUS_NOTICE,
        'Approval remains subject to the ZoikoMeds terms, policies, ongoing eligibility requirements, and any conditions displayed in the authenticated portal.',
        SECURITY_NOTICE,
      ],
      closing:
        'Welcome to the ZoikoMeds network. We look forward to working with you.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-011',
    baseEvent: 'REG-011',
    family: F05,
    section: 'REG',
    title: 'Registration declined',
    gate: NotificationGate.P0,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger:
      'Super Admin records a declined decision and required release controls pass.',
    audience: 'Primary contact',
    recipientResolution: 'application.primaryContact',
    subject: 'Decision on your ZoikoMeds network registration',
    preheader:
      "ZoikoMeds has completed its review of {{Organization Name}}'s application.",
    cta: {
      label: 'View decision details',
      destination: '{{Decision Details Link}}',
      // Hidden when no review or reapplication pathway is available.
      visibleWhen: 'Reapplication Pathway Available',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Decision Date',
      'Decision Reason Category',
      'Applicant-Facing Decision Explanation',
    ],
    copy: {
      intro: [
        "Thank you for your interest in joining the ZoikoMeds network. We have completed our review of {{Organization Name}}'s registration request.",
        'At this time, ZoikoMeds is unable to approve the application.',
        'Decision category: {{Decision Reason Category}}. {{Applicant-Facing Decision Explanation}}',
        "{{Reapplication or Review Instructions or ''}}",
        'ZoikoMeds may be unable to disclose confidential screening criteria, security controls, fraud-prevention methods, third-party information, or information restricted by law or policy.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        { label: 'Decision date', value: '{{Decision Date}}' },
        { label: 'Current status', value: 'Declined' },
      ],
      importantInformation: [
        "This decision relates only to participation in the ZoikoMeds network. It is not a determination of the organization's general legal standing, professional competence, regulatory status, or ability to operate outside the network.",
      ],
      closing:
        'Thank you for the time and information provided during the registration process.',
    },
    version: '1.0',
    active: true,
  },

  {
    id: 'REG-012',
    baseEvent: 'REG-012',
    family: F06,
    section: 'REG',
    title: 'Application withdrawn',
    gate: NotificationGate.P1,
    stream: NotificationStream.TRANSACTIONAL,
    channels: EMAIL_AND_IN_APP,
    trigger: 'Authorized applicant or reviewer confirms withdrawal.',
    audience: 'Primary contact',
    recipientResolution: 'application.primaryContact',
    subject: 'Your ZoikoMeds registration application has been withdrawn',
    preheader: 'The application is no longer under review.',
    cta: {
      label: 'View application record',
      destination: '{{Registration Status Link}}',
    },
    requiredFields: [
      'Recipient First Name',
      'Organization Name',
      'Registration Reference',
      'Withdrawal Date',
      'Withdrawal Explanation',
      'Withdrawal Requestor Description',
      'Registration Status Link',
    ],
    copy: {
      intro: [
        "This email confirms that {{Organization Name}}'s application to join the ZoikoMeds network has been withdrawn.",
        'The application is no longer active and no approval decision will be issued unless the withdrawal is reversed through an authorized process.',
        '{{Withdrawal Explanation}}',
        'Where permitted, a new application may be submitted in the future using current information and supporting evidence.',
      ],
      reference: [
        { label: 'Organization', value: '{{Organization Name}}' },
        { label: 'Registration reference', value: '{{Registration Reference}}' },
        { label: 'Withdrawal date', value: '{{Withdrawal Date}}' },
        { label: 'Current status', value: 'Withdrawn' },
        { label: 'Requested by', value: '{{Withdrawal Requestor Description}}' },
      ],
      importantInformation: [
        'Withdrawal is not an approval or decline decision and must not be represented as a finding about the organization. Records will be retained or deleted under the applicable retention policy.',
      ],
      closing:
        'Contact ZoikoMeds promptly if you believe the application was withdrawn without authorization.',
    },
    version: '1.0',
    active: true,
  },
];
