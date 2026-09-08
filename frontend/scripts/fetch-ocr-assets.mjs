#!/usr/bin/env node
/**
 * Put Tesseract's runtime assets on our own origin.
 *
 * tesseract.js does not bundle what it needs to run. Left to itself it fetches
 * three things from cdn.jsdelivr.net the first time a scan starts — the worker
 * script, the WASM core, and the English trained data — which makes reading a
 * prescription depend on a third party being reachable, on no CSP standing in
 * the way, and on the user being online. None of that is visible in a test,
 * because every test mocks the library.
 *
 *   node scripts/fetch-ocr-assets.mjs
 *
 * Runs automatically before `dev` and `build` (see package.json). Everything it
 * writes is generated and git-ignored: the files are reproduced from the
 * installed package on any machine, so they are not the repository's business
 * and cannot drift from the version in package-lock.json.
 *
 * WHAT COMES FROM WHERE
 *
 * The worker and the core are copied out of node_modules, so they always match
 * the installed tesseract.js. The trained data is not published as part of any
 * package we depend on, so it is downloaded once and cached — a build-time
 * fetch, which is the same trust as `npm ci` and is not a runtime dependency.
 * Delete public/tesseract to force a refresh.
 */
import { createRequire } from 'node:module'
import { mkdir, copyFile, writeFile, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const here = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(here, '..', 'public', 'tesseract')

/**
 * Only the LSTM cores.
 *
 * `createWorker` computes `lstmOnly` from the OEM, and the default OEM is
 * LSTM-only, so the legacy cores are never requested. Shipping all of them
 * would be ~44 MB of build output to serve ~11 MB that is actually reachable.
 *
 * All three variants are still needed: the worker picks between them at
 * runtime by feature-detecting SIMD, and which one a given browser gets is not
 * knowable at build time. Each is self-contained — the .wasm.js embeds its
 * binary as base64, which is why the sibling .wasm files are not copied.
 */
const CORE_FILES = [
  'tesseract-core-lstm.wasm.js',
  'tesseract-core-simd-lstm.wasm.js',
  'tesseract-core-relaxedsimd-lstm.wasm.js',
]

/**
 * Where the trained data comes from.
 *
 * `4.0.0_best_int` is the LSTM-only set, matching the cores above. The URL is
 * the one tesseract.js itself would request at runtime; the point of this
 * script is that it is requested here, once, at build time, instead of by
 * every visitor who scans a prescription.
 */
const LANG = 'eng'
const LANG_URL = `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${LANG}/4.0.0_best_int/${LANG}.traineddata.gz`

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

async function sizeOf(path) {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

async function copyPackageFile(specifier, destination) {
  const source = require.resolve(specifier)
  await copyFile(source, destination)
  return (await stat(destination)).size
}

async function main() {
  await mkdir(join(OUT, 'core'), { recursive: true })
  await mkdir(join(OUT, 'lang'), { recursive: true })

  const workerBytes = await copyPackageFile(
    'tesseract.js/dist/worker.min.js',
    join(OUT, 'worker.min.js'),
  )
  console.log(`  worker.min.js            ${mb(workerBytes)}`)

  for (const file of CORE_FILES) {
    const bytes = await copyPackageFile(`tesseract.js-core/${file}`, join(OUT, 'core', file))
    console.log(`  core/${file.padEnd(42)} ${mb(bytes)}`)
  }

  // Cached deliberately. A rebuild should not re-download 3 MB, and an offline
  // rebuild should still succeed once the file is present.
  const langFile = join(OUT, 'lang', `${LANG}.traineddata.gz`)
  const existing = await sizeOf(langFile)
  if (existing) {
    console.log(`  lang/${LANG}.traineddata.gz  ${mb(existing)} (cached)`)
  } else {
    console.log(`  lang/${LANG}.traineddata.gz  downloading…`)
    const response = await fetch(LANG_URL)
    if (!response.ok) {
      throw new Error(
        `Could not download ${LANG}.traineddata (HTTP ${response.status}) from ${LANG_URL}. ` +
          'OCR assets must be present before building; retry with a network connection.',
      )
    }
    const body = Buffer.from(await response.arrayBuffer())
    await writeFile(langFile, body)
    console.log(`  lang/${LANG}.traineddata.gz  ${mb(body.length)}`)
  }
}

console.log('Provisioning self-hosted OCR assets into public/tesseract …')
main()
  .then(() => console.log('OCR assets ready — no runtime CDN fetch is required.'))
  .catch((error) => {
    console.error(`\nFailed to provision OCR assets: ${error.message}`)
    process.exit(1)
  })
