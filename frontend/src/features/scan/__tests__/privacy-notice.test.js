// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TRANSLATIONS } from '@/locales'

/**
 * The scan privacy notice has to stay true.
 *
 * It said "reading happens on your device — the file is not uploaded" until
 * reading moved to the server, at which point it was false in eight languages
 * at once. A privacy notice that lags the implementation is worse than no
 * notice: people make decisions on it.
 *
 * These tests pin two things — that the retired claim cannot come back, and
 * that no stronger claim is made about a third party than anyone here has
 * verified.
 */

const LOCALES = Object.keys(TRANSLATIONS)

/** Keys that describe what happens to the uploaded file. */
const NOTICE_KEYS = ['prescriptionPrivacyNotice', 'secureReadingNotice', 'extractMedicineDesc']

describe('the retired on-device claim', () => {
  it('is gone from every locale', () => {
    for (const locale of LOCALES) {
      expect(TRANSLATIONS[locale].deviceOnlyNotice).toBeUndefined()
    }
  })

  it('is not reintroduced in any notice string', () => {
    for (const locale of LOCALES) {
      for (const key of NOTICE_KEYS) {
        const value = TRANSLATIONS[locale][key] ?? ''
        expect(value).not.toMatch(/on your device/i)
        expect(value).not.toMatch(/not uploaded|never uploaded/i)
      }
    }
  })
})

describe('what the notice claims', () => {
  it('scopes the retention promise to ZoikoMeds, not to a provider', () => {
    // "ZoikoMeds does not retain the uploaded file" is a statement about this
    // system, and the tests in the backend support it. A claim about what a
    // processing provider does would not be supported by anything.
    const notice = TRANSLATIONS.en.prescriptionPrivacyNotice

    expect(notice).toMatch(/ZoikoMeds does not retain the uploaded file/i)
  })

  it('makes no unverified claim about a third party', () => {
    for (const locale of LOCALES) {
      for (const key of NOTICE_KEYS) {
        const value = TRANSLATIONS[locale][key] ?? ''
        expect(value).not.toMatch(/google/i)
        expect(value).not.toMatch(/gemini/i)
        expect(value).not.toMatch(/HIPAA/i)
        expect(value).not.toMatch(/never retained by any provider/i)
      }
    }
  })

  it('says the file leaves the device, which is the fact that changed', () => {
    const notice = TRANSLATIONS.en.prescriptionPrivacyNotice

    expect(notice).toMatch(/securely sent/i)
  })

  it('says MediBase is what makes a medicine verified', () => {
    const notice = TRANSLATIONS.en.prescriptionPrivacyNotice

    expect(notice).toMatch(/MediBase/)
  })
})

describe('locale parity for the notice and the confirmation UI', () => {
  const REQUIRED = [
    ...NOTICE_KEYS,
    'possibleMatches',
    'searchDifferentMedicine',
    'searchForMedicine',
    'medicineNamePlaceholder',
    'confirmMedicine',
    'noCatalogMatch',
    'catalogSearchFailed',
    'readFromPrescription',
  ]

  it('carries every key in all eight locales', () => {
    for (const locale of LOCALES) {
      for (const key of REQUIRED) {
        expect(TRANSLATIONS[locale][key], `${locale}.${key}`).toBeTruthy()
      }
    }
  })

  it('translates them rather than leaving English behind', () => {
    // A copied English string renders English mid-sentence on a translated
    // screen. Checked on the longest string, where a copy is most obvious.
    for (const locale of LOCALES.filter((l) => l !== 'en')) {
      expect(TRANSLATIONS[locale].prescriptionPrivacyNotice).not.toBe(
        TRANSLATIONS.en.prescriptionPrivacyNotice,
      )
    }
  })
})
