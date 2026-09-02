import {
  base32Decode,
  base32Encode,
  generateCode,
  generateSecret,
  otpauthUri,
  verifyCode,
  TOTP_STEP_SECONDS,
} from './totp';

describe('TOTP', () => {
  // RFC 4648 section 10 test vectors. Getting base32 subtly wrong produces a
  // secret that works in our own code and in no authenticator app.
  describe('base32', () => {
    const VECTORS: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];

    it.each(VECTORS)('encodes %p as %p', (plain, encoded) => {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
    });

    it.each(VECTORS)('decodes %p back from %p', (plain, encoded) => {
      expect(base32Decode(encoded).toString()).toBe(plain);
    });

    it('accepts padding and spacing, which is how secrets get written down', () => {
      expect(base32Decode('MZXW 6YTB OI==').toString()).toBe('foobar');
    });

    it('rejects a character outside the alphabet', () => {
      expect(() => base32Decode('MZXW1')).toThrow(/Invalid base32/);
    });
  });

  // RFC 6238 appendix B, using the SHA-1 seed "12345678901234567890".
  describe('RFC 6238 reference vectors', () => {
    const SECRET = base32Encode(Buffer.from('12345678901234567890'));

    it.each([
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ])('produces the published code at t=%i', (seconds, expected) => {
      expect(generateCode(SECRET, seconds * 1000)).toBe(expected);
    });

    it('stays correct past the 32-bit counter boundary', () => {
      // 20000000000s is step 666666666, well inside 64 bits and far outside 32.
      expect(generateCode(SECRET, 20000000000 * 1000)).toBe('353130');
    });
  });

  describe('verification', () => {
    const secret = generateSecret();
    const now = 1_700_000_000_000;

    it('accepts the current code', () => {
      expect(verifyCode(secret, generateCode(secret, now), now)).toBe(true);
    });

    it('accepts one step of clock skew in each direction', () => {
      const step = TOTP_STEP_SECONDS * 1000;
      expect(verifyCode(secret, generateCode(secret, now - step), now)).toBe(true);
      expect(verifyCode(secret, generateCode(secret, now + step), now)).toBe(true);
    });

    it('refuses a code two steps old, so an intercepted one expires', () => {
      const step = TOTP_STEP_SECONDS * 1000;
      expect(verifyCode(secret, generateCode(secret, now - 2 * step), now)).toBe(false);
    });

    it('refuses a code minted for a different secret', () => {
      expect(verifyCode(secret, generateCode(generateSecret(), now), now)).toBe(false);
    });

    it('tolerates the spacing authenticator apps display', () => {
      const code = generateCode(secret, now);
      expect(verifyCode(secret, `${code.slice(0, 3)} ${code.slice(3)}`, now)).toBe(true);
    });

    // This sits on the sign-in path: bad input is a failed attempt, not a 500.
    it.each([
      ['no secret', null, '000000'],
      ['no code', 'JBSWY3DPEHPK3PXP', null],
      ['empty code', 'JBSWY3DPEHPK3PXP', ''],
      ['too few digits', 'JBSWY3DPEHPK3PXP', '12345'],
      ['too many digits', 'JBSWY3DPEHPK3PXP', '1234567'],
      ['not digits', 'JBSWY3DPEHPK3PXP', 'abcdef'],
      ['malformed secret', '!!!!', '123456'],
      ['empty secret', '', '123456'],
    ])('returns false rather than throwing for %s', (_label, secretValue, code) => {
      expect(() => verifyCode(secretValue, code, now)).not.toThrow();
      expect(verifyCode(secretValue, code, now)).toBe(false);
    });
  });

  describe('secrets', () => {
    it('mints 160-bit secrets, the length RFC 4226 recommends for SHA-1', () => {
      expect(base32Decode(generateSecret())).toHaveLength(20);
    });

    it('does not repeat', () => {
      const seen = new Set(Array.from({ length: 50 }, () => generateSecret()));
      expect(seen.size).toBe(50);
    });
  });

  describe('otpauth URI', () => {
    const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'root@zoikomeds.test');

    it('carries the parameters this implementation actually uses', () => {
      expect(uri).toContain('secret=JBSWY3DPEHPK3PXP');
      expect(uri).toContain('algorithm=SHA1');
      expect(uri).toContain('digits=6');
      expect(uri).toContain('period=30');
    });

    it('escapes the label, so an email with a + still scans', () => {
      const plus = otpauthUri('JBSWY3DPEHPK3PXP', 'root+admin@zoikomeds.test');
      expect(plus).toContain('root%2Badmin%40zoikomeds.test');
    });
  });
});
