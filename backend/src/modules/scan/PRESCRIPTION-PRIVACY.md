# Prescription scanning — privacy posture

A prescription is health information about an identifiable person. This file
records what the code actually does, and — kept deliberately separate — what
still needs a human decision before this feature serves real patients.

Nothing here is a compliance claim. "Implemented" below means "there is code and
a test for it", not "a regulator or counsel has agreed it is sufficient".

---

## Implemented technical controls

Each of these is enforced in code and covered by a test.

| Control | Where | Test |
|---|---|---|
| The uploaded file is never written to a database | no Prisma client in the scan path | `prescription-scan.service.spec.ts` → "never reaches the database" |
| The uploaded file is never written to disk | no `fs` import in the scan path | → "never writes the upload to disk" |
| No temporary files are created, so none need deleting | same | same |
| Bytes live only for the request | buffer is decoded, sent, dropped | → "holds the bytes only for the call" |
| No module-level cache of readings | `prescription-scan.service.ts` | → "keeps no module-level cache" |
| The response never echoes the document | `PrescriptionScanService.scan` | → "holds the bytes only for the call" |
| Logs carry type, size, timing and counts only | `PrescriptionScanService`, `GeminiPrescriptionService` | → "records operational metadata and nothing off the prescription" |
| Provider errors never reach the browser | `toHttpError` | `gemini-prescription.service.spec.ts` → "never leaks the upstream error" |
| Provider errors never reach a log line | `describeFailure` (type + HTTP status only) | → "never writes the prescription, or the key, into a log line" |
| The API key is server-side only | `backend/.env`, read via `ConfigService` | → "never puts the key in the availability answer" |
| The key is absent from the browser bundle | no frontend import of any model SDK | `prescription-reader.test.js` → "never sends a provider name or a credential" |
| The endpoint is authenticated and rate limited | `JwtAuthGuard`, `@Throttle(10/min)` | — |
| Uploads are bounded (10 MB) before anything is sent | `ScanPrescriptionDto`, `main.ts` | `prescription-scan.service.spec.ts` → size and type cases |
| A medicine is only "verified" once MediBase says so | `PrescriptionMatcherService` | `prescription-matcher.service.spec.ts` (whole file) |

### Provider retention — what the code chooses

Documents are sent **inline, base64, inside the request body**
(`inlineData` in `gemini-prescription.service.ts`). The Gemini **Files API is
deliberately not used**.

That matters for retention: Google's own documentation states that files
uploaded through the Files API are **stored for 48 hours**. Inline request data
is not described as having that storage behaviour, so the inline path avoids a
documented 48-hour copy of the prescription sitting on the provider's side.

**What this does not establish.** Avoiding the Files API removes one documented
retention mechanism. It does not tell us how long request payloads are retained
for abuse monitoring, whether they may be used for model improvement on the tier
in use, or what the applicable terms say. Those are questions for the Gemini
API terms and any data-processing agreement, not for this codebase — see below.

The 10 MB upload cap keeps prescriptions comfortably inside what the inline path
takes (Gemini documents up to 50 MB / 1000 pages), so there is currently no size
pressure to move to the Files API. **If that ever changes, re-open this
section**: the Files API would reintroduce provider-side storage and would need
an explicit delete call plus a fresh look at the retention question.

---

## Requires organizational / legal approval

None of these can be satisfied by code, and none of them are satisfied today.
This feature should not process real patients' prescriptions until they are.

- [ ] **Gemini production tier selected** — decide which tier/billing account
      serves production, and confirm its data-use terms are the ones reviewed.
- [ ] **Google data-use and retention terms reviewed** — specifically whether
      request payloads may be retained or used for model improvement on the
      chosen tier. The code's inline-only choice narrows this question; it does
      not answer it.
- [ ] **DPA / contract reviewed if required** — whether a data-processing
      agreement is needed for health information in the operating jurisdictions,
      and whether one is in place.
- [ ] **Prescription processing approved by the product / legal / privacy
      owner** — an explicit sign-off that sending prescription images to a
      third-party model is acceptable for this product, in these markets.
- [ ] **Production key separate from development** — the key used here is a
      development key and must not be the production one.
- [ ] **API key rotated before production** — the development key was pasted
      into a chat transcript during implementation and should be treated as
      exposed. Rotate it regardless of the above.
- [ ] **Billing and quota controls configured** — a per-project spend cap and
      quota alerting, so an abusive or looping client cannot run up cost. The
      endpoint is rate limited per user; that is not a budget control.
- [ ] **Logs verified not to contain prescription content** — the tests prove it
      for the code paths they cover; someone should confirm it against real
      production log output, including whatever the platform's own request
      logging adds.

---

## Patient-facing wording

The notice shown on the scan screen (`prescriptionPrivacyNotice`, all eight
locales) says:

> Your prescription is securely sent for document processing. ZoikoMeds does not
> retain the uploaded file after processing. Extracted medicines are checked
> against MediBase before they are shown as verified. ZoikoMeds does not
> process, validate, or fulfil prescriptions. No medical advice is provided.

The retention sentence is scoped to **ZoikoMeds** on purpose. It is a statement
about this system, which the tests above support. It deliberately does not say
anything about what a processing provider does with the file, because that has
not been verified — and a privacy notice is the worst possible place to guess.

The screen previously said *"Reading happens on your device — the file is not
uploaded."* That became false when reading moved server-side, and was corrected
in all eight locales at the same time.
