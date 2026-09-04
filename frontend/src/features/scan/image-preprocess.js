// Image preprocessing before OCR.
//
// Tesseract is trained on roughly 300dpi print. A phone screenshot or a
// downscaled photo of a typed prescription arrives well below that, and the
// engine starts substituting visually similar words — reading "Amoxicillin
// 500 mg Capsule" as "Amescitin Cepsutel". No amount of downstream matching
// recovers that, because the characters were never read.
//
// Upscaling to a comfortable working height, flattening onto white, and
// stretching contrast to full range fixes most of it at the source. PDF pages
// already get this treatment via the 2.0 render scale in pdf-text.js.
//
// Every step degrades gracefully: if the browser cannot give us pixel access
// (or we are in a non-DOM environment), the original file is handed to
// Tesseract unchanged rather than failing the scan.

/** Target long edge for OCR. Below this, small scans lose character detail. */
const TARGET_LONG_EDGE = 2200
/** Never blow a large image up past this — memory cost without accuracy gain. */
const MAX_LONG_EDGE = 3500

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Image could not be decoded.'))
    }
    image.src = objectUrl
  })
}

/**
 * Grayscale + linear contrast stretch, in place on the canvas.
 * Ignored silently if the context refuses pixel access (tainted canvas, or a
 * stubbed context in tests).
 */
function normalizeContrast(context, width, height) {
  let imageData
  try {
    imageData = context.getImageData(0, 0, width, height)
  } catch {
    return
  }
  if (!imageData?.data) return

  const pixels = imageData.data
  let min = 255
  let max = 0

  // Pass 1 — luminance range.
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
    if (luma < min) min = luma
    if (luma > max) max = luma
  }

  // A flat image (blank page, or already binarized) has nothing to stretch.
  const range = max - min
  if (range < 24) return

  // Pass 2 — grayscale and rescale to the full 0..255 range.
  const scale = 255 / range
  for (let i = 0; i < pixels.length; i += 4) {
    const luma = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]
    const stretched = Math.max(0, Math.min(255, (luma - min) * scale))
    pixels[i] = stretched
    pixels[i + 1] = stretched
    pixels[i + 2] = stretched
    pixels[i + 3] = 255
  }
  context.putImageData(imageData, 0, 0)
}

/**
 * Grayscale and stretch an already-rendered canvas, in place.
 *
 * A scanned PDF took the render scale and the white ground but none of this,
 * so a photocopied prescription — the low-contrast case this exists for —
 * reached Tesseract untouched while a photo of the same page did not. Exposed
 * separately because a rasterized page has no File to go back to.
 *
 * Returns the same canvas, normalized where the browser allowed pixel access
 * and unchanged where it did not.
 */
export function normalizeCanvasForOcr(canvas) {
  try {
    if (!canvas?.width || !canvas?.height) return canvas
    const context = canvas.getContext?.('2d')
    if (!context) return canvas
    normalizeContrast(context, canvas.width, canvas.height)
  } catch {
    // Non-fatal: OCR the canvas as rendered.
  }
  return canvas
}

/**
 * Prepare an image file for OCR.
 *
 * @returns the prepared canvas, or the original file when preprocessing is
 *          unavailable — callers can pass either straight to Tesseract.
 */
export async function prepareImageForOcr(file) {
  try {
    if (typeof Image === 'undefined' || typeof document === 'undefined') return file

    const image = await loadImage(file)
    const naturalLongEdge = Math.max(image.naturalWidth, image.naturalHeight)
    if (!naturalLongEdge) return file

    // Upscale small images toward the target; leave large ones alone, but
    // never exceed the ceiling.
    let scale = 1
    if (naturalLongEdge < TARGET_LONG_EDGE) scale = TARGET_LONG_EDGE / naturalLongEdge
    if (naturalLongEdge * scale > MAX_LONG_EDGE) scale = MAX_LONG_EDGE / naturalLongEdge

    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))

    const context = canvas.getContext('2d')
    if (!context) return file

    // Flatten transparency onto white — a PNG with an alpha background
    // otherwise rasterizes dark-on-dark and OCR returns nothing.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    if (typeof context.imageSmoothingQuality === 'string' || 'imageSmoothingQuality' in context) {
      context.imageSmoothingQuality = 'high'
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    normalizeContrast(context, canvas.width, canvas.height)
    return canvas
  } catch {
    // Any failure here is non-fatal: OCR the original file instead.
    return file
  }
}
