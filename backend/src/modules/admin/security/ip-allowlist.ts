/**
 * Address matching for the workspace IP allowlist (MSA-42).
 *
 * Accepts a bare address or a CIDR range, IPv4 or IPv6, and answers whether a
 * request address falls inside any entry. Split out from the guard so the
 * matching can be tested exhaustively without a request in hand — the cost of
 * getting this wrong is locking every operator out of their own console.
 */

/** Express reports IPv4 through an IPv6 socket as ::ffff:a.b.c.d. */
function normalize(address: string): string {
  const trimmed = address.trim();
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(trimmed);
  if (mapped) return mapped[1];
  // ::1 is the loopback the whole world writes as 127.0.0.1.
  if (trimmed === '::1') return '127.0.0.1';
  return trimmed;
}

function ipv4ToInt(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    // Rejects '', '1e2', '0x10' and '256' — Number() would accept most of them,
    // and an entry that parses loosely is an entry that matches too much.
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Expand to the 16 bytes of an IPv6 address, or null if it is not one. */
function ipv6ToBytes(address: string): Uint8Array | null {
  const plain = address.split('%')[0]; // strip any zone index
  if (!/^[0-9a-f:.]+$/i.test(plain) || !plain.includes(':')) return null;

  const halves = plain.split('::');
  if (halves.length > 2) return null;

  const parseGroups = (text: string): number[] | null => {
    if (!text) return [];
    const groups: number[] = [];
    for (const piece of text.split(':')) {
      if (piece === '') return null;
      if (piece.includes('.')) {
        // A trailing IPv4 tail, as in ::ffff:1.2.3.4.
        const asInt = ipv4ToInt(piece);
        if (asInt === null) return null;
        groups.push((asInt >>> 16) & 0xffff, asInt & 0xffff);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      groups.push(parseInt(piece, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0]);
  const tail = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (head === null || tail === null) return null;

  let groups: number[];
  if (halves.length === 2) {
    const gap = 8 - head.length - tail.length;
    if (gap < 0) return null;
    groups = [...head, ...Array(gap).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  groups.forEach((group, i) => {
    bytes[i * 2] = (group >>> 8) & 0xff;
    bytes[i * 2 + 1] = group & 0xff;
  });
  return bytes;
}

/** Does `address` fall inside `entry`, which may be a bare address or a CIDR? */
export function matchesEntry(address: string, entry: string): boolean {
  const target = normalize(address);
  const [network, prefixText] = normalize(entry).split('/');
  if (!network) return false;

  const targetV4 = ipv4ToInt(target);
  const networkV4 = ipv4ToInt(network);

  if (targetV4 !== null && networkV4 !== null) {
    if (prefixText === undefined) return targetV4 === networkV4;
    if (!/^\d{1,2}$/.test(prefixText)) return false;
    const prefix = Number(prefixText);
    if (prefix > 32) return false;
    if (prefix === 0) return true; // 0.0.0.0/0 — a shift by 32 is undefined in JS
    const mask = (-1 << (32 - prefix)) >>> 0;
    return ((targetV4 & mask) >>> 0) === ((networkV4 & mask) >>> 0);
  }

  const targetV6 = ipv6ToBytes(target);
  const networkV6 = ipv6ToBytes(network);
  if (targetV6 === null || networkV6 === null) return false;

  // A mixed family never matches; an IPv4 client against an IPv6 rule is not a
  // near miss, it is a different address space.
  const prefix = prefixText === undefined ? 128 : Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) return false;

  const wholeBytes = prefix >> 3;
  for (let i = 0; i < wholeBytes; i += 1) {
    if (targetV6[i] !== networkV6[i]) return false;
  }
  const remainingBits = prefix & 7;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (targetV6[wholeBytes] & mask) === (networkV6[wholeBytes] & mask);
}

/**
 * Is this address allowed by the list?
 *
 * An empty list allows everything. That is deliberate and matches the guard:
 * an allowlist switched on before anything is added would otherwise deny every
 * request including the one that would fix it.
 */
export function isAllowed(address: string | undefined, entries: string[]): boolean {
  if (!entries || entries.length === 0) return true;
  if (!address) return false;
  return entries.some((entry) => entry && matchesEntry(address, entry));
}

/**
 * Is this a well-formed entry?
 *
 * Used to reject a bad rule when it is saved rather than when it silently fails
 * to match anything.
 */
export function isValidEntry(entry: string): boolean {
  const [network, prefixText] = entry.trim().split('/');
  if (!network) return false;

  if (ipv4ToInt(normalize(network)) !== null) {
    if (prefixText === undefined) return true;
    return /^\d{1,2}$/.test(prefixText) && Number(prefixText) <= 32;
  }
  if (ipv6ToBytes(network) !== null) {
    if (prefixText === undefined) return true;
    return /^\d{1,3}$/.test(prefixText) && Number(prefixText) <= 128;
  }
  return false;
}
