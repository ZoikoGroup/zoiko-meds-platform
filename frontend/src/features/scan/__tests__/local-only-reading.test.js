// Reading stays on the device for this phase.
//
// The scan pipeline is local — tesseract.js and pdf.js, both in the browser —
// with one exception: assisted reading posted the rendered page to
// POST /scan/vision-extract, where a hosted model read it. That was the only
// path by which a prescription left the browser, and it is switched off here.
//
// This is a source contract rather than a render test. What has to be
// guaranteed is the absence of a call, and absence is proved by there being no
// code that could make one — a render test can only show that one particular
// interaction did not trigger it. So the component's code is checked for the
// import, the endpoint and the call, while the service is checked to still be
// there: the point was to disconnect the model layer, not to demolish it.

import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (relative) => readFileSync(resolve(here, relative), 'utf8')

/**
 * The source with its commentary removed.
 *
 * The removal is deliberately described in comments that name what was removed,
 * so the prose mentions the endpoint and the handler. Matching the raw file
 * would flag that prose as if it were a live call. Only whole comment lines are
 * dropped — a trailing `//` is left alone, so a URL inside a string survives.
 */
function code(source) {
  return source
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      return !(
        trimmed.startsWith('//') ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('{/*')
      )
    })
    .join('\n')
}

const COMPONENT_SOURCE = read('../scan-prescription.jsx')
const COMPONENT = code(COMPONENT_SOURCE)
const PIPELINE = code(read('../extract-prescription.js'))

describe('13. the user flow cannot reach a hosted model', () => {
  it('the component imports nothing from vision-fallback', () => {
    expect(COMPONENT).not.toContain('vision-fallback')
  })

  it.each([
    'extractWithVision',
    'isVisionFallbackAvailable',
    'mergeVisionResults',
    'runVisionFallback',
  ])('the component has no %s left in it', (symbol) => {
    expect(COMPONENT).not.toContain(symbol)
  })

  it('the component names no scan endpoint', () => {
    expect(COMPONENT).not.toContain('/scan/vision-extract')
  })

  it('the pipeline itself never reaches for the fallback either', () => {
    // extract-prescription still exports mergeVisionResults for the service to
    // be reattached to, but must not invoke the transport on its own.
    expect(PIPELINE).not.toContain("from './vision-fallback'")
  })

  it('offers no assisted-reading action', () => {
    for (const gone of ['tryAssistedReading', 'assistedReadingNotice']) {
      expect(COMPONENT).not.toContain(gone)
    }
  })
})

describe('13. the implementation is kept, not deleted', () => {
  // The instruction was to prevent use, and to remove only what use requires.
  // Deleting the service would mean rebuilding and re-reviewing it later.
  it.each([
    '../vision-fallback.js',
    '../../../../../backend/src/modules/scan/vision.service.ts',
    '../../../../../backend/src/modules/scan/scan.controller.ts',
  ])('%s still exists', (relative) => {
    expect(existsSync(resolve(here, relative))).toBe(true)
  })

  it('the transport still knows the endpoint, ready to be reconnected', () => {
    expect(read('../vision-fallback.js')).toContain('/scan/vision-extract')
  })
})

describe('14. a poor scan explains itself', () => {
  it('says plainly that the prescription could not be read', () => {
    expect(COMPONENT).toContain("We couldn't read this prescription clearly.")
  })

  it.each([
    ['lighting', /good, even lighting/i],
    ['keeping the page flat', /flat and square/i],
    ['blur', /sharp, not blurred/i],
    ['framing the whole prescription', /whole prescription in the frame/i],
    ['using the original PDF', /original PDF/i],
  ])('suggests %s', (_label, pattern) => {
    expect(COMPONENT).toMatch(pattern)
  })

  it('offers a way to act on the advice', () => {
    expect(COMPONENT).toContain('Upload a clearer image or PDF')
  })

  it('shows the guidance whenever the read was poor', () => {
    // Previously gated on `visionAvailable` too, so a patient whose scan failed
    // saw nothing at all when the model was unreachable — the case in which
    // they most needed telling.
    expect(COMPONENT).toContain('{result.needsVisionFallback && !result.visionUsed && (')
    expect(COMPONENT).not.toContain('visionAvailable')
  })
})
