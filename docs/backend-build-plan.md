# ZoikoMeds — Backend Build Plan

**Stack:** NestJS · TypeScript · Prisma · PostgreSQL
**Scope:** Governed medicine availability infrastructure API (MediBase™, ZoikoAvail™,
ZoikoSignal™, pharmacy verification, public search, enterprise intake).

---

## Current state (scaffolded)

Already in [`backend/`](../backend):

- NestJS app bootstrap with global validation, Helmet, CORS, throttling, Swagger.
- Prisma schema with core models: `MedicineEntity`, `IdentifierMapping`, `Pharmacy`,
  `InventorySignal`, `AvailabilitySignal`, `SignalAggregate`, `EnterpriseInquiry`,
  `User`, `Jurisdiction`, `AuditLog`.
- Service-domain modules (module/controller/service): `health`, `medibase`,
  `availability`, `signal`, `search`, `pharmacy`, `enterprise`.
- Dockerfile (multi-stage, non-root) + docker-compose (API + PostgreSQL).

These are **skeletons**: happy-path logic, no auth, no migrations committed, no tests.
The phases below harden them into a production-ready service.

---

## Phase 0 — Foundations & environment (1 week)

**Goal:** repeatable local + CI environment, first migration, coding standards.

- [ ] Commit an initial Prisma migration (`prisma migrate dev --name init`).
- [ ] Add ESLint + Prettier config and a `lint`/`format` CI gate.
- [ ] Add `.editorconfig`, commit hooks (lint-staged).
- [ ] Structured logging (pino / Nest logger) with request IDs.
- [ ] Config validation on boot (`@nestjs/config` + Joi/zod schema for env).
- [ ] Global exception filter + standard error envelope.
- [ ] Health/readiness/liveness endpoints (extend existing `/health`).

**Exit criteria:** `docker compose up` boots API + DB, runs migration, `/api/health`
returns `db: up`.

---

## Phase 1 — MediBase™ medicine identity (2 weeks)

**Goal:** governed medicine identity & normalization as the substrate for search/API.

- [ ] Finalize `MedicineEntity` / `IdentifierMapping` schema (quality states,
      suppression, jurisdiction linkage, schema versioning).
- [ ] Normalization pipeline: name/brand/generic matching, spelling variants,
      strength/form parsing.
- [ ] Identifier mapping: NDC, RxNorm/RxCUI, GTIN/GS1, DIN, dm+d, ATC, EAN/UPC, local.
- [ ] Quality-state machine: `VERIFIED → NEEDS_REVIEW → DEPRECATED → SUPPRESSED`.
- [ ] Seed/import job for a reference dataset (jurisdiction-scoped, licensed).
- [ ] Data dictionary generation + change-log tracking.
- [ ] Endpoints: `GET /medibase/match`, `GET /medibase/:id` (suppressed hidden).

**Governance:** never return suppressed entities publicly; no clinical/substitution logic.

---

## Phase 2 — Pharmacy verification & inventory intake (2 weeks)

**Goal:** verified pharmacies can register and submit availability signals.

- [ ] Pharmacy registration + verification workflow
      (`UNVERIFIED → PENDING → VERIFIED / REJECTED / SUSPENDED`).
- [ ] Reliability scoring inputs (upload method, freshness history, confirmations).
- [ ] Inventory-signal intake: manual, CSV upload, API, POS integration.
- [ ] Confidential storage of exact quantities — **never** exposed on public surfaces.
- [ ] Participation toggle + jurisdiction assignment.
- [ ] Audit logging of all verification and inventory actions.

**Exit criteria:** a verified pharmacy can push signals that feed ZoikoAvail™.

---

## Phase 3 — ZoikoAvail™ confidence engine (2 weeks)

**Goal:** derive public-safe availability confidence from raw signals.

- [ ] Confidence model: freshness + pharmacy reliability + verification + upload method
      → `HIGH / MODERATE / LOW / UNKNOWN / SUPPRESSED`.
- [ ] Freshness metadata + `requiresConfirmation` flags.
- [ ] Recompute strategy: on-write triggers + scheduled recompute job.
- [ ] Controlled/restricted medicine suppression & masking rules (jurisdiction-aware).
- [ ] Radius/geo-aware availability queries.
- [ ] `EXPOSE_EXACT_STOCK` guard enforced at the query boundary (default off).

**Governance:** confidence bands only, no counts, no dispensing eligibility.

