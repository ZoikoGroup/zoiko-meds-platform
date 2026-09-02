// Phone number validation, in one place.
//
// This check lived twice over — once in Register with plain strings and once in
// UserProfile with translation keys — and the pharmacy profile had no check at
// all, which is what MP-23 reported. A third copy was the wrong answer, so the
// rules live here and the pages differ only in how they render the message.
//
// Errors are returned as { key, message }: a caller with translations resolves
// t(key, message), and one without simply shows message. Both stay in step,
// because there is only one set of rules to keep in step with.

import {
  getCountryCallingCode,
  isPossiblePhoneNumber,
  isValidPhoneNumber,
} from 'react-phone-number-input'

/** Subscriber-number length bounds per country, before the dialling code. */
export const COUNTRY_MAX_DIGITS = {
  IN: 10,
  US: 10,
  CA: 10,
  GB: 11,
  AU: 9,
  AE: 9,
  SG: 8,
  MY: 10,
  SA: 9,
  DE: 11,
  FR: 9,
  JP: 11,
  CN: 11,
  BR: 11,
  MX: 10,
  PK: 10,
  BD: 10,
  LK: 9,
  ID: 11,
  NZ: 10,
}

export const COUNTRY_MIN_DIGITS = {
  IN: 10,
  US: 10,
  CA: 10,
  GB: 10,
  AU: 9,
  AE: 8,
  SG: 8,
  MY: 9,
  SA: 9,
  DE: 10,
  FR: 9,
  JP: 10,
  CN: 11,
  BR: 10,
  MX: 10,
  PK: 10,
  BD: 10,
  LK: 9,
  ID: 9,
  NZ: 8,
}

const ERRORS = {
  invalid: { key: 'validPhone', message: 'Please enter a valid phone number.' },
  indianMobile: {
    key: 'validIndianMobile',
    message: 'Please enter a valid Indian mobile number.',
  },
  tooShort: { key: 'phoneTooShort', message: 'Phone number is too short.' },
  tooLong: { key: 'phoneTooLong', message: 'Phone number is too long.' },
  wrongForCountry: {
    key: 'invalidPhoneCountry',
    message: 'Invalid phone number for the selected country.',
  },
}

/**
 * What is wrong with this number for this country, or null when nothing is.
 *
 * An empty value is not an error: the field is optional everywhere it appears, and
 * a bare "+" is what the input holds after a country is picked but nothing typed.
 */
export function phoneValidationError(rawPhone, country) {
  if (!rawPhone || !rawPhone.trim() || rawPhone.trim() === '+') return null

  const trimmed = rawPhone.trim()
  const digitsOnly = trimmed.replace(/\D/g, '')
  if (!digitsOnly) return ERRORS.invalid

  let dialCodeDigits = '91'
  try {
    dialCodeDigits = getCountryCallingCode(country)
  } catch {
    dialCodeDigits = '91'
  }

  // Compare the subscriber number, not the dialling code: the same number is
  // "+91 98…" or "98…" depending only on how it was typed.
  let localDigits = digitsOnly
  if (digitsOnly.startsWith(dialCodeDigits)) {
    localDigits = digitsOnly.slice(dialCodeDigits.length)
  }
  // Nothing typed past the dialling code yet, so there is nothing to judge.
  if (!localDigits) return null

  if (country === 'IN') {
    // Indian mobile numbers are exactly ten digits and open with 6-9.
    if (!/^[6-9]/.test(localDigits)) return ERRORS.indianMobile
    if (localDigits.length < 10) return ERRORS.tooShort
    if (localDigits.length > 10) return ERRORS.tooLong
    return null
  }

  const minAllowed = COUNTRY_MIN_DIGITS[country] || 7
  const maxAllowed = COUNTRY_MAX_DIGITS[country] || 15
  if (localDigits.length < minAllowed) return ERRORS.tooShort
  if (localDigits.length > maxAllowed) return ERRORS.tooLong

  const isValid =
    isValidPhoneNumber(trimmed, country) ||
    isPossiblePhoneNumber(trimmed, country) ||
    // Ten digits is a complete US number; the stricter check rejects some real
    // ones on area codes it does not know.
    (country === 'US' && localDigits.length === 10)

  return isValid ? null : ERRORS.wrongForCountry
}

/** The message alone, for a caller with no translations. */
export function phoneErrorMessage(rawPhone, country) {
  return phoneValidationError(rawPhone, country)?.message ?? ''
}
