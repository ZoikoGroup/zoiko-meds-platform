// The phone rules, now shared by Register, the patient profile and the pharmacy
// profile. They were duplicated across the first two and absent from the third
// (MP-23); these tests are what keeps one copy honest for all three.

import { describe, expect, it } from 'vitest'
import { phoneErrorMessage, phoneValidationError } from '@/lib/phone'

describe('phoneValidationError', () => {
  describe('nothing to judge yet', () => {
    it('accepts an empty field, which is optional everywhere it appears', () => {
      expect(phoneValidationError('', 'IN')).toBeNull()
      expect(phoneValidationError('   ', 'IN')).toBeNull()
      expect(phoneValidationError(undefined, 'IN')).toBeNull()
    })

    it('accepts a bare +, which is what the input holds after picking a country', () => {
      expect(phoneValidationError('+', 'IN')).toBeNull()
    })

    it('says nothing while only the dialling code has been typed', () => {
      // Complaining mid-entry would flag every number as wrong as it is typed.
      expect(phoneValidationError('+91', 'IN')).toBeNull()
    })
  })

  describe('India', () => {
    it('accepts a ten-digit mobile, with or without the dialling code', () => {
      expect(phoneValidationError('9876543210', 'IN')).toBeNull()
      expect(phoneValidationError('+91 98765 43210', 'IN')).toBeNull()
    })

    it('rejects a mobile that does not open with 6 to 9', () => {
      expect(phoneValidationError('1234567890', 'IN')?.key).toBe('validIndianMobile')
    })

    it('rejects one that is too short or too long', () => {
      expect(phoneValidationError('98765', 'IN')?.key).toBe('phoneTooShort')
      expect(phoneValidationError('98765432109', 'IN')?.key).toBe('phoneTooLong')
    })
  })

  describe('other countries', () => {
    it('accepts a real US number', () => {
      expect(phoneValidationError('+1 415 555 2671', 'US')).toBeNull()
      expect(phoneValidationError('4155552671', 'US')).toBeNull()
    })

    it('accepts a real UK number', () => {
      expect(phoneValidationError('+44 20 7946 0958', 'GB')).toBeNull()
    })

    it('rejects a number that is too short for the country', () => {
      expect(phoneValidationError('12345', 'US')?.key).toBe('phoneTooShort')
    })

    it('falls back to a permissive range for a country with no entry', () => {
      // Better to accept an unusual-looking real number than to block a pharmacy
      // in a market whose lengths are not tabulated here.
      expect(phoneValidationError('+267 71 234 567', 'BW')).toBeNull()
    })
  })

  it('returns a key and a default message, so both callers can render it', () => {
    const error = phoneValidationError('12345', 'US')

    expect(error).toEqual({ key: 'phoneTooShort', message: 'Phone number is too short.' })
  })
})

describe('phoneErrorMessage', () => {
  it('is the message alone, empty when the number is fine', () => {
    expect(phoneErrorMessage('9876543210', 'IN')).toBe('')
    expect(phoneErrorMessage('98765', 'IN')).toBe('Phone number is too short.')
  })
})
