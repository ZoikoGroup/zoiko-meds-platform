import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Assisted reading is the one step that uploads the prescription itself, and it
// waits on a vision model — so it is also the one that can hang. It had no
// deadline of its own: a stalled request left the scanner on its spinner with
// no way out but a reload.

const apiFetchMock = vi.fn()
vi.mock('@/lib/api-client', () => ({
  apiFetch: (...args) => apiFetchMock(...args),
}))

const { MAX_FALLBACK_IMAGES, VISION_TIMEOUT_MS, VisionTimeoutError, extractWithVision } =
  await import('../vision-fallback')

const image = (n = 1) => `data:image/jpeg;base64,PAGE${n}`

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('extractWithVision', () => {
  it('posts the page images and returns the medicines', async () => {
    apiFetchMock.mockResolvedValue({ medicines: [{ name: 'Amoxicillin', confidence: 0.8 }] })

    const medicines = await extractWithVision([image()])

    expect(medicines).toHaveLength(1)
    const [path, options] = apiFetchMock.mock.calls[0]
    expect(path).toBe('/scan/vision-extract')
    expect(options.body.images).toEqual([image()])
  })

  it('sends no more pages than the backend accepts', async () => {
    apiFetchMock.mockResolvedValue({ medicines: [] })

    await extractWithVision(Array.from({ length: 9 }, (_, i) => image(i)))

    const [, options] = apiFetchMock.mock.calls[0]
    expect(options.body.images).toHaveLength(MAX_FALLBACK_IMAGES)
  })

  it('does not call the API at all with nothing to send', async () => {
    expect(await extractWithVision([])).toEqual([])
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('passes an abort signal so the request can be given up on', async () => {
    apiFetchMock.mockResolvedValue({ medicines: [] })

    await extractWithVision([image()])

    const [, options] = apiFetchMock.mock.calls[0]
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.signal.aborted).toBe(false)
  })

  it('gives up on a request that never answers', async () => {
    // The API hangs; only the caller's own deadline ends this.
    apiFetchMock.mockImplementation(
      (_path, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )

    await expect(extractWithVision([image()], { timeoutMs: 10 })).rejects.toBeInstanceOf(
      VisionTimeoutError,
    )
  })

  it('says the timeout is worth retrying', async () => {
    apiFetchMock.mockImplementation(
      (_path, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )

    await expect(extractWithVision([image()], { timeoutMs: 10 })).rejects.toMatchObject({
      retryable: true,
      message: expect.stringMatching(/try again/i),
    })
  })

  it('aborts the request itself, not just the wait', async () => {
    let captured = null
    apiFetchMock.mockImplementation(
      (_path, { signal }) =>
        new Promise((_resolve, reject) => {
          captured = signal
          signal.addEventListener('abort', () => {
            const err = new Error('aborted')
            err.name = 'AbortError'
            reject(err)
          })
        }),
    )

    await extractWithVision([image()], { timeoutMs: 10 }).catch(() => {})

    expect(captured?.aborted).toBe(true)
  })

  it('passes a genuine API failure through untouched', async () => {
    // A refusal from the server is not a timeout and must not be reported as one.
    apiFetchMock.mockRejectedValue(new Error('Assisted reading is not configured on this deployment.'))

    await expect(extractWithVision([image()])).rejects.toThrow(/not configured/)
  })

  it('waits a whole minute before giving up by default', async () => {
    // Long enough for a real four-page read; short enough to end a stuck one.
    expect(VISION_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000)
    expect(VISION_TIMEOUT_MS).toBeLessThanOrEqual(120_000)
  })

  it('tolerates a response with no medicines array', async () => {
    apiFetchMock.mockResolvedValue({})
    expect(await extractWithVision([image()])).toEqual([])
  })
})
