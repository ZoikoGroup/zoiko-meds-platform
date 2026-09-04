// Choosing a licence document for verification.
//
// Lives outside the page so it can be tested as the unit it is, and so the page
// stays a component file. These checks are a courtesy to the operator — the API
// decides for itself by inspecting the bytes (backend: modules/pharmacy/
// verification-document.ts), because a filename and a MIME type are both just
// strings the client chose.

/**
 * What the reviewer can open, and what the API will accept.
 *
 * Kept in step with readVerificationDocument on the server, which checks the
 * bytes rather than any of this. These checks exist so an operator is told
 * before a 5 MB upload that the file is the wrong sort — not instead of the
 * server deciding.
 */
export const DOC_MAX_BYTES = 5 * 1024 * 1024
export const DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const DOC_TYPE_RE = /^(application\/pdf|image\/(jpeg|png))$/
const DOC_EXT_RE = /\.(pdf|jpe?g|png)$/i

/** Check a chosen file, and read it as a data URL for the save request. */
export async function readDocumentFile(file) {
  if (!file) return { error: 'Choose a licence document to upload.' }
  if (file.size === 0) return { error: 'That file is empty. Choose your licence document.' }
  if (file.size > DOC_MAX_BYTES) {
    return { error: `That file is ${(file.size / (1024 * 1024)).toFixed(1)} MB. Licence documents must be under 5 MB.` }
  }
  if (!DOC_TYPE_RE.test(file.type || '') && !DOC_EXT_RE.test(file.name || '')) {
    return { error: 'Upload the licence as a PDF, JPG or PNG.' }
  }

  const content = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('That file could not be read. Choose it again and retry.'))
    reader.readAsDataURL(file)
  })

  return { document: { filename: file.name, content } }
}

/** Human-readable file size for the "currently attached" line. */
export function formatBytes(bytes) {
  if (!bytes) return ''
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/**
 * A MIME type as a reviewer would name it.
 *
 * The type is decided by the API from the file's own bytes, so this is a label
 * for a value that was already checked — never a guess from the extension.
 */
export function formatDocType(mimeType) {
  if (!mimeType) return null
  if (mimeType === 'application/pdf') return 'PDF'
  if (mimeType === 'image/jpeg') return 'JPG'
  if (mimeType === 'image/png') return 'PNG'
  return mimeType
}
