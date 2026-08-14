// Minimal DOM shims for the scan pipeline tests.
//
// The tests run in Node (no jsdom) because the pipeline only touches the DOM in
// one place: rasterizing a PDF page to a canvas for OCR. Stubbing that is far
// cheaper — and far more predictable — than pulling in a full DOM plus a native
// canvas binding.

export function createCanvasStub() {
  return {
    width: 0,
    height: 0,
    getContext: () => ({
      fillStyle: '',
      fillRect: () => {},
      drawImage: () => {},
    }),
    toDataURL: () => 'data:image/jpeg;base64,STUBBEDPAGE',
  }
}

export function installDomStub() {
  globalThis.document = {
    createElement: (tag) => {
      if (tag === 'canvas') return createCanvasStub()
      return {}
    },
  }
}

export function removeDomStub() {
  delete globalThis.document
}

/** Build a file-like object; the pipeline only needs name/type/arrayBuffer. */
export function fakeFile(name, type, bytes = new Uint8Array([1, 2, 3])) {
  return {
    name,
    type,
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  }
}

/** Build a pdf.js document stub from per-page `{ text, items }` descriptors. */
export function fakePdf(pages) {
  return {
    numPages: pages.length,
    getPage: async (pageNumber) => {
      const page = pages[pageNumber - 1]
      return {
        getTextContent: async () => ({
          items: page.textLayer
            ? page.textLayer.map((str, index) => ({
                str,
                hasEOL: true,
                transform: [1, 0, 0, 1, 0, 800 - index * 20],
              }))
            : [],
        }),
        getViewport: () => ({ width: 800, height: 1000 }),
        render: () => ({ promise: Promise.resolve() }),
      }
    },
    cleanup: async () => {},
    destroy: async () => {},
  }
}
