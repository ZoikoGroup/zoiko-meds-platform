// Node 24+ defines a `localStorage` global of its own. Without a valid
// --localstorage-file it is an empty object, and because the key already exists
// on globalThis, vitest's jsdom environment leaves it alone — so every test that
// touches storage fails with "localStorage.clear is not a function" rather than
// with anything to do with the code under test.
//
// Prefer jsdom's own Storage when the environment provides one; otherwise stand
// up an in-memory equivalent so node-environment tests get the same contract.
function installStorage(name) {
  const existing = globalThis[name]
  if (existing && typeof existing.getItem === 'function') return

  const fromJsdom = typeof window !== 'undefined' ? window[name] : undefined
  if (fromJsdom && typeof fromJsdom.getItem === 'function') {
    Object.defineProperty(globalThis, name, { value: fromJsdom, configurable: true, writable: true })
    return
  }

  const store = new Map()
  const storage = {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => void store.set(String(key), String(value)),
    removeItem: (key) => void store.delete(String(key)),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
  Object.defineProperty(globalThis, name, { value: storage, configurable: true, writable: true })
  if (typeof window !== 'undefined') {
    Object.defineProperty(window, name, { value: storage, configurable: true, writable: true })
  }
}

installStorage('localStorage')
installStorage('sessionStorage')
