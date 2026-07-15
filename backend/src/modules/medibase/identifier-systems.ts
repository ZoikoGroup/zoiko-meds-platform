/**
 * MediBase™ external identifier systems.
 *
 * Declares the identifier namespaces MediBase can map a medicine entity onto,
 * with light format validation and value normalization. Validation is
 * structural only (shape/checksum where cheap) — it asserts nothing about
 * whether the code is licensed for a jurisdiction, which is governed separately
 * via `IdentifierMapping.licenseScope`.
 */

export type IdentifierSystemCode =
  | 'NDC'
  | 'RXCUI'
  | 'GTIN'
  | 'GS1'
  | 'DIN'
  | 'DMD'
  | 'ATC'
  | 'EAN'
  | 'UPC'
  | 'LOCAL';

export interface IdentifierSystem {
  code: IdentifierSystemCode;
  label: string;
  description: string;
  /** Structural validity check for a raw value. */
  validate: (value: string) => boolean;
  /** Canonicalize a value for storage/comparison (e.g. strip separators). */
  normalize: (value: string) => string;
}

const digitsOnly = (v: string) => v.replace(/[^0-9]/g, '');

/** GS1 mod-10 check digit (used by GTIN/EAN/UPC). */
function gs1CheckDigitValid(value: string): boolean {
  const d = digitsOnly(value);
  if (![8, 12, 13, 14].includes(d.length)) return false;
  const digits = d.split('').map(Number);
  const check = digits.pop() as number;
  let sum = 0;
  // Weight alternates 3/1 from the rightmost data digit.
  for (let i = digits.length - 1, mult = 3; i >= 0; i--, mult = mult === 3 ? 1 : 3) {
    sum += digits[i] * mult;
  }
  return (10 - (sum % 10)) % 10 === check;
}

export const IDENTIFIER_SYSTEMS: Record<IdentifierSystemCode, IdentifierSystem> = {
  NDC: {
    code: 'NDC',
    label: 'US National Drug Code',
    description: 'FDA National Drug Code (10–11 digits, hyphenated segments).',
    validate: (v) => /^\d{4,5}-?\d{3,4}-?\d{1,2}$/.test(v.trim()) || /^\d{10,11}$/.test(digitsOnly(v)),
    normalize: (v) => v.trim().replace(/\s+/g, ''),
  },
  RXCUI: {
    code: 'RXCUI',
    label: 'RxNorm Concept Unique Identifier',
    description: 'RxNorm RxCUI — a numeric concept identifier.',
    validate: (v) => /^\d{1,8}$/.test(v.trim()),
    normalize: (v) => v.trim().replace(/^0+(?=\d)/, ''),
  },
  GTIN: {
    code: 'GTIN',
    label: 'GS1 Global Trade Item Number',
    description: 'GS1 GTIN-8/12/13/14 with mod-10 check digit.',
    validate: gs1CheckDigitValid,
    normalize: digitsOnly,
  },
  GS1: {
    code: 'GS1',
    label: 'GS1 identifier',
    description: 'GS1 trade item identifier (GTIN family).',
    validate: gs1CheckDigitValid,
    normalize: digitsOnly,
  },
  DIN: {
    code: 'DIN',
    label: 'Canadian Drug Identification Number',
    description: 'Health Canada DIN — 8 digits.',
    validate: (v) => /^\d{8}$/.test(digitsOnly(v)),
    normalize: digitsOnly,
  },
  DMD: {
    code: 'DMD',
    label: 'NHS dm+d code',
    description: 'UK Dictionary of medicines and devices SNOMED-style identifier.',
    validate: (v) => /^\d{6,18}$/.test(digitsOnly(v)),
    normalize: digitsOnly,
  },
  ATC: {
    code: 'ATC',
    label: 'WHO ATC code',
    description: 'Anatomical Therapeutic Chemical classification code.',
    validate: (v) => /^[A-Z]\d{2}[A-Z]{2}\d{2}$/.test(v.trim().toUpperCase()),
    normalize: (v) => v.trim().toUpperCase(),
  },
  EAN: {
    code: 'EAN',
    label: 'European Article Number',
    description: 'EAN-8/13 retail barcode with mod-10 check digit.',
    validate: (v) => [8, 13].includes(digitsOnly(v).length) && gs1CheckDigitValid(v),
    normalize: digitsOnly,
  },
  UPC: {
    code: 'UPC',
    label: 'Universal Product Code',
    description: 'UPC-A 12-digit retail barcode with mod-10 check digit.',
    validate: (v) => digitsOnly(v).length === 12 && gs1CheckDigitValid(v),
    normalize: digitsOnly,
  },
  LOCAL: {
    code: 'LOCAL',
    label: 'Local / jurisdiction code',
    description: 'A jurisdiction- or partner-local identifier with no global scheme.',
    validate: (v) => v.trim().length > 0 && v.trim().length <= 128,
    normalize: (v) => v.trim(),
  },
};

export const SUPPORTED_IDENTIFIER_SYSTEMS = Object.keys(
  IDENTIFIER_SYSTEMS,
) as IdentifierSystemCode[];

export function isSupportedSystem(code: string): code is IdentifierSystemCode {
  return code in IDENTIFIER_SYSTEMS;
}

export function normalizeIdentifier(
  code: IdentifierSystemCode,
  value: string,
): string {
  return IDENTIFIER_SYSTEMS[code].normalize(value);
}

export function isValidIdentifier(
  code: IdentifierSystemCode,
  value: string,
): boolean {
  return IDENTIFIER_SYSTEMS[code].validate(value);
}
