// Shared Tesseract.js worker.
//
// The previous implementation called `Tesseract.recognize()` once per image and
// once per PDF page. Each of those calls spins up a fresh worker and re-fetches
// the ~15 MB English trained-data bundle, so a five-page scan paid the download
// five times and a slow connection could stall the whole scan.
//
// Here a single worker is created lazily, reused for every page of every scan,
// and terminated after a period of inactivity so a user who scans once does not
// hold the WASM heap for the rest of the session.
//
// Its assets are served from our own origin, and every recognition is bounded
// by a timeout after which the worker is discarded rather than left cached in
// whatever state it got stuck in.

import { PSM, createWorker } from 'tesseract.js'

const IDLE_TERMINATE_MS = 60_000

/**
 * How long one page may spend in OCR before it is abandoned.
 *
 * There was no bound at all: a worker that failed to come up cleanly, or a
 * page that sent the engine somewhere pathological, left the scan spinning
 * with nothing to cancel it and no way back except a reload.
 *
 * Two minutes is deliberately generous. Tesseract on a large page on a slow
 * phone genuinely takes tens of seconds, and a timeout that fires on a scan
 * which would have succeeded is worse than the hang it replaces — it turns a
 * slow answer into a wrong one.
 */
export const OCR_PAGE_TIMEOUT_MS = 120_000

/**
 * Where Tesseract's runtime assets are served from.
 *
 * All three are ours. Left unset, tesseract.js fetches the worker, the WASM
 * core and the English trained data from cdn.jsdelivr.net the first time a
 * scan runs, which makes reading a prescription depend on a third party being
 * reachable and on no CSP standing in the way — a failure that appears only in
 * production, because every test mocks the library.
 *
 * `corePath` is a directory on purpose: the worker feature-detects SIMD and
 * picks a core from it at runtime, so the choice cannot be made here.
 * `langPath` is a directory too, and the worker appends `eng.traineddata.gz`.
 *
 * scripts/fetch-ocr-assets.mjs puts all of it under public/tesseract before
 * dev and build. Vite serves public/ from the site root, so these paths hold
 * in development and in the production bundle without being rewritten.
 */
const TESSERACT_ASSETS = {
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/core',
  langPath: '/tesseract/lang',
  // Load the worker straight from our origin instead of wrapping it in a
  // Blob URL. The wrapper exists to get around cross-origin worker rules,
  // which do not apply now that the script is same-origin, and it is the only
  // reason a CSP would need `worker-src blob:` rather than plain `'self'`.
  workerBlobURL: false,
}

/**
 * How Tesseract is told to segment the page.
 *
 * The default (AUTO) assumes a page of flowing prose and stitches text that
 * shares a baseline into one line. A prescription is usually a table —
 * medicines on the left, directions on the right — so AUTO welded the two
 * columns together and handed candidate extraction lines like
 * "3) FORCAN 150MG TABLET Weekly once", which parsed to the medicine name
 * "FORCAN Weekly once". That is the same defect the X/Y reconstruction fixed
 * for text PDFs, still live on the OCR path where pdfjs offers no geometry.
 *
 * SPARSE_TEXT makes no layout assumption: it finds text wherever it sits and
 * keeps the pieces separate, which is what a two-column prescription needs.
 *
 * Chosen from measurement, not theory. Across four rendered conditions
 * (single-column, two-column, 16px text, low contrast) against a fixed token
 * list:
 *
 *   AUTO          recall 26/36    SINGLE_BLOCK  recall 26/36
 *   SPARSE_TEXT   recall 28/36
 *
 * On a speckled, shadowed page — the photograph case — SPARSE_TEXT also
 * produced far less spurious text, 43% junk words against AUTO's 95%, so it is
 * not trading noise for recall. Latency was within a few percent throughout.
 * AUTO_OSD was rejected outright: it needs osd.traineddata, which is a fourth
 * asset we do not ship, and it scored worst anyway.
 *
 * The gain is real but modest, and every fixture was rendered rather than
 * photographed. Re-measure against real prescriptions before treating this as
 * settled.
 */
const PAGE_SEGMENTATION_MODE = PSM.SPARSE_TEXT

let workerPromise = null
let idleTimer = null
let activeJobs = 0

// createWorker takes its logger once, at construction, but progress is
// per-recognize. The worker forwards every event to whichever handler the
// current job registered.
let progressHandler = null

