import { lazy } from 'react'

/**
 * Resilient lazy import wrapper for Vite code-splitting and dynamic routes.
 * Automatically recovers from stale Vite dev HMR module caches, network glitches,
 * or newly deployed chunk hashes by performing an automatic page reload.
 */
export function lazyImport(factory, pageName = 'page') {
  return lazy(async () => {
    const sessionStorageKey = `retry_import_${pageName}`

    try {
      const module = await factory()
      // Success — clear retry marker for future edits
      sessionStorage.removeItem(sessionStorageKey)
      return module
    } catch (error) {
      const hasAlreadyRetried = sessionStorage.getItem(sessionStorageKey) === 'true'

      const isImportFailure =
        error instanceof TypeError ||
        error?.name === 'TypeError' ||
        error?.message?.includes('Failed to fetch dynamically imported module') ||
        error?.message?.includes('Importing a module script failed') ||
        error?.message?.includes('Loading chunk')

      if (isImportFailure && !hasAlreadyRetried) {
        sessionStorage.setItem(sessionStorageKey, 'true')
        window.location.reload()
        return new Promise(() => {}) // Suspend render until page reloads
      }

      // Reset marker and pass error to RouteErrorBoundary card
      sessionStorage.removeItem(sessionStorageKey)
      throw error
    }
  })
}
