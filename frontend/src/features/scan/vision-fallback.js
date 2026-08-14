// AI/Vision fallback client.
//
// The model call happens on the ZoikoMeds backend, never in the browser: an API
// key shipped to the SPA would be readable by anyone who opens devtools. The
// frontend posts page images to POST /scan/vision-extract and gets structured
// medicine candidates back (backend: modules/scan).
//
// This is the ONLY step in the scan pipeline that uploads the prescription
// image itself, so it is gated behind an explicit user action — see
// scan-prescription.jsx. On-device OCR runs first and the fallback is offered
// only when OCR produced nothing usable or nothing confident.

import { apiFetch } from '@/lib/api-client'

/** Max images posted in one request; matches the backend's own limit. */
export const MAX_FALLBACK_IMAGES = 4

/**
 * Is the fallback configured on this deployment? Returns false rather than
 * throwing when the endpoint is missing or the API key is unset, so the UI can
 * simply not offer it.
 */
export async function isVisionFallbackAvailable() {
  try {
    const status = await apiFetch('/scan/vision-status')
    return Boolean(status?.available)
  } catch {
    return false
  }
}

/**
 * Send prescription page images for assisted reading.
 *
 * @param {string[]} images data: URLs (JPEG or PNG) of the prescription pages.
 * @returns {Promise<Array<{ name: string, genericName?: string, strength?: string,
 *   form?: string, frequency?: string, confidence: number }>>}
 */
export async function extractWithVision(images) {
  const payload = (images ?? []).filter(Boolean).slice(0, MAX_FALLBACK_IMAGES)
  if (!payload.length) return []

  const response = await apiFetch('/scan/vision-extract', {
    method: 'POST',
    body: { images: payload },
  })
  return Array.isArray(response?.medicines) ? response.medicines : []
}

/** Render a File to a JPEG data URL, bounded so uploads stay small. */
export async function fileToDataUrl(file, maxEdge = 2000) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = await new Promise((resolve, reject) => {
      const element = new Image()
      element.onload = () => resolve(element)
      element.onerror = () => reject(new Error('Could not read the image.'))
      element.src = objectUrl
    })

    const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}
