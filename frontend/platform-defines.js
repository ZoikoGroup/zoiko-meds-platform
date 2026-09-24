// Build-time platform constants, shared by vite.config.js and vitest.config.js.
//
// These are Vite `define`s: each identifier is replaced with a literal `true` or
// `false` in the source text before bundling. That is what makes gating reliable
// — `false ? [adminRoutes] : []` is removed outright, whereas a flag imported as
// a const from another module is not folded by the bundler, and its "excluded"
// pages quietly stay in the bundle.
//
// The web build (default mode) gets __ZM_NATIVE__ = false. The Android app build
// is `vite build --mode mobile`, which loads .env.mobile.

/** @param {Record<string, string>} env  VITE_* variables for the build mode. */
export function platformDefines(env) {
  const native = env.VITE_PLATFORM === 'mobile'
  return {
    __ZM_NATIVE__: JSON.stringify(native),
    // The Super Admin console: always on the web; in the app only when asked for.
    __ZM_ADMIN_CONSOLE__: JSON.stringify(!native || env.VITE_ADMIN_CONSOLE === 'true'),
  }
}
