import { isPhoneAcceptable, normalizePhone } from './phone';

describe('normalizePhone — one number, one stored spelling', () => {
  it('reads a local number against the pharmacy country', () => {
    // What is printed on an Indian pharmacy's door.
    expect(normalizePhone('040 2345 6789', 'IN')).toBe('+914023456789');
    expect(normalizePhone('9876543210', 'IN')).toBe('+919876543210');
  });

  it('gives the same answer however the number was punctuated', () => {
    // These are one number, and one number has to be one stored value or the same
    // pharmacy's landline cannot be recognised twice.
    const forms = ['+91 40 2345 6789', '+91-40-2345-6789', '(040) 2345 6789', '040 2345 6789'];

    expect(new Set(forms.map((form) => normalizePhone(form, 'IN'))).size).toBe(1);
    expect(normalizePhone('+91-40-2345-6789', 'IN')).toBe('+914023456789');
  });

  it('accepts an international number without needing the country', () => {
    // The + form carries its own country code, so the hint is not consulted.
    expect(normalizePhone('+919876543210')).toBe('+919876543210');
    expect(normalizePhone('+1 (415) 555-2671')).toBe('+14155552671');
  });

  it('reads a local number in whichever country it is given', () => {
    expect(normalizePhone('(415) 555-2671', 'US')).toBe('+14155552671');
    expect(normalizePhone('020 7946 0958', 'GB')).toBe('+442079460958');
  });

  it('lower-cases nothing and trusts nothing: a bad number is refused', () => {
    expect(normalizePhone('12345', 'IN')).toBeNull();
    expect(normalizePhone('not a phone', 'IN')).toBeNull();
    expect(normalizePhone('+99 000', 'IN')).toBeNull();
  });

  it('cannot read a local number with no country to read it against', () => {
    // The same digits are a real number in several countries and in none, so
    // guessing would store a number that rings somewhere unintended.
    expect(normalizePhone('040 2345 6789')).toBeNull();
    expect(normalizePhone('040 2345 6789', 'ZZ')).toBeNull();
  });

  it('treats an empty value as nothing to store, not as an error', () => {
    expect(normalizePhone('', 'IN')).toBeNull();
    expect(normalizePhone('   ', 'IN')).toBeNull();
    expect(normalizePhone(null, 'IN')).toBeNull();
    expect(normalizePhone(undefined, 'IN')).toBeNull();
  });
});

describe('isPhoneAcceptable', () => {
  it('accepts an empty field, which is optional everywhere it appears', () => {
    expect(isPhoneAcceptable('', 'IN')).toBe(true);
    expect(isPhoneAcceptable(null, 'IN')).toBe(true);
  });

  it('accepts anything that normalizes and refuses anything that does not', () => {
    expect(isPhoneAcceptable('040 2345 6789', 'IN')).toBe(true);
    expect(isPhoneAcceptable('12345', 'IN')).toBe(false);
  });
});
