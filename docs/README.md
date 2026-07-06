# ZoikoMeds — Documentation

Engineering documentation for the ZoikoMeds platform (Global Medicine Availability
Infrastructure). This folder holds build plans and, over time, architecture,
governance, and operational references.

## Contents

| Document | Description |
|----------|-------------|
| [backend-build-plan.md](./backend-build-plan.md) | Phased build plan for the NestJS + Prisma + PostgreSQL API. |
| [frontend-build-plan.md](./frontend-build-plan.md) | Phased build plan for the Next.js public app, portals, and enterprise pages. |

## Platform primer

ZoikoMeds is a governed, jurisdiction-aware system that lets **verified pharmacies**
share medicine **availability signals** and helps the public, clinicians, and
institutions understand where medicines may be available. It is **not** a pharmacy,
marketplace, dispensing service, delivery platform, or medical-advice tool.

Three proprietary layers anchor the product:

- **MediBase™** — governed medicine identity & classification (normalizes names,
  brands, generics, strengths, forms, identifiers, jurisdictional attributes).
- **ZoikoAvail™** — real-time availability **confidence** engine (never exposes exact
  public stock).
- **ZoikoSignal™** — aggregated, anonymized shortage & access intelligence.

## Governance guardrails (apply to every phase)

- No exact public pharmacy stock exposure.
- No clinical advice, prescribing, substitution, dispensing, or eligibility claims.
- No patient identifiers / PHI collected by default.
- Jurisdiction-aware controls on medicine identity, identifiers, and visibility.
- Enterprise data access is contract-scoped and audit-logged.
- Accessibility target: WCAG 2.2 AA.

> Source of record: the ZoikoMeds Master Build Reference (Tier-0 specs). These plans
> operationalize that reference into buildable phases.
