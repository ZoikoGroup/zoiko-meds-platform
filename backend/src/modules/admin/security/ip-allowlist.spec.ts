import { isAllowed, isValidEntry, matchesEntry } from './ip-allowlist';

/**
 * The cost of getting this wrong is locking every operator out of their own
 * console, so the matching is pinned exhaustively rather than sampled.
 */
describe('IP allowlist matching', () => {
  describe('IPv4', () => {
    it.each([
      ['203.0.113.7', '203.0.113.7', true],
      ['203.0.113.7', '203.0.113.8', false],
      ['203.0.113.7', '203.0.113.0/24', true],
      ['203.0.113.7', '203.0.114.0/24', false],
      ['10.1.2.3', '10.0.0.0/8', true],
      ['11.1.2.3', '10.0.0.0/8', false],
      ['192.168.1.55', '192.168.1.0/28', false],
      ['192.168.1.9', '192.168.1.0/28', true],
      // /32 is a single host, /0 is everything.
      ['8.8.8.8', '8.8.8.8/32', true],
      ['8.8.8.9', '8.8.8.8/32', false],
      ['1.2.3.4', '0.0.0.0/0', true],
    ])('%s against %s is %p', (address, entry, expected) => {
      expect(matchesEntry(address, entry)).toBe(expected);
    });

    // Express reports IPv4 through an IPv6 socket in this form; treating it as
    // "not IPv4" would refuse every request behind a dual-stack proxy.
    it('unwraps IPv4-mapped IPv6 addresses', () => {
      expect(matchesEntry('::ffff:203.0.113.7', '203.0.113.0/24')).toBe(true);
    });

    it('treats ::1 as loopback', () => {
      expect(matchesEntry('::1', '127.0.0.1')).toBe(true);
    });
  });

  describe('IPv6', () => {
    it.each([
      ['2001:db8::1', '2001:db8::1', true],
      ['2001:db8::1', '2001:db8::2', false],
      ['2001:db8::1', '2001:db8::/32', true],
      ['2001:db9::1', '2001:db8::/32', false],
      ['2001:db8:0:0:0:0:0:5', '2001:db8::/64', true],
      ['fe80::1', '2001:db8::/16', false],
      // A prefix that does not land on a byte boundary.
      ['2001:db8:8000::1', '2001:db8:8000::/33', true],
      ['2001:db8:0000::1', '2001:db8:8000::/33', false],
    ])('%s against %s is %p', (address, entry, expected) => {
      expect(matchesEntry(address, entry)).toBe(expected);
    });

    it('never matches across address families', () => {
      expect(matchesEntry('203.0.113.7', '2001:db8::/32')).toBe(false);
      expect(matchesEntry('2001:db8::1', '203.0.113.0/24')).toBe(false);
    });
  });

  describe('malformed input', () => {
    // An entry that parses loosely is an entry that matches too much.
    it.each([
      ['203.0.113.256', '203.0.113.0/24'],
      ['203.0.113', '203.0.113.0/24'],
      ['1e2.0.113.7', '203.0.113.0/24'],
      ['0x10.0.113.7', '203.0.113.0/24'],
      ['', '203.0.113.0/24'],
    ])('refuses %p as an address', (address, entry) => {
      expect(matchesEntry(address, entry)).toBe(false);
    });

    it.each([
      ['203.0.113.7', '203.0.113.0/33'],
      ['203.0.113.7', '203.0.113.0/'],
      ['203.0.113.7', 'not-an-address'],
      ['203.0.113.7', ''],
      ['2001:db8::1', '2001:db8::/129'],
    ])('refuses %p as a rule', (address, entry) => {
      expect(matchesEntry(address, entry)).toBe(false);
    });
  });

  describe('the list as a whole', () => {
    it('allows everything when the list is empty', () => {
      // Matches the guard: an allowlist switched on before anything is added
      // would otherwise deny the request that would fix it.
      expect(isAllowed('203.0.113.7', [])).toBe(true);
    });

    it('allows an address matching any one entry', () => {
      expect(isAllowed('10.0.0.5', ['203.0.113.0/24', '10.0.0.0/8'])).toBe(true);
    });

    it('refuses an address matching none', () => {
      expect(isAllowed('198.51.100.1', ['203.0.113.0/24', '10.0.0.0/8'])).toBe(false);
    });

    it('refuses a request with no address at all once a list is set', () => {
      expect(isAllowed(undefined, ['203.0.113.0/24'])).toBe(false);
    });

    it('skips a blank entry rather than letting it match', () => {
      expect(isAllowed('198.51.100.1', ['', '  '])).toBe(false);
    });
  });

  describe('entry validation', () => {
    it.each([
      '203.0.113.7',
      '203.0.113.0/24',
      '10.0.0.0/8',
      '0.0.0.0/0',
      '2001:db8::1',
      '2001:db8::/32',
      '::1',
    ])('accepts %p', (entry) => {
      expect(isValidEntry(entry)).toBe(true);
    });

    it.each([
      '203.0.113.256',
      '203.0.113.0/33',
      '2001:db8::/129',
      'example.com',
      '',
      '/24',
    ])('rejects %p', (entry) => {
      expect(isValidEntry(entry)).toBe(false);
    });
  });
});
