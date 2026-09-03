#!/usr/bin/env node
/**
 * Run one real prescription image through the real pipeline and print what each
 * stage produced.
 *
 * Written because the scan changes had been verified against OCR *text* only.
 * Simulated text proves the classifier; it does not prove that Tesseract reads
 * a given photograph well enough for the classifier to be given the right
 * input, and those are different failures with different fixes.
 *
 *   cd frontend
 *   npx vite-node scripts/verify-prescription.mjs -- ../path/to/prescription.jpg
 *
 * Run through vite-node, not plain node: the scan modules import each other
 * without file extensions, which is Vite's resolution and not Node's. vite-node
 * ships with vitest, so nothing extra is installed.
 *
 * With the API running, add --api to resolve names against the real MediBase
 * instead of reporting every candidate unmatched:
 *
 *   npx vite-node scripts/verify-prescription.mjs -- rx.jpg --api http://localhost:8000/api
 *
 * WHAT THIS DOES NOT COVER
 *
 * Node has no canvas, so `prepareImageForOcr` — the upscale-and-contrast pass
 * the browser applies before OCR — does not run here. That step exists because
 * it is what stops a low-resolution photo being misread, so this script's OCR
 * is the *worse* of the two readings: text it recovers, the browser will too.
 * Text it loses may still be recovered in the app. Use it to see the shape of
 * the failure, then confirm the fix in the browser.
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { createWorker } from 'tesseract.js'
import { extractCandidateLines, parseCandidate } from '../src/features/scan/candidate-extract.js'
import { assessScanQuality } from '../src/features/scan/scan-quality.js'
import { bestSimilarity } from '../src/features/scan/text-normalize.js'
import {
  MATCH_SOURCE,
  bandFor,
  computeConfidence,
  needsConfirmation,
} from '../src/features/scan/confidence.js'

/** Mirrors MEDIBASE_MATCH_FLOOR in extract-prescription.js. */
const MATCH_FLOOR = 0.72

const args = process.argv.slice(2)
const imagePath = args.find((arg) => !arg.startsWith('--'))
const apiIndex = args.indexOf('--api')
const apiBase = apiIndex === -1 ? null : args[apiIndex + 1]

if (!imagePath) {
  console.error(
    'Usage: npx vite-node scripts/verify-prescription.mjs -- <image> [--api http://localhost:8000/api]',
  )
  process.exit(1)
}

const rule = (title) => console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`)

async function matchAgainstCatalog(name) {
  if (!apiBase) return null
  const url = `${apiBase.replace(/\/$/, '')}/medibase/match?q=${encodeURIComponent(name)}&limit=5`
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const rows = await res.json()
    const scored = (rows ?? [])
      .map((row) => {
        const references = [row.canonicalName ?? row.name, row.genericName ?? row.generic, ...(row.brandNames ?? row.brands ?? [])]
          .filter(Boolean)
        return { row, score: bestSimilarity(name, references).score }
      })
      .sort((a, b) => b.score - a.score)
    const best = scored[0]
    return best && best.score >= MATCH_FLOOR ? best : null
  } catch (err) {
    console.warn(`  ! catalog unreachable (${err.message}) — continuing unmatched`)
    return null
  }
}

const image = await readFile(imagePath)

rule(`1. RAW TESSERACT OCR — ${basename(imagePath)}`)
console.log('(no canvas preprocessing in Node; the browser upscales first — see header)\n')

const worker = await createWorker('eng')
const { data } = await worker.recognize(image)
await worker.terminate()

const rawText = data.text ?? ''
const ocrConfidence = typeof data.confidence === 'number' ? data.confidence / 100 : null
console.log(rawText.trimEnd() || '(nothing)')
console.log(`\nmean OCR confidence: ${ocrConfidence === null ? 'n/a' : ocrConfidence.toFixed(3)}`)

rule('2. CANDIDATE EXTRACTION')
const candidates = extractCandidateLines(rawText)
const parsed = candidates.map(parseCandidate).filter(Boolean)
if (parsed.length === 0) console.log('(no candidate survived extraction)')
for (const candidate of parsed) {
  console.log(
    `  ${candidate.name.padEnd(28)} strength=${(candidate.strength || '—').padEnd(12)} form=${candidate.form || '—'}`,
  )
}
console.log(`\n${parsed.length} candidate(s) from ${rawText.split(/\r?\n/).filter(Boolean).length} line(s)`)

rule('3. MEDIBASE MATCHING')
if (!apiBase) console.log('(--api not given; every candidate is reported unmatched)\n')
const medicines = []
for (const candidate of parsed) {
  const hit = await matchAgainstCatalog(candidate.name)
  const source = hit
    ? hit.score >= 0.995
      ? MATCH_SOURCE.MEDIBASE_EXACT
      : MATCH_SOURCE.MEDIBASE_FUZZY
    : MATCH_SOURCE.UNMATCHED
  const confidence = computeConfidence({
    nameSimilarity: hit ? hit.score : 1,
    source,
    evidence: candidate.evidence ?? {},
    ocrConfidence,
  })
  const medicineId = hit?.row?.id ?? null
  const medicine = {
    name: hit ? (hit.row.canonicalName ?? hit.row.name) : candidate.name,
    source,
    medicineId,
    matchScore: hit ? hit.score : null,
    confidence,
    band: bandFor(confidence),
    needsConfirmation: needsConfirmation(confidence, source, {
      medicineId,
      matchScore: hit ? hit.score : null,
    }),
  }
  if (medicine.band !== 'rejected') medicines.push(medicine)
  console.log(
    `  ${medicine.name.padEnd(28)} ${source.padEnd(16)} score=${
      hit ? hit.score.toFixed(3) : '  —  '
    } confidence=${confidence.toFixed(3)} band=${medicine.band}`,
  )
}

rule('4. SCAN QUALITY')
const quality = assessScanQuality({
  rawText,
  ocrConfidence,
  candidateCount: parsed.length,
  medicines,
  catalogReachable: Boolean(apiBase),
})
console.log(`  quality           : ${quality.quality}`)
console.log(`  reasons           : ${quality.reasons.join(', ') || '—'}`)
console.log(`  ASSISTED READING  : ${quality.shouldOfferVision ? 'OFFERED' : 'not offered'}`)
console.log(`  signals           :`, quality.signals)

rule('5. FINAL MEDICINE LIST')
const accepted = medicines.filter((m) => !m.needsConfirmation)
const confirm = medicines.filter((m) => m.needsConfirmation)
console.log(`  auto-accepted (${accepted.length}): ${accepted.map((m) => m.name).join(', ') || '—'}`)
console.log(`  to confirm    (${confirm.length}): ${confirm.map((m) => m.name).join(', ') || '—'}`)

rule('6. NOISE CHECK')
// The lines that must never reach the confirmation card.
const FORBIDDEN = [
  'And Redness',
  'Avoid Alcohol',
  'Liver Function Test',
  'Kidney Function Test',
  'Symptoms',
  'HOPI',
  'Daily',
  'Daly',
  'Anemaoon',
  'Anemoon',
]
const leaked = FORBIDDEN.filter((noise) =>
  medicines.some((m) => m.name.toLowerCase().includes(noise.toLowerCase())),
)
console.log(leaked.length === 0 ? '  PASS — no instruction or section text reached the list' : `  FAIL — leaked: ${leaked.join(', ')}`)
process.exit(leaked.length === 0 ? 0 : 1)
