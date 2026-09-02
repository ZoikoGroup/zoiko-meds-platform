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

import { createWorker } from 'tesseract.js'

const IDLE_TERMINATE_MS = 60_000

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
      logger: (message) => {
        if (progressHandler && message?.status === 'recognizing text') {
          progressHandler(typeof message.progress === 'number' ? message.progress : 0)
        }
      },
    }).catch((err) => {
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

/**
 * OCR one image (File, Blob, canvas, ImageData or data URL).
 *
 * @returns {Promise<{ text: string, confidence: number }>} confidence is 0..1.
 */
export async function recognize(image, { onProgress } = {}) {
  const worker = await getWorker()
  clearIdleTimer()
  activeJobs += 1
  progressHandler = typeof onProgress === 'function' ? onProgress : null

  try {
    const result = await worker.recognize(image)
    const data = result?.data ?? {}
    // Tesseract reports confidence as a 0..100 percentage.
    const rawConfidence = typeof data.confidence === 'number' ? data.confidence : null
    return {
      text: data.text ?? '',
      confidence: rawConfidence === null ? 0.5 : Math.min(1, Math.max(0, rawConfidence / 100)),
    }
  } catch (err) {
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
