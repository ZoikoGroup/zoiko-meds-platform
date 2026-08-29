// @vitest-environment jsdom
//
// Choosing a licence document in the Pharmacy Profile.
//
// The Verification Center has always shown an "Uploaded Documents" panel; the
// portal had no control to fill it, so every request reached a reviewer reading
// "No document". These cover the client-side half — the courtesy checks that
// tell an operator the file is wrong before a 5 MB upload. The API decides for
// itself by reading the bytes.

import { describe, expect, it } from 'vitest'
import {
  DOC_ACCEPT,
  DOC_MAX_BYTES,
  formatBytes,
  readDocumentFile,
} from '../pharmacy/verification-document'

const file = (name, type, bytes = 1024) =>
  new File([new Uint8Array(bytes)], name, { type })

describe('readDocumentFile — accepted', () => {
  it('accepts a PDF and reads it for the save request', async () => {
    const result = await readDocumentFile(file('pharmacy-licence.pdf', 'application/pdf'))

    expect(result.error).toBeUndefined()
    expect(result.document.filename).toBe('pharmacy-licence.pdf')
    // A data URL is what the API's reader expects.
    expect(result.document.content.startsWith('data:')).toBe(true)
  })

  it('accepts a JPG', async () => {
    const result = await readDocumentFile(file('licence.jpg', 'image/jpeg'))
    expect(result.error).toBeUndefined()
  })

  it('accepts a PNG', async () => {
    const result = await readDocumentFile(file('licence.png', 'image/png'))
    expect(result.error).toBeUndefined()
  })

  it('accepts a file whose type the browser did not report, by extension', async () => {
    // Some browsers report an empty type for a file dragged from certain apps.
    const result = await readDocumentFile(file('licence.pdf', ''))
    expect(result.error).toBeUndefined()
  })

  it('accepts a file at the size ceiling', async () => {
    const result = await readDocumentFile(file('licence.pdf', 'application/pdf', DOC_MAX_BYTES))
    expect(result.error).toBeUndefined()
  })
})

describe('readDocumentFile — refused', () => {
  it('refuses a type the reviewer cannot open', async () => {
    const result = await readDocumentFile(file('licence.docx', 'application/msword'))

    expect(result.error).toMatch(/PDF, JPG or PNG/)
    expect(result.document).toBeUndefined()
  })

  it('refuses an executable, however it is named', async () => {
    const result = await readDocumentFile(file('licence.exe', 'application/x-msdownload'))
    expect(result.error).toMatch(/PDF, JPG or PNG/)
  })

  it('refuses an oversized file, and says how big it was', async () => {
    const result = await readDocumentFile(
      file('licence.pdf', 'application/pdf', DOC_MAX_BYTES + 1024),
    )

    expect(result.error).toMatch(/must be under 5 MB/)
    expect(result.error).toMatch(/\d+\.\d MB/)
  })

  it('refuses an empty file', async () => {
    const result = await readDocumentFile(file('licence.pdf', 'application/pdf', 0))
    expect(result.error).toMatch(/empty/i)
  })

  it('refuses nothing at all', async () => {
    expect((await readDocumentFile(null)).error).toMatch(/choose a licence document/i)
  })
})

describe('what the file picker offers', () => {
  it('offers exactly the types the API accepts', () => {
    expect(DOC_ACCEPT).toContain('.pdf')
    expect(DOC_ACCEPT).toContain('.jpg')
    expect(DOC_ACCEPT).toContain('.png')
    expect(DOC_ACCEPT).toContain('application/pdf')
  })

  it('agrees with the server on the size ceiling', () => {
    expect(DOC_MAX_BYTES).toBe(5 * 1024 * 1024)
  })
})

describe('formatBytes', () => {
  it('reads small files in KB and larger ones in MB', () => {
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB')
  })

  it('says nothing for nothing', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(undefined)).toBe('')
  })
})
