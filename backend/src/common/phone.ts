import { parsePhoneNumberFromString } from 'libphonenumber-js';

/**
 * Phone number normalization.
 *
 * A pharmacy types the number the way it is printed on their door — "040 2345
 * 6789", "+91 40 2345 6789", "(040) 2345-6789" — and all of those are the same
 * number. What is stored has to be one of them, because a number is used for
 * contact and comparison, and three spellings of one pharmacy's landline cannot be
 * told apart later.
 *
 * E.164 is that form. Anything that cannot be understood as a real number for the
 * given country is refused rather than stored, since a phone number nobody can
 * ring is worse than an empty field: it looks like a way to reach the pharmacy.
 */

/**
 * Parse a number to E.164, or null when it is not a valid number.
 *
 * `defaultCountry` is the region a national-format number is interpreted in — the
 * pharmacy's own country. Without it, "040 2345 6789" is unanswerable: the same
 * digits are a valid number in several countries and a valid number in none.
 */
export function normalizePhone(
  input: string | null | undefined,
  defaultCountry?: string | null,
): string | null {
  const trimmed = input?.trim();
  if (!trimmed) return null;

  const country = defaultCountry?.trim().toUpperCase();
  const region =
    country && /^[A-Z]{2}$/.test(country) ? (country as Parameters<typeof parsePhoneNumberFromString>[1]) : undefined;

  // Parsed with the region hint first. A number written in international form
  // carries its own country code and ignores the hint, so one call covers both.
  const parsed = parsePhoneNumberFromString(trimmed, region);
  if (parsed?.isValid()) return parsed.number;

  // A number that begins with + but failed above is not valid anywhere, and
  // retrying without the hint would only produce the same answer.
  if (trimmed.startsWith('+')) return null;

  // No region was known, so a national-format number could not have been parsed.
  // Nothing more can be inferred from the digits alone.
  return null;
}

/** Whether a number can be understood for a country. Empty counts as fine — the field is optional. */
export function isPhoneAcceptable(
  input: string | null | undefined,
  defaultCountry?: string | null,
): boolean {
  if (!input?.trim()) return true;
  return normalizePhone(input, defaultCountry) !== null;
}
