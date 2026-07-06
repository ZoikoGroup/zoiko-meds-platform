# ZoikoMeds — Frontend Build Plan

**Stack:** Next.js (App Router) · TypeScript · Tailwind CSS
**Scope:** Public medicine search, availability experience, pharmacy portal, admin
console, and the Enterprise & Intelligence marketing/product pages (MediBase™,
ZoikoAvail™ API, ZoikoSignal™, Enterprise Solutions, Health Systems, Government &
Public Health).

> Status: **not yet scaffolded** (the `frontend/` folder is intentionally empty).
> This plan defines what to build and in what order.

---

## Why Next.js (App Router)

The Master Build Reference imposes heavy SEO/AEO + structured-data requirements on the
enterprise pages and requires accessible, server-rendered content. Next.js gives:

- **SSG/ISR** for marketing/enterprise pages (fast, indexable, schema-ready).
- **SSR** for search results and jurisdiction-aware content.
- **Client components/islands** for interactive search, dashboards, and portal apps.
- Route-level metadata + JSON-LD for the required schema types.

---

## Information architecture

```
/                             Home / positioning
/search                       Public medicine search (SSR)
/availability                 Availability confidence explainer
/trust                        Trust Center

Enterprise & Intelligence
/enterprise/solutions         Enterprise Solutions
/enterprise/medibase-data     MediBase™ Data
/enterprise/zoikoavail-api    ZoikoAvail™ API
/enterprise/zoikosignal       ZoikoSignal™ Intelligence
/enterprise/health-systems    Health Systems
/enterprise/government-public-health   Government & Public Health

Portals (authenticated app shells)
/pharmacy/*                   Pharmacy portal (verification, inventory signals)
/admin/*                      Admin console (governance, review queues)
```

---

## Phase 0 — Scaffold & design system (1 week)

**Goal:** runnable Next.js app with the shared UI foundation.

- [ ] `create-next-app` (App Router, TS, Tailwind, ESLint).
- [ ] Design tokens: color, type scale, spacing, radius, elevation (Tailwind config).
- [ ] Base components: Button, Input, Select, Card, Badge/StatusPill, Table, Modal,
      Tabs, Disclosure, Toast.
- [ ] Layout primitives: header, footer (with Enterprise & Intelligence nav), container.
- [ ] Accessibility baseline: focus rings, skip links, reduced-motion, 44px+ targets.
- [ ] Theming: light/dark, `prefers-color-scheme` + explicit toggle.
- [ ] API client wrapper (typed fetch to the backend, error handling).

**Exit criteria:** `npm run dev` serves a themed shell; Lighthouse a11y ≥ 95 on home.

---

## Phase 1 — Public medicine search (2 weeks)

**Goal:** the core consumer experience.

- [ ] `/search` with query input, results list, empty/zero-result states.
- [ ] Medicine result cards: identity (MediBase™) + availability confidence bands.
- [ ] Confidence UI: `HIGH/MODERATE/LOW/UNKNOWN` shown with icon + text + color
      (never color alone).
- [ ] "Requires confirmation" guidance; no exact stock, no reservations.
- [ ] Location/radius input (with permission prompt + manual entry).
- [ ] `/availability` explainer page describing what confidence means.
- [ ] SSR + metadata; JSON-LD `WebPage`/`FAQPage` where approved (no `Drug`/`Pharmacy`).

**Governance:** no clinical advice, no dispensing, no exact stock. Consumer never
routed into enterprise forms.

---

## Phase 2 — Enterprise & Intelligence pages (2–3 weeks)

**Goal:** conversion-led, SEO/AEO-optimized product pages per the wireframe specs.
Each page follows its six-section structure (hero → model → use cases → governance →
access/licensing → trust & close) with one dominant CTA.

- [ ] Shared enterprise page template (hero, section blocks, CTA strips, lead form).
- [ ] `/enterprise/medibase-data` — medicine identity graph visual + data governance.
- [ ] `/enterprise/zoikoavail-api` — API capability model + governance + eval path.
- [ ] `/enterprise/zoikosignal` — intelligence outputs (aggregate-only framing).
- [ ] `/enterprise/solutions` — cross-sell hub.
- [ ] `/enterprise/health-systems` — health-system workflows.
- [ ] `/enterprise/government-public-health` — public-sector, jurisdiction-aware.
- [ ] Lead form component → `POST /enterprise/inquiries` (work email, org, type,
      interest; reject PHI/secrets client-side).
- [ ] Per-page metadata, breadcrumb + `Organization` JSON-LD; contextual CTA routing.
- [ ] Analytics funnel events (arrival → engagement → intent → conversion) with the
      privacy guardrails (no PHI, no raw medicine names tied to users).

---

## Phase 3 — Pharmacy portal (3 weeks)

**Goal:** authenticated app for verified pharmacies.

- [ ] Auth flow (login, SSO-ready, MFA prompts) against backend auth.
- [ ] Onboarding + verification status views.
- [ ] Inventory-signal submission: manual entry, CSV upload, integration status.
- [ ] Participation + reliability visibility (own data only).
- [ ] Confirmation-workflow UI where enabled.
- [ ] Role-scoped navigation (`PHARMACY_STAFF` vs `PHARMACY_ADMIN`).

**Governance:** pharmacy sees only its own confidential inventory; audit-logged.

---

## Phase 4 — Admin console (2 weeks)

**Goal:** internal governance & review tooling.

- [ ] MediBase™ review queue (quality states, suppression, mappings).
- [ ] Pharmacy verification review + status transitions.
- [ ] Enterprise inquiry triage + routing.
- [ ] Suppression / controlled-medicine dashboards.
- [ ] Audit-log viewer.

**Access:** `ADMIN` only; no public indexing of authenticated surfaces.

---

## Phase 5 — Trust Center & content (1 week)

- [ ] `/trust` — security, privacy, governance posture, boundaries.
- [ ] Legal/trust copy blocks (no medical advice, no dispensing, aggregate intelligence).
- [ ] FAQ/AEO answer blocks where legal-approved.

---

## Phase 6 — Quality, performance & launch readiness (ongoing)

- [ ] WCAG 2.2 AA audit across all routes (keyboard, SR, contrast, reduced motion).
- [ ] Core Web Vitals budget (LCP/CLS/INP) + image optimization.
- [ ] SEO: sitemap, robots (noindex gated surfaces), canonical, structured data validation.
- [ ] E2E tests (Playwright) for search, lead forms, portal flows.
- [ ] Component tests + visual regression on the design system.
- [ ] Analytics validation against the privacy guardrails.

---

## Cross-cutting standards

| Concern | Standard |
|---------|----------|
| Accessibility | WCAG 2.2 AA; status = icon + text + color; 44px+ (48px preferred) targets. |
| SEO/AEO | Route metadata + JSON-LD; avoid `MedicalWebPage`/`Drug`/`Pharmacy`/`Offer` unless approved. |
| Indexing | Index public pages; noindex portals, admin, gated docs/sandbox. |
| Privacy | No PHI, no raw medicine names tied to users, no exact stock into analytics. |
| Governance copy | No clinical advice, prescribing, substitution, dispensing, eligibility, or stock guarantees. |
| Data | All availability via governed backend endpoints; no client-side stock computation. |

## Suggested delivery order & rough sizing

```
Phase 0 → 1 (MVP public search) → 2 (enterprise pages, revenue surface)
Phase 3 (pharmacy portal) can start after Phase 0 in parallel with 2
Phase 4, 5 after core; Phase 6 continuous, gated before launch
```

MVP target (Phases 0–2): **~5–6 weeks** with 2 frontend engineers, then portals.
