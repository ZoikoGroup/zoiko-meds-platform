// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

/**
 * Three ways in, three different places.
 *
 * In the Android app all three used to open the file manager: Capacitor's
 * WebView opens the camera only for accept="image/*" and sends every other file
 * input to ACTION_GET_CONTENT. So in the app "Take a photo" and "From gallery"
 * go through the camera plugin, and "Browse file" stays a file input — the one
 * place the file manager is the right answer.
 *
 * These tests hold the page to that, and to the rest of the brief: whatever
 * comes back joins the normal reading flow, backing out says nothing, a real
 * failure is reported and never answered with the file manager, and the website
 * keeps clicking its inputs directly.
 */

const platform = vi.hoisted(() => ({ IS_NATIVE: true }))
const pickMock = vi.hoisted(() => vi.fn())
const readPrescriptionMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/platform', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    get IS_NATIVE() {
      return platform.IS_NATIVE
    },
  }
})
vi.mock('@/lib/native', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, pickPrescriptionImage: (...args) => pickMock(...args) }
})
vi.mock('../prescription-reader', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, readPrescription: (...args) => readPrescriptionMock(...args) }
})
vi.mock('@/services/medicine-api', () => ({ matchMedicines: vi.fn() }))
vi.mock('@/providers/language-provider', () => ({
  useLanguage: () => ({ t: (_key, fallback) => fallback }),
}))

const { ScanPrescription } = await import('../scan-prescription')
const { NativeMediaError } = await import('@/lib/native')

const emptyResult = {
  medicines: [],
  confident: [],
  unconfirmed: [],
  warnings: [],
  stats: { pages: null, candidates: 0, ocrConfidence: null },
  quality: null,
  needsVisionFallback: false,
  visionUsed: false,
  pageImages: [],
  sourceType: 'image',
  message: null,
}

/** Which of the page's three hidden inputs an element is. */
const inputKind = (el) =>
  el.hasAttribute('capture') ? 'camera' : el.accept.includes('application/pdf') ? 'file' : 'gallery'

let clicked
let flash

beforeEach(() => {
  platform.IS_NATIVE = true
  pickMock.mockReset()
  readPrescriptionMock.mockReset()
  readPrescriptionMock.mockResolvedValue(emptyResult)
  clicked = []
  flash = vi.fn()
  // Record which input a click reached, without opening anything.
  vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function record() {
    if (this.type === 'file') clicked.push(inputKind(this))
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const renderPage = () => render(<ScanPrescription flash={flash} />)
const button = (name) => screen.getByRole('button', { name })
const photo = () => new File([new Uint8Array([1, 2, 3])], 'prescription-photo-1.jpg', { type: 'image/jpeg' })

describe('in the Android app, each option goes to its own place', () => {
  it('Take a photo asks the camera plugin for the camera — not a file input', async () => {
    pickMock.mockResolvedValue({ kind: 'cancelled' })
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/take a photo/i))

    expect(pickMock).toHaveBeenCalledWith('camera')
    expect(clicked).toEqual([])
  })

  it('From gallery asks the camera plugin for the gallery — not a file input', async () => {
    pickMock.mockResolvedValue({ kind: 'cancelled' })
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/from gallery/i))

    expect(pickMock).toHaveBeenCalledWith('gallery')
    expect(clicked).toEqual([])
  })

  it('Browse file still opens the file picker, and never the camera plugin', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/browse file/i))

    expect(clicked).toEqual(['file'])
    expect(pickMock).not.toHaveBeenCalled()
  })
})

describe('in the Android app, what comes back joins the normal reading flow', () => {
  it('reads a photo taken with the camera', async () => {
    const file = photo()
    pickMock.mockResolvedValue({ kind: 'file', file })
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/take a photo/i))

    await waitFor(() => expect(readPrescriptionMock).toHaveBeenCalledTimes(1))
    expect(readPrescriptionMock.mock.calls[0][0]).toBe(file)
  })

  it('reads a photo chosen from the gallery', async () => {
    const file = photo()
    pickMock.mockResolvedValue({ kind: 'file', file })
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/from gallery/i))

    await waitFor(() => expect(readPrescriptionMock).toHaveBeenCalledTimes(1))
    expect(readPrescriptionMock.mock.calls[0][0]).toBe(file)
  })

  it('still applies the page’s own file checks to what the camera returns', async () => {
    // One validation path for every source: an oversized capture is refused the
    // same way an oversized browsed file is.
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' })
    pickMock.mockResolvedValue({ kind: 'file', file: huge })
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/take a photo/i))

    await waitFor(() => expect(flash).toHaveBeenCalledWith('File is larger than 10 MB.'))
    expect(readPrescriptionMock).not.toHaveBeenCalled()
  })
})

describe('in the Android app, backing out and failing', () => {
  it('says nothing when the person closes the camera', async () => {
    pickMock.mockResolvedValue({ kind: 'cancelled' })
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/take a photo/i))

    await waitFor(() => expect(pickMock).toHaveBeenCalled())
    expect(flash).not.toHaveBeenCalled()
    expect(readPrescriptionMock).not.toHaveBeenCalled()
    expect(clicked).toEqual([])
  })

  it('reports a refused camera permission — and does not open the file manager instead', async () => {
    pickMock.mockRejectedValue(
      new NativeMediaError({ key: 'cameraPermissionDenied', fallback: 'Camera access is turned off.' }),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/take a photo/i))

    await waitFor(() => expect(flash).toHaveBeenCalledWith('Camera access is turned off.'))
    expect(clicked).toEqual([])
  })

  it('reports a device with no camera — and does not open the file manager instead', async () => {
    pickMock.mockRejectedValue(
      new NativeMediaError({ key: 'noCameraAvailable', fallback: 'No camera was found on this device.' }),
    )
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/take a photo/i))

    await waitFor(() => expect(flash).toHaveBeenCalledWith('No camera was found on this device.'))
    expect(clicked).toEqual([])
  })

  it('reports a gallery failure in gallery terms', async () => {
    pickMock.mockRejectedValue(new Error('something unexpected'))
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/from gallery/i))

    await waitFor(() =>
      expect(flash).toHaveBeenCalledWith('The photo could not be opened. Please try again.'),
    )
    expect(clicked).toEqual([])
  })

  it('falls back to the input only when the app was built without the camera plugin', async () => {
    pickMock.mockResolvedValue({ kind: 'unavailable' })
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/take a photo/i))

    await waitFor(() => expect(clicked).toEqual(['camera']))
    expect(flash).not.toHaveBeenCalled()
  })
})

describe('on the website, nothing changes', () => {
  beforeEach(() => {
    platform.IS_NATIVE = false
  })

  it('Take a photo clicks the camera input directly', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/take a photo/i))

    expect(clicked).toEqual(['camera'])
    expect(pickMock).not.toHaveBeenCalled()
  })

  it('From gallery clicks the gallery input directly', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(button(/from gallery/i))

    expect(clicked).toEqual(['gallery'])
    expect(pickMock).not.toHaveBeenCalled()
  })
})
