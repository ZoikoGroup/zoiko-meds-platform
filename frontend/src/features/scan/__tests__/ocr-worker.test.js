// The Tesseract wrapper: where its assets come from, and what it does when a
// page goes wrong.
//
// Three properties matter here and none of them was covered before.
//
// The assets are ours. Left unconfigured, tesseract.js fetches its worker, its
// WASM core and the English trained data from cdn.jsdelivr.net the first time
// anyone scans — so reading a prescription depended on a third party being up,
// on the user being online, and on no CSP objecting. That failure only ever
// appears in production, because every other test in this suite mocks the
// library away.
//
// One worker serves the whole scan. Creating one per page re-downloads the
// trained data per page.
//
// And nothing runs forever. There was no bound on a recognition at all: a
// worker that came up wrong left the scan spinning with no way back.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const createWorkerMock = vi.fn()
const recognizeMock = vi.fn()
const terminateMock = vi.fn(async () => {})
const setParametersMock = vi.fn(async () => {})

// PSM mirrors the real enum's values for the modes this module can select.
vi.mock('tesseract.js', () => ({
  createWorker: (...args) => createWorkerMock(...args),
  PSM: { AUTO: '3', SINGLE_BLOCK: '6', SPARSE_TEXT: '11' },
}))

/** Fresh module state per test — the worker is module-level by design. */
async function loadWorker() {
  vi.resetModules()
  return import('../ocr-worker')
}

const okResult = (over = {}) => ({ data: { text: 'AMOXICILLIN 500MG', confidence: 87, ...over } })

beforeEach(() => {
  vi.clearAllMocks()
  createWorkerMock.mockImplementation(async () => ({
    recognize: recognizeMock,
    terminate: terminateMock,
    setParameters: setParametersMock,
  }))
  recognizeMock.mockResolvedValue(okResult())
})

afterEach(() => {
  vi.useRealTimers()
})

