// Phone-only behaviour for the Android app build.
//
// Every Capacitor import in here is dynamic and sits behind __ZM_NATIVE__, a
// Vite define that is a literal in the source text. In the web build each
// branch is `if (false)` and is removed, plugins and all — the website ships
// none of this.

import { APP_ID, SUPPORTS_ADMIN_CONSOLE, WEB_ORIGIN } from '@/lib/platform'

/**
 * Open a URL in the user's real browser (a Custom Tab in the app).
 * On the web this is a plain navigation, so callers can use it unconditionally.
 */
export async function openExternal(url) {
  if (__ZM_NATIVE__) {
    const { Browser } = await import('@capacitor/browser')
    await Browser.open({ url })
    return
  }
  window.location.assign(url)
}

/**
 * Run `callback` when the app returns to the foreground. Returns an unsubscribe
 * function. On the web it is a no-op: the page's own focus handlers cover it.
 */
export function onAppResume(callback) {
  // Native work goes INSIDE the `if`: the bundler drops a dead `if (false)`
  // block, dynamic imports and all, but keeps code after an early return.
  if (__ZM_NATIVE__) {
    let handle = null
    let cancelled = false
    import('@capacitor/app').then(({ App }) =>
      App.addListener('resume', callback).then((h) => {
        if (cancelled) h.remove()
        else handle = h
      }),
    )
    return () => {
      cancelled = true
      handle?.remove()
    }
  }
  return () => {}
}

/**
 * Save a generated file. On the web: the usual `<a download>`. In the app a
 * WebView has no download manager, so the file is written to the app cache and
 * offered through the Android share sheet (save to Files, Drive, email, …).
 */
export async function saveFile(filename, blob) {
  if (__ZM_NATIVE__) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ])
    const data = await blobToBase64(blob)
    const safeName = filename.replace(/[^\w.-]+/g, '_')
    const { uri } = await Filesystem.writeFile({ path: safeName, data, directory: Directory.Cache })
    await Share.share({ title: safeName, files: [uri] })
    return
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(blob)
  })
}

// --- Prescription camera and gallery ---------------------------------------
//
// Why these do not go through <input type="file"> in the app:
//
// Capacitor's WebView answers a file input in BridgeWebChromeClient, and it
// only opens the camera when the input's accept list contains the exact string
// "image/*" (`acceptTypes.contains("image/*")`, Capacitor 8.5.2). The scan
// page's camera input accepts "image/jpeg,image/png" — chosen so iOS Safari
// transcodes HEIC — so Capacitor ignored `capture` and opened the file manager.
// Every other input lands in the same place: the chooser's only other route is
// ACTION_GET_CONTENT, which is the file manager, and it has no path to the
// Android Photo Picker at all. Even with "image/*", a camera that fails to
// launch falls back to the file manager, and a denied permission comes back as
// a silent cancel. So in the app, camera and gallery use the camera plugin,
// which opens the camera or the Photo Picker and reports failures as errors.

/**
 * Error codes from the camera plugin's current APIs (`takePhoto`,
 * `chooseFromGallery`, @capacitor/camera 8.1+). The deprecated `getPhoto`
 * reported failures as free text instead, which is why it is not used here.
 */
const CAMERA_ERRORS = {
  CAMERA_PERMISSION_DENIED: 'OS-PLUG-CAMR-0003',
  GALLERY_PERMISSION_DENIED: 'OS-PLUG-CAMR-0005',
  PHOTO_CANCELLED: 'OS-PLUG-CAMR-0006',
  NO_CAMERA: 'OS-PLUG-CAMR-0007',
  GALLERY_CANCELLED: 'OS-PLUG-CAMR-0020',
}

/** Raised for a camera or gallery failure the person should be told about. */
export class NativeMediaError extends Error {
  constructor({ key, fallback }) {
    super(fallback)
    this.name = 'NativeMediaError'
    this.messageKey = key
    this.fallback = fallback
  }
}

/**
 * What to tell the person about a failed camera or gallery call, or null when
 * they simply backed out — closing the camera or the picker is a choice, not an
 * error, and answering it with a message would scold them for it.
 *
 * Exported so it can be tested: the call site is native-only and is compiled
 * out of the web build the tests run against.
 */