/** Thrown when OCR cannot run at all (worker failed to start). */
export class OcrUnavailableError extends Error {
  constructor(message, options) {
    super(message, options)
    this.name = 'OcrUnavailableError'
  }
}

function clearIdleTimer() {
  if (idleTimer !== null) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
}

function scheduleIdleTermination() {
  clearIdleTimer()
  if (typeof setTimeout !== 'function') return
  idleTimer = setTimeout(() => {
    if (activeJobs === 0) void terminateOcrWorker()
  }, IDLE_TERMINATE_MS)
  // Do not hold a Node/jsdom process open for the timer (no-op in browsers).
  if (typeof idleTimer === 'object' && idleTimer && typeof idleTimer.unref === 'function') {
    idleTimer.unref()
  }
}

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', undefined, {
      ...TESSERACT_ASSETS,
      logger: (message) => {
        if (progressHandler && message?.status === 'recognizing text') {
          progressHandler(typeof message.progress === 'number' ? message.progress : 0)
        }
      },
    })
      .then(async (worker) => {
        // Set once on the shared worker rather than per recognition: it costs a
        // round trip to the worker thread, and every page of every scan wants
        // the same answer.
        await worker.setParameters({ tessedit_pageseg_mode: PAGE_SEGMENTATION_MODE })
        return worker
      })
      .catch((err) => {
      // Do not cache a rejected promise — a transient network failure while
      // fetching the language data must not poison every later scan.
      workerPromise = null
      throw new OcrUnavailableError(
        'Could not start the text reader. Check your connection and try again.',
        { cause: err },
      )
    })
  }
  return workerPromise
}

/** Thrown when a page took longer than OCR_PAGE_TIMEOUT_MS. */
export class OcrTimeoutError extends OcrUnavailableError {
  constructor(message, options) {
    super(message, options)
    this.name = 'OcrTimeoutError'
  }
}

/**
 * Race a recognition against the clock.
 *
 * The loser is not cancellable — Tesseract offers no way to abort a running
 * recognition — so the timeout path throws and the caller discards the worker.
 * Leaving it cached would hand the next scan the same stuck engine.
 */
function withTimeout(promise, ms) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new OcrTimeoutError('Reading this page took too long and was stopped.')),
      ms,
    )
    if (typeof timer === 'object' && timer && typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer)
  })
}

/**
 * OCR one image (File, Blob, canvas, ImageData or data URL).
 *
 * @returns {Promise<{ text: string, confidence: number|null }>}
 *   confidence is 0..1, or null when Tesseract did not report one.
 */
export async function recognize(image, { onProgress, timeoutMs = OCR_PAGE_TIMEOUT_MS } = {}) {
  const worker = await getWorker()
  clearIdleTimer()
  activeJobs += 1
  progressHandler = typeof onProgress === 'function' ? onProgress : null

  try {
    const result = await withTimeout(worker.recognize(image), timeoutMs)
    const data = result?.data ?? {}
    // Tesseract reports confidence as a 0..100 percentage. Anything else —
    // absent, NaN, a string — is unknown, and unknown is reported as null.
    //
    // It used to become 0.5, which reads downstream as a middling but real
    // measurement: high enough to clear the low-confidence checks, so a page
    // whose reliability was never measured was quietly treated as acceptable.
    // Null cannot be mistaken for evidence either way.
    const raw = data.confidence
    const usable = typeof raw === 'number' && Number.isFinite(raw)
    return {
      text: data.text ?? '',
      confidence: usable ? Math.min(1, Math.max(0, raw / 100)) : null,
    }
  } catch (err) {
    // A timed-out or crashed worker is not reused. Terminating resets the
    // module back to "no worker", so the next scan builds a fresh one instead
    // of inheriting whatever state this one is in.
    if (err instanceof OcrTimeoutError) {
      void terminateOcrWorker()
      throw err
    }
    throw new OcrUnavailableError('Text reading failed on this page.', { cause: err })
  } finally {
    activeJobs -= 1
    progressHandler = null
    if (activeJobs === 0) scheduleIdleTermination()
  }
}

/** Terminate the shared worker and release its memory. Safe to call twice. */
export async function terminateOcrWorker() {
  clearIdleTimer()
  const pending = workerPromise
  workerPromise = null
  progressHandler = null
  if (!pending) return
  try {
    const worker = await pending
    await worker.terminate()
  } catch {
    // Already gone, or never started — nothing to release.
  }
}

/** Test seam: is a worker currently held open? */
export function isOcrWorkerActive() {
  return workerPromise !== null
}