describe('H, I, J, K. the assets are served from our own origin', () => {
  it('passes explicit paths for all three', async () => {
    const { recognize } = await loadWorker()

    await recognize('image.png')
    const options = createWorkerMock.mock.calls[0][2]

    expect(options.workerPath).toBe('/tesseract/worker.min.js')
    expect(options.corePath).toBe('/tesseract/core')
    expect(options.langPath).toBe('/tesseract/lang')
  })

  it.each(['workerPath', 'corePath', 'langPath'])('%s is a same-origin path', async (key) => {
    const { recognize } = await loadWorker()

    await recognize('image.png')

    expect(createWorkerMock.mock.calls[0][2][key]).toMatch(/^\//)
  })

  it('K. names no CDN anywhere in the worker configuration', async () => {
    // The assertion this whole change exists for.
    const { recognize } = await loadWorker()

    await recognize('image.png')
    const serialised = JSON.stringify(createWorkerMock.mock.calls[0][2])

    expect(serialised).not.toContain('jsdelivr')
    expect(serialised).not.toContain('unpkg')
    expect(serialised).not.toMatch(/https?:/)
  })

  it('loads the worker directly rather than through a Blob URL', async () => {
    // Same-origin now, so the Blob wrapper buys nothing — and it is the only
    // reason a CSP would need `worker-src blob:` instead of `'self'`.
    const { recognize } = await loadWorker()

    await recognize('image.png')

    expect(createWorkerMock.mock.calls[0][2].workerBlobURL).toBe(false)
  })

  it('sets the page segmentation mode once, on the shared worker', async () => {
    // Chosen by measurement: the default (AUTO) welds a prescription's two
    // columns into one line, so candidate extraction received medicine names
    // with the instruction text attached.
    const { recognize } = await loadWorker()

    await recognize('a.png')
    await recognize('b.png')

    expect(setParametersMock).toHaveBeenCalledTimes(1)
    expect(setParametersMock).toHaveBeenCalledWith({ tessedit_pageseg_mode: '11' })
  })

  it('still asks for English', async () => {
    const { recognize } = await loadWorker()

    await recognize('image.png')

    expect(createWorkerMock.mock.calls[0][0]).toBe('eng')
  })
})

describe('A, B. lifecycle', () => {
  it('A. creates no worker until something is recognized', async () => {
    await loadWorker()

    expect(createWorkerMock).not.toHaveBeenCalled()
  })

  it('B. reuses one worker across pages', async () => {
    const { recognize } = await loadWorker()

    await recognize('page-1.png')
    await recognize('page-2.png')
    await recognize('page-3.png')

    expect(createWorkerMock).toHaveBeenCalledTimes(1)
    expect(recognizeMock).toHaveBeenCalledTimes(3)
  })

  it('B. reuses it for concurrent pages too', async () => {
    const { recognize } = await loadWorker()

    await Promise.all([recognize('a.png'), recognize('b.png'), recognize('c.png')])

    expect(createWorkerMock).toHaveBeenCalledTimes(1)
  })

  it('reports it is holding a worker open, and stops after terminate', async () => {
    const { recognize, isOcrWorkerActive, terminateOcrWorker } = await loadWorker()
    await recognize('page.png')
    expect(isOcrWorkerActive()).toBe(true)

    await terminateOcrWorker()

    expect(isOcrWorkerActive()).toBe(false)
    expect(terminateMock).toHaveBeenCalled()
  })

  it('C. recovers after a failed startup instead of caching the failure', async () => {
    // A transient network failure while fetching assets must not poison every
    // later scan for the life of the page.
    createWorkerMock.mockRejectedValueOnce(new Error('network down'))
    const { recognize, OcrUnavailableError } = await loadWorker()

    await expect(recognize('page.png')).rejects.toBeInstanceOf(OcrUnavailableError)
    const second = await recognize('page.png')

    expect(second.text).toBe('AMOXICILLIN 500MG')
    expect(createWorkerMock).toHaveBeenCalledTimes(2)
  })
})

describe('D. a page that never finishes', () => {
  it('gives up rather than hanging forever', async () => {
    recognizeMock.mockImplementation(() => new Promise(() => {}))
    const { recognize, OcrTimeoutError } = await loadWorker()

    await expect(recognize('stuck.png', { timeoutMs: 10 })).rejects.toBeInstanceOf(OcrTimeoutError)
  })

  it('says so in words a patient can read', async () => {
    recognizeMock.mockImplementation(() => new Promise(() => {}))
    const { recognize } = await loadWorker()

    const error = await recognize('stuck.png', { timeoutMs: 10 }).catch((e) => e)

    expect(error.message).toMatch(/took too long/i)
    expect(error.message).not.toMatch(/tesseract|wasm|\/tesseract\//i)
  })

  it('discards the stuck worker', async () => {
    // Leaving it cached would hand the next scan the same stuck engine.
    recognizeMock.mockImplementation(() => new Promise(() => {}))
    const { recognize, isOcrWorkerActive } = await loadWorker()

    await recognize('stuck.png', { timeoutMs: 10 }).catch(() => {})
    await vi.waitFor(() => expect(isOcrWorkerActive()).toBe(false))

    expect(terminateMock).toHaveBeenCalled()
  })

  it('builds a fresh worker for the next scan', async () => {
    recognizeMock.mockImplementationOnce(() => new Promise(() => {}))
    const { recognize, isOcrWorkerActive } = await loadWorker()
    await recognize('stuck.png', { timeoutMs: 10 }).catch(() => {})
    await vi.waitFor(() => expect(isOcrWorkerActive()).toBe(false))

    const result = await recognize('good.png')

    expect(result.text).toBe('AMOXICILLIN 500MG')
    expect(createWorkerMock).toHaveBeenCalledTimes(2)
  })

  it('a page that finishes in time is untouched by the timeout', async () => {
    const { recognize } = await loadWorker()

    const result = await recognize('fine.png', { timeoutMs: 5_000 })

    expect(result.text).toBe('AMOXICILLIN 500MG')
    expect(terminateMock).not.toHaveBeenCalled()
  })

  it('exposes a default generous enough for a slow phone', async () => {
    // A timeout that fires on a scan which would have succeeded turns a slow
    // answer into a wrong one.
    const { OCR_PAGE_TIMEOUT_MS } = await loadWorker()

    expect(OCR_PAGE_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000)
  })
})

describe('E, F. confidence is reported honestly', () => {
  it.each([
    [90, 0.9],
    [50, 0.5],
    [20, 0.2],
    [0, 0],
    [100, 1],
  ])('F. normalizes %d to %s', async (raw, expected) => {
    recognizeMock.mockResolvedValue(okResult({ confidence: raw }))
    const { recognize } = await loadWorker()

    expect((await recognize('page.png')).confidence).toBeCloseTo(expected, 5)
  })

  it.each([
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['null', null],
    ['a string', '87'],
  ])('E. reports %s as null, not as a number', async (_label, raw) => {
    // It used to become 0.5 — a middling but real-looking measurement, high
    // enough to clear the low-confidence checks. A page whose reliability was
    // never measured was quietly treated as acceptable.
    recognizeMock.mockResolvedValue(okResult({ confidence: raw }))
    const { recognize } = await loadWorker()

    expect((await recognize('page.png')).confidence).toBeNull()
  })

  it('never invents 0.5', async () => {
    recognizeMock.mockResolvedValue(okResult({ confidence: undefined }))
    const { recognize } = await loadWorker()

    expect((await recognize('page.png')).confidence).not.toBe(0.5)
  })

  it('clamps a value outside the reported range', async () => {
    recognizeMock.mockResolvedValue(okResult({ confidence: 140 }))
    const { recognize } = await loadWorker()

    expect((await recognize('page.png')).confidence).toBe(1)
  })

  it('returns empty text rather than undefined when there is none', async () => {
    recognizeMock.mockResolvedValue({ data: { confidence: 80 } })
    const { recognize } = await loadWorker()

    expect((await recognize('blank.png')).text).toBe('')
  })
})

describe('O. failure is reported, never swallowed', () => {
  it('wraps a recognition crash', async () => {
    recognizeMock.mockRejectedValue(new Error('wasm trap'))
    const { recognize, OcrUnavailableError } = await loadWorker()

    await expect(recognize('bad.png')).rejects.toBeInstanceOf(OcrUnavailableError)
  })

  it('keeps the technical cause for a developer without showing it', async () => {
    const cause = new Error('RuntimeError: memory access out of bounds')
    recognizeMock.mockRejectedValue(cause)
    const { recognize } = await loadWorker()

    const error = await recognize('bad.png').catch((e) => e)

    expect(error.cause).toBe(cause)
    expect(error.message).not.toContain('memory access')
  })

  it('says nothing about internal paths when assets are missing', async () => {
    createWorkerMock.mockRejectedValue(new Error('404 /tesseract/core/x.wasm.js'))
    const { recognize } = await loadWorker()

    const error = await recognize('page.png').catch((e) => e)

    expect(error.message).not.toContain('/tesseract/')
    expect(error.message).toMatch(/connection|try again/i)
  })
})