export function describeCameraFailure(err, source) {
  const code = err?.code
  if (code === CAMERA_ERRORS.PHOTO_CANCELLED || code === CAMERA_ERRORS.GALLERY_CANCELLED) return null
  // A cancellation without a code is still a cancellation.
  if (!code && /cancel/i.test(String(err?.message ?? ''))) return null

  if (code === CAMERA_ERRORS.CAMERA_PERMISSION_DENIED) {
    return {
      key: 'cameraPermissionDenied',
      fallback: "Camera access is turned off for ZoikoMeds. Allow it in your phone's Settings, then try again.",
    }
  }
  if (code === CAMERA_ERRORS.GALLERY_PERMISSION_DENIED) {
    return {
      key: 'galleryPermissionDenied',
      fallback: "Photo access is turned off for ZoikoMeds. Allow it in your phone's Settings, then try again.",
    }
  }
  if (code === CAMERA_ERRORS.NO_CAMERA) {
    return {
      key: 'noCameraAvailable',
      fallback: 'No camera was found on this device. Choose a photo from your gallery or browse for a file instead.',
    }
  }
  return source === 'camera'
    ? { key: 'cameraFailed', fallback: 'The camera could not take the photo. Please try again.' }
    : { key: 'galleryFailed', fallback: 'The photo could not be opened. Please try again.' }
}

const EXTENSION_FOR_TYPE = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
}
const TYPE_FOR_EXTENSION = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }

/**
 * Turn the plugin's `webPath` into a File for the page's existing upload flow,
 * so validation, upload and reading run exactly as they do for a chosen file.
 *
 * The type and extension are both set because the page accepts a file on
 * either. A gallery HEIC keeps its own extension and type, so the page's
 * existing HEIC message explains it, rather than it being renamed to something
 * it is not.
 */
export async function mediaToFile(webPath, source, fetchImpl = fetch) {
  const response = await fetchImpl(webPath)
  if (!response.ok) throw new Error(`Could not load the selected image (${response.status}).`)
  const blob = await response.blob()

  const pathExtension = /\.([a-z0-9]+)(?:[?#].*)?$/i.exec(webPath)?.[1]?.toLowerCase()
  const extension =
    EXTENSION_FOR_TYPE[blob.type] ?? (pathExtension === 'jpeg' ? 'jpg' : pathExtension) ?? 'jpg'
  const type = blob.type || TYPE_FOR_EXTENSION[extension] || ''
  const stem = source === 'camera' ? 'prescription-photo' : 'prescription-image'
  return new File([blob], `${stem}-${Date.now()}.${extension}`, { type })
}

/**
 * Take a prescription photo with the camera, or choose one from the gallery.
 *
 * Resolves to one of:
 *   { kind: 'file', file }    — ready for the existing upload flow
 *   { kind: 'cancelled' }     — the person backed out; say nothing
 *   { kind: 'unavailable' }   — not the app, or this app build was made without
 *                               the camera plugin; use the page's file input
 * Rejects with a NativeMediaError for anything the person should be told about.
 *
 * 'unavailable' is a build mismatch, not a camera failure. A real camera
 * failure — permission refused, no camera, the camera erroring — never falls
 * back to the file manager; it is reported.
 */
export async function pickPrescriptionImage(source) {
  if (__ZM_NATIVE__) {
    const [{ Capacitor }, { Camera, MediaTypeSelection }] = await Promise.all([
      import('@capacitor/core'),
      import('@capacitor/camera'),
    ])
    // The web bundle and the native project ship together, but they are built
    // from two repositories. Until the app project installs the plugin, keep
    // today's behaviour rather than leave the buttons dead.
    if (!Capacitor.isPluginAvailable('Camera')) {
      console.warn('[ZoikoMeds] Camera plugin missing from this app build; using the file input.')
      return { kind: 'unavailable' }
    }

    let media
    try {
      if (source === 'camera') {
        // JPEG by default. Quality 85 keeps a full-resolution phone photo well
        // inside the page's 10 MB ceiling, and is far more than reading needs.
        media = await Camera.takePhoto({ quality: 85, saveToGallery: false })
      } else {
        const { results } = await Camera.chooseFromGallery({
          mediaType: MediaTypeSelection.Photo,
          allowMultipleSelection: false,
        })
        media = results?.[0]
      }
    } catch (err) {
      const failure = describeCameraFailure(err, source)
      if (!failure) return { kind: 'cancelled' }
      throw new NativeMediaError(failure)
    }

    // A picker closed with nothing chosen.
    if (!media?.webPath) return { kind: 'cancelled' }

    try {
      return { kind: 'file', file: await mediaToFile(media.webPath, source) }
    } catch {
      throw new NativeMediaError(describeCameraFailure({ code: 'unreadable' }, source))
    }
  }
  return { kind: 'unavailable' }
}

// --- Hardware back button --------------------------------------------------

// Menus, dialogs and drawers are component state, not history entries, so a
// naive "back = history.back()" navigates the page behind an open layer and
// leaves the layer on screen. Every overlay in this app is a Radix primitive,
// and Radix already keeps a stack of dismissable layers that closes the top one
// on Escape — so Back sends Escape whenever a layer is open, and the same
// stack that handles the keyboard decides which layer goes.
const OPEN_LAYER_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
  '[data-radix-popper-content-wrapper]',
].join(',')

function dismissTopLayer() {
  if (!document.querySelector(OPEN_LAYER_SELECTOR)) return false
  const target = document.activeElement || document.body
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }),
  )
  return true
}