---

## Phase 4 — Public search (1 week)

**Goal:** consumer medicine search composing MediBase™ + ZoikoAvail™.

- [ ] Search ranking across candidate entities (relevance + quality).
- [ ] Location/radius params + jurisdiction filtering.
- [ ] Zero-result handling → emit anonymized event for ZoikoSignal™.
- [ ] Rate limiting + abuse detection on public endpoints.
- [ ] Response caching where signal freshness allows.

---

## Phase 5 — ZoikoSignal™ intelligence (2 weeks)

**Goal:** aggregated, anonymized shortage/demand intelligence.

- [ ] Event ingestion: searches, zero-results, restocks, confirmations.
- [ ] Aggregation jobs → `SignalAggregate` (time-bucketed, jurisdiction-scoped).
- [ ] Anonymization / k-anonymity thresholds before any output.
- [ ] Intelligence query API (contract-scoped, no user/patient-level data).
- [ ] Export pathways for approved enterprise/public-sector consumers.

**Governance:** aggregate-only; suppress low-count cells; no re-identification surface.

---

## Phase 6 — Auth, access control & API governance (2 weeks)

**Goal:** enterprise-grade access model for gated surfaces and ZoikoAvail™.

- [ ] AuthN: JWT/session + SSO readiness (OIDC), MFA for privileged roles.
- [ ] AuthZ: RBAC (`PUBLIC`, `PHARMACY_STAFF/ADMIN`, `ENTERPRISE`, `ADMIN`) + guards.
- [ ] API key / client-credential issuance, scoping, rotation, revocation.
- [ ] Contract-scoped entitlements per organization + jurisdiction.
- [ ] Rate-limit tiers by contract; abuse review triggers.
- [ ] Full audit trail (credential events, scope changes, sensitive calls).
- [ ] Gate + noindex Swagger/docs/sandbox in non-dev.

---

## Phase 7 — Enterprise intake & routing (1 week)

**Goal:** capture and route MediBase™ / ZoikoAvail™ / ZoikoSignal™ inquiries.

- [ ] Harden inquiry DTO validation; reject PHI/secrets by policy.
- [ ] Queue routing (api-review, data-commercial, security-procurement).
- [ ] CRM/webhook integration for lead handoff.
- [ ] Admin views for triage + status transitions.

---

## Phase 8 — Security, privacy & compliance hardening (ongoing, gated before launch)

- [ ] Threat model + security review against the Security/Privacy spec.
- [ ] Secrets management (vault/KMS), encryption at rest + in transit.
- [ ] PII/PHI data-flow review; confirm no patient data persisted.
- [ ] Data retention + deletion policies per jurisdiction.
- [ ] Dependency audit (`npm audit`) + SCA in CI; resolve current 25 advisories.
- [ ] Pen test + remediation before production access.

---

## Phase 9 — Testing, observability & delivery (ongoing)

- [ ] Unit tests (services) + e2e tests (controllers) — target coverage gates.
- [ ] Contract tests for ZoikoAvail™ (governance boundaries as assertions:
      no exact stock, no clinical fields).
- [ ] Seed + fixtures for deterministic test data.
- [ ] Metrics (Prometheus), tracing (OpenTelemetry), dashboards + alerts.
- [ ] CI/CD pipeline: lint → test → build image → migrate → deploy.
- [ ] Blue/green or rolling deploy; automated rollback on health failure.

---

## Cross-cutting engineering standards

| Concern | Standard |
|---------|----------|
| Validation | `class-validator` DTOs on every write; `whitelist + forbidNonWhitelisted`. |
| Errors | Standard error envelope; no leakage of internal detail. |
| Data access | Prisma only; no raw SQL on public paths without review. |
| Governance flags | `EXPOSE_EXACT_STOCK` and jurisdiction checks enforced centrally. |
| Auditability | Versioned schema/mappings; audit log on sensitive actions. |
| Migrations | Every schema change ships a reviewed Prisma migration. |

## Suggested delivery order & rough sizing

```
Phase 0 → 1 → 2 → 3 → 4   (MVP: search on governed identity + availability)
Phase 6 (auth) can run in parallel from Phase 2 onward
Phase 5, 7 after MVP; Phase 8, 9 continuous, gated before launch
```

MVP target (Phases 0–4 + minimal auth): **~8–10 weeks** with 2 backend engineers.
