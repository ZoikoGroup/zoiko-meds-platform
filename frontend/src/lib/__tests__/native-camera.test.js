import { describe, expect, it } from 'vitest'
import {
  NativeMediaError,
  describeCameraFailure,
  mediaToFile,
  pickPrescriptionImage,
} from '@/lib/native'

/**
 * The parts of the app's camera and gallery path that can be exercised here.
 *
 * pickPrescriptionImage's native branch sits behind __ZM_NATIVE__, which these
 * tests compile to false — the same as the website. What it delegates to is
 * tested directly: how a plugin failure is told to the person, and how the
 * plugin's result becomes the File the scan page already knows how to read.
 */

const err = (code, message = 'failed') => Object.assign(new Error(message), { code })

describe('describeCameraFailure — what the person is told', () => {
  it('says nothing when they close the camera', () => {
    expect(describeCameraFailure(err('OS-PLUG-CAMR-0006'), 'camera')).toBeNull()
  })

  it('says nothing when they close the gallery', () => {
    expect(describeCameraFailure(err('OS-PLUG-CAMR-0020'), 'gallery')).toBeNull()
  })

  it('treats an uncoded cancellation as a cancellation', () => {
    expect(describeCameraFailure(new Error('User cancelled photos app'), 'gallery')).toBeNull()
  })

  it('names a refused camera permission, and where to change it', () => {
    const failure = describeCameraFailure(err('OS-PLUG-CAMR-0003'), 'camera')
    expect(failure.key).toBe('cameraPermissionDenied')
    expect(failure.fallback).toMatch(/settings/i)
  })

  it('names a refused photo permission', () => {
    expect(describeCameraFailure(err('OS-PLUG-CAMR-0005'), 'gallery').key).toBe('galleryPermissionDenied')
  })

  it('offers the other two ways in when the device has no camera', () => {
    const failure = describeCameraFailure(err('OS-PLUG-CAMR-0007'), 'camera')
    expect(failure.key).toBe('noCameraAvailable')
    expect(failure.fallback).toMatch(/gallery/i)
    expect(failure.fallback).toMatch(/file/i)
  })

  it('reports any other camera failure as a camera failure', () => {
    expect(describeCameraFailure(err('OS-PLUG-CAMR-0010'), 'camera').key).toBe('cameraFailed')
  })

  it('reports any other gallery failure as a gallery failure', () => {
    expect(describeCameraFailure(err('OS-PLUG-CAMR-0018'), 'gallery').key).toBe('galleryFailed')
  })

  it('reports a failure with no code at all, rather than swallowing it', () => {
    expect(describeCameraFailure(new Error('boom'), 'camera').key).toBe('cameraFailed')
    expect(describeCameraFailure(undefined, 'gallery').key).toBe('galleryFailed')
  })

  it('carries the key and the English text on the thrown error', () => {
    const e = new NativeMediaError({ key: 'noCameraAvailable', fallback: 'No camera.' })
    expect(e).toBeInstanceOf(Error)
    expect(e.messageKey).toBe('noCameraAvailable')
    expect(e.fallback).toBe('No camera.')
    expect(e.message).toBe('No camera.')
  })
})

describe('mediaToFile — the plugin result becomes an ordinary upload', () => {
  const served = (type, bytes = [1, 2, 3]) => async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob([new Uint8Array(bytes)], { type }),
  })

  it('names a camera JPEG so the page accepts it on type and extension', async () => {
    const file = await mediaToFile('http://localhost/_capacitor_file_/x.jpg', 'camera', served('image/jpeg'))
    expect(file).toBeInstanceOf(File)
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/^prescription-photo-\d+\.jpg$/)
    expect(file.size).toBe(3)
  })

  it('keeps a gallery PNG a PNG', async () => {
    const file = await mediaToFile('http://localhost/_capacitor_file_/y.png', 'gallery', served('image/png'))
    expect(file.type).toBe('image/png')
    expect(file.name).toMatch(/^prescription-image-\d+\.png$/)
  })

  it('falls back to the path when the server sends no type', async () => {
    const file = await mediaToFile('http://localhost/_capacitor_file_/z.jpeg?v=1', 'gallery', served(''))
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/\.jpg$/)
  })

  it('does not disguise a HEIC as something the reader can open', async () => {
    // The page rejects HEIC with its own explanation; renaming it .jpg would
    // trade that for a failed read.
    const file = await mediaToFile('http://localhost/_capacitor_file_/a.heic', 'gallery', served('image/heic'))
    expect(file.type).toBe('image/heic')
    expect(file.name).toMatch(/\.heic$/)
  })

  it('fails loudly when the image cannot be loaded', async () => {
    const notFound = async () => ({ ok: false, status: 404, blob: async () => new Blob([]) })
    await expect(mediaToFile('http://localhost/missing.jpg', 'camera', notFound)).rejects.toThrow(/404/)
  })
})

describe('pickPrescriptionImage on the website', () => {
  it('hands back to the page’s own file input', async () => {
    // The web build carries no camera plugin; the native branch is compiled out.
    await expect(pickPrescriptionImage('camera')).resolves.toEqual({ kind: 'unavailable' })
    await expect(pickPrescriptionImage('gallery')).resolves.toEqual({ kind: 'unavailable' })
  })
})
