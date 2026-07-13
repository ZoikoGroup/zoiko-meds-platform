// Content for the Leadership & Oversight ("Accountable by design") page.
// Icons are stored inline as lucide components — same convention as
// routes/navigation.js — so the page just renders f.icon.
import {
  Compass,
  Network,
  ShieldPlus,
  Lock,
  UserRound,
  Share2,
  Globe,
  Landmark,
  Stethoscope,
  Accessibility,
  Fingerprint,
  BadgeCheck,
} from 'lucide-react'

// The six accountable governance domains, in display order.
export const oversightFunctions = [
  {
    id: 'executive',
    title: 'Executive & Group Oversight',
    description:
      'Long-term platform direction, organizational accountability, and governance alignment across ZoikoMeds and the wider Zoiko Group.',
    tag: 'Executive Oversight',
    icon: Compass,
    accent: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  {
    id: 'platform-security',
    title: 'Platform & Security Architecture',
    description:
      'Engineering foundation, zero-trust security, APIs, data pipelines, threat modeling, incident readiness, and enterprise deployment standards.',
    tag: 'Engineering & Security Governance',
    icon: Network,
    accent: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  },
  {
    id: 'medicine-pharmacy',
    title: 'Medicine & Pharmacy Governance',
    description:
      'Medicine identity standards, availability-confidence boundaries, controlled-medicine policy, and safe pharmacy participation models.',
    tag: 'Medicine Governance',
    icon: ShieldPlus,
    accent: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  },
  {
    id: 'privacy-compliance',
    title: 'Privacy & Compliance',
    description:
      "Privacy controls, consent, auditability, data residency, and the platform's healthcare-adjacent compliance posture — GDPR, UK-GDPR, HIPAA-aware operation, and jurisdictional controls.",
    tag: 'Trust & Compliance',
    icon: Lock,
    accent: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
  },
  {
    id: 'product-patient',
    title: 'Product & Patient Experience',
    description:
      'Ensures the platform remains clear, accessible (WCAG 2.2 AA), and safe across patient, caregiver, pharmacy, wholesale, and enterprise journeys.',
    tag: 'Product Governance',
    icon: UserRound,
    accent: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  },
  {
    id: 'ecosystem-commercial',
    title: 'Ecosystem & Commercial Governance',
    description:
      'Governs how ZoikoMeds engages hospital systems, pharmacies, wholesalers, manufacturers, and public-health bodies — under contract, verification, and jurisdictional controls.',
    tag: 'Commercial Governance',
    icon: Share2,
    accent: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  },
]

// The recognized standards / frameworks the platform operates against.
export const governanceStandards = [
  { id: 'gdpr', name: 'GDPR', detail: 'EU Data Protection', icon: Globe },
  { id: 'uk-gdpr', name: 'UK-GDPR', detail: 'UK Data Protection', icon: Landmark },
  { id: 'hipaa', name: 'HIPAA-Aware', detail: 'Architecture', icon: Stethoscope },
  { id: 'wcag', name: 'WCAG 2.2 AA', detail: 'Accessibility', icon: Accessibility },
  { id: 'nist', name: 'NIST 800-63B', detail: 'Authentication', icon: Fingerprint },
  { id: 'soc2', name: 'SOC 2 Type II', detail: 'In Progress', icon: BadgeCheck, pending: true },
]

// Position-based governance staging note (shown beside the page intro).
export const governanceStage = {
  current: 'Stage 1 → Position-based governance.',
  summary:
    "We're building ZoikoMeds with a disciplined governance model. Names and advisors will be added when formally appointed and consented.",
  trigger:
    'Activated when (a) first enterprise contract is signed, (b) advisory appointments are contracted, or (c) institutional funding begins — whichever comes first.',
}
