// Where the person is, for "Use my (current) location".
//
// One function for both buttons that ask — the search form and the scan page —
// so they cannot disagree about what went wrong. Both used to answer every
// failure with one sentence ("Could not access your location"), whether the
// permission had been refused, the phone's Location was switched off, or the
// fix simply took too long; and the scan page threw away the coordinates even
// when it succeeded.
//
// In the Android app this is the Capacitor Geolocation plugin, not the
// WebView's navigator.geolocation. The WebView cannot tell "Location is off"
// from "no signal", cannot ask the person to turn Location on, and cannot open
// Settings. The plugin can do the first two: when Location is off it shows
// Android's own "turn on device location" dialog, and continues the same
// request if the person agrees. Nothing here changes a setting by itself.
//
// Every Capacitor import is dynamic and sits behind __ZM_NATIVE__, so the
// website ships none of it (see native.js).

/** A failure the person should be told about, with what to do next. */
export class LocationError extends Error {
  constructor({ reason, key, fallback }) {
    super(fallback)
    this.name = 'LocationError'
    this.reason = reason
    this.messageKey = key
    this.fallback = fallback
  }
}

/**
 * The messages, by reason. Each ends in something the person can do, and each
 * offers typing a place instead, because a location is never required to come
 * from the device.
 */
const MESSAGES = {
  'permission-denied': {
    key: 'locationPermissionDenied',
    fallback:
      'Location permission was denied. Allow location for ZoikoMeds in your settings, or enter your location instead.',
  },
  'services-disabled': {
    key: 'locationServicesOff',
    fallback: "Your device's location is turned off. Turn on Location and try again, or enter your location instead.",
  },
  unavailable: {
    key: 'locationUnavailable',
    fallback:
      "Your location couldn't be determined. Check that Location is turned on and try again, or enter your location instead.",
  },
  timeout: {
    key: 'locationTimeout',
    fallback: 'Finding your location took too long. Try again, or enter your location instead.',
  },
  unsupported: {
    key: 'locationUnsupported',
    fallback: "Location isn't available on this device. Enter your location instead.",
  },
}

/** Shown when the position was found but its place name could not be looked up. */
export const LOCATION_NAME_UNAVAILABLE = {
  key: 'locationNameUnavailable',
  fallback:
    "Location found. We couldn't look up the place name, so your coordinates are shown — nearby results still use your exact position.",
}

/** The browser's GeolocationPositionError codes. */
const BROWSER_REASONS = { 1: 'permission-denied', 2: 'unavailable', 3: 'timeout' }

/**
 * The Geolocation plugin's error codes (@capacitor/geolocation 8, Android).
 * Several mean "Location is off" in different words, and are one message here.
 */
const PLUGIN_REASONS = {
  'OS-PLUG-GLOC-0003': 'permission-denied', // permission request denied
  'OS-PLUG-GLOC-0007': 'services-disabled', // location services are not enabled
  'OS-PLUG-GLOC-0009': 'services-disabled', // declined the "turn on location" dialog
  'OS-PLUG-GLOC-0016': 'services-disabled', // location settings could not be satisfied
  'OS-PLUG-GLOC-0017': 'services-disabled', // both network and location are off
  'OS-PLUG-GLOC-0010': 'timeout',
  // The app was built without the location permission in its manifest. Not
  // something the person can fix, so it reads as unavailable to them.
  'OS-PLUG-GLOC-0018': 'unsupported',
}

/**
 * Why a location request failed, as a reason and the message for it.
 *
 * Accepts the browser's GeolocationPositionError (numeric code), a plugin
 * error (string code), or a LocationError already classified. Anything else
 * reads as "unavailable" — never as success, and never silently.
 */
export function describeLocationFailure(err) {
  if (err instanceof LocationError) {
    return { reason: err.reason, key: err.messageKey, fallback: err.fallback }
  }
  const code = err?.code
  const reason =
    (typeof code === 'string' && PLUGIN_REASONS[code]) ||
    (typeof code === 'number' && BROWSER_REASONS[code]) ||
    'unavailable'
  if (code === 'OS-PLUG-GLOC-0018') {
    console.warn('[ZoikoMeds] This app build does not declare a location permission in its manifest.')
  }
  return { reason, ...MESSAGES[reason] }
}

/**
 * One request's options, for both sources.
 *
 * Fifteen seconds rather than the eight both buttons used: a first fix on a
 * phone that has not used Location recently can take longer than eight
 * seconds, and the old limit turned "nearly there" into a failure. A fix up to
 * a minute old is accepted, so a second press is usually instant.
 */
export const LOCATION_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }

const toPosition = (coords) => ({
  lat: coords.latitude,
  lng: coords.longitude,
  accuracy: coords.accuracy ?? null,
})

/**
 * The browser's answer, as a promise. Exported so it can be tested with a
 * stand-in for navigator.geolocation.
 */
export function readBrowserLocation(geolocation = globalThis.navigator?.geolocation) {
  if (!geolocation) {
    return Promise.reject(new LocationError({ reason: 'unsupported', ...MESSAGES.unsupported }))
  }
  return new Promise((resolve, reject) => {
    geolocation.getCurrentPosition(
      ({ coords }) => resolve(toPosition(coords)),
      (err) => reject(new LocationError(describeLocationFailure(err))),
      LOCATION_OPTIONS,
    )
  })
}

/**
 * The person's current position: `{ lat, lng, accuracy }`.
 *
 * Rejects with a LocationError whose `reason` is one of permission-denied,
 * services-disabled, unavailable, timeout or unsupported. Never resolves with
 * a guess: there is no fallback to an IP address or a default city.
 */
export async function getCurrentLocation() {
  if (__ZM_NATIVE__) {
    const [{ Capacitor }, { Geolocation }] = await Promise.all([
      import('@capacitor/core'),
      import('@capacitor/geolocation'),
    ])
    if (Capacitor.isPluginAvailable('Geolocation')) {
      try {
        const { coords } = await Geolocation.getCurrentPosition(LOCATION_OPTIONS)
        return toPosition(coords)
      } catch (err) {
        throw new LocationError(describeLocationFailure(err))
      }
    }
    // The web bundle and the native project are built from two repositories.
    // Until the app project installs the plugin, keep today's behaviour.
    console.warn('[ZoikoMeds] Geolocation plugin missing from this app build; using the WebView API.')
  }
  return readBrowserLocation()
}

/**
 * Is the device's Location switched on? true, false, or null when this cannot
 * be known — which is always the case on the website, where no browser says.
 *
 * Asking does not prompt: the plugin's permission check answers "Location is
 * off" without showing anything. That is what makes it safe to ask when the
 * person returns to the app.
 */
export async function locationServicesEnabled() {
  if (__ZM_NATIVE__) {
    const [{ Capacitor }, { Geolocation }] = await Promise.all([
      import('@capacitor/core'),
      import('@capacitor/geolocation'),
    ])
    if (!Capacitor.isPluginAvailable('Geolocation')) return null
    try {
      await Geolocation.checkPermissions()
      return true
    } catch (err) {
      return err?.code === 'OS-PLUG-GLOC-0007' ? false : null
    }
  }
  return null
}
