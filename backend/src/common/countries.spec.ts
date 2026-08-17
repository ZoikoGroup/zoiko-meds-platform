import { countryDisplayName, marketDefaultCurrency, resolveCountryAlpha2 } from './countries';

describe('resolveCountryAlpha2 — a name and a code are the same answer', () => {
  it('accepts the alpha-2 code in any case', () => {
    expect(resolveCountryAlpha2('IN')).toBe('IN');
    expect(resolveCountryAlpha2('in')).toBe('IN');
    expect(resolveCountryAlpha2('  gb  ')).toBe('GB');
  });

  it('accepts the country name in any case', () => {
    expect(resolveCountryAlpha2('India')).toBe('IN');
    expect(resolveCountryAlpha2('india')).toBe('IN');
    expect(resolveCountryAlpha2('UNITED KINGDOM')).toBe('GB');
    expect(resolveCountryAlpha2('United Arab Emirates')).toBe('AE');
  });

  it('accepts what people actually type instead of the ISO name', () => {
    expect(resolveCountryAlpha2('USA')).toBe('US');
    expect(resolveCountryAlpha2('U.S.A.')).toBe('US');
    expect(resolveCountryAlpha2('UK')).toBe('GB');
    expect(resolveCountryAlpha2('England')).toBe('GB');
    expect(resolveCountryAlpha2('UAE')).toBe('AE');
    expect(resolveCountryAlpha2('Bharat')).toBe('IN');
    expect(resolveCountryAlpha2('the netherlands')).toBe('NL');
  });

  it('ignores accents and punctuation the typist varies', () => {
    expect(resolveCountryAlpha2("Côte d'Ivoire")).toBe('CI');
    expect(resolveCountryAlpha2('cote divoire')).toBe('CI');
  });

  it('resolves countries outside the core map through the host locale data', () => {
    // Only asserted when the host has full ICU; a trimmed build legitimately
    // falls back to the core map, and the fallback is the tested behaviour above.
    const hasFullIcu = new Intl.DisplayNames(['en'], { type: 'region' }).of('BW') === 'Botswana';
    if (!hasFullIcu) return;

    expect(resolveCountryAlpha2('Botswana')).toBe('BW');
    expect(resolveCountryAlpha2('paraguay')).toBe('PY');
  });

  it('refuses a well-formed pair of letters that is not a country', () => {
    // The old checkout accepted anything two characters long, so "ZZ" reached the
    // price catalog as a market and failed much later.
    expect(resolveCountryAlpha2('ZZ')).toBeNull();
    expect(resolveCountryAlpha2('XX')).toBeNull();
  });

  it('refuses a value that is not a country at all, rather than guessing', () => {
    expect(resolveCountryAlpha2('Hyderabad')).toBeNull();
    expect(resolveCountryAlpha2('n/a')).toBeNull();
    expect(resolveCountryAlpha2('')).toBeNull();
    expect(resolveCountryAlpha2('   ')).toBeNull();
    expect(resolveCountryAlpha2(null)).toBeNull();
    expect(resolveCountryAlpha2(undefined)).toBeNull();
  });
});

describe('countryDisplayName', () => {
  it('names a code so a stored "IN" can be echoed back as India', () => {
    expect(countryDisplayName('IN')).toBe('India');
  });

  it('returns the input unchanged when it is not a country', () => {
    expect(countryDisplayName('ZZ')).toBe('ZZ');
  });
});

describe('marketDefaultCurrency', () => {
  it('knows the currency a market is normally billed in', () => {
    expect(marketDefaultCurrency('IN')).toBe('INR');
    expect(marketDefaultCurrency('gb')).toBe('GBP');
    expect(marketDefaultCurrency('DE')).toBe('EUR');
  });

  it('has no opinion about a market it does not list', () => {
    // Deliberate: no preference means the caller must be told to name a currency,
    // never that one can be assumed.
    expect(marketDefaultCurrency('BW')).toBeNull();
  });
});