// Screens where Back leaves the app instead of walking history. Without this,
// Back from a portal home goes to /login, whose guard bounces straight back.
const ROOT_PATHS = new Set(['/', '/login', '/dashboard', '/pharmacy/dashboard', '/app/web-only'])

// --- Deep links -------------------------------------------------------------

/**
 * Turn an incoming URL into an in-app route, or null to ignore it.
 *
 * An incoming link is untrusted input: any app on the device can send one. Only
 * these shapes are accepted, and only the path is taken from any of them:
 *   https://app.zoikomeds.com/<path>              — App Links from emails etc.
 *   com.zoikomeds.app://auth/callback?token=…     — the OAuth return from a Custom Tab
 *   com.zoikomeds.app://auth/reset-password?…     — the emailed reset link when
 *       the reset was asked for in the app (the API sends this instead of the
 *       App Link, which would open the browser whenever assetlinks.json is not
 *       verified). The token rides in the query of an email the user requested;
 *       the path is fixed, so nothing else on the scheme is reachable.
 *   com.zoikomeds.app://auth/login?reset=success  — back from a reset that
 *       finished in the browser (see app-return.js). Only that one flag is
 *       carried over; anything else on the link is dropped, so it can never
 *       deliver a token or a destination of its own.
 */
export function routeForIncomingUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol === `${APP_ID}:`) {
    if (parsed.host === 'auth' && parsed.pathname === '/callback') {
      return `/auth/callback${parsed.search}`
    }
    if (parsed.host === 'auth' && parsed.pathname === '/reset-password') {
      return `/reset-password${parsed.search}`
    }
    if (parsed.host === 'auth' && parsed.pathname === '/login') {
      return parsed.searchParams.get('reset') === 'success' ? '/login?reset=success' : '/login'
    }
    return null
  }
  if (!WEB_ORIGIN || parsed.origin !== new URL(WEB_ORIGIN).origin) return null
  if (!SUPPORTS_ADMIN_CONSOLE && parsed.pathname.startsWith('/admin')) return '/app/web-only'
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

/**
 * Wire the app's native behaviour to the router. Called once at startup; a
 * no-op on the web.
 */
export async function initNative(router) {
  if (__ZM_NATIVE__) await wireNative(router)
}

async function wireNative(router) {
  const [{ App }, { Browser }, { SplashScreen }] = await Promise.all([
    import('@capacitor/app'),
    import('@capacitor/browser'),
    import('@capacitor/splash-screen'),
  ])

  document.documentElement.classList.add('native-app')

  App.addListener('backButton', () => {
    if (dismissTopLayer()) return
    const path = window.location.pathname
    // The router's own history index, not Capacitor's canGoBack: that reports
    // the WebView's history and would walk a signed-out user back into pages
    // their session can no longer load.
    const idx = window.history.state?.idx
    if (!ROOT_PATHS.has(path) && typeof idx === 'number' && idx > 0) router.navigate(-1)
    else App.exitApp()
  })

  const go = (url) => {
    const route = routeForIncomingUrl(url)
    if (!route) return
    // An OAuth return arrives while the Custom Tab is still on top.
    Browser.close().catch(() => {})
    router.navigate(route, { replace: route.startsWith('/auth/callback') })
  }
  App.addListener('appUrlOpen', ({ url }) => go(url))
  const launch = await App.getLaunchUrl().catch(() => null)
  if (launch?.url) go(launch.url)

  SplashScreen.hide().catch(() => {})
}
