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
 * two shapes are accepted, and only the path is taken from either:
 *   https://app.zoikomeds.com/<path>          — App Links from emails etc.
 *   com.zoikomeds.app://auth/callback?token=… — the OAuth return from a Custom Tab
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
