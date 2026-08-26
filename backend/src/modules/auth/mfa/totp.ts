import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) over HMAC-SHA1, which is what every authenticator app
 * implements by default.
 *
 * Hand-written rather than pulled in, because the algorithm is small and fully
 * specified and this avoids adding a dependency to the sign-in path. Everything
 * below is the RFC's default parameter set: 30-second steps, 6 digits, SHA-1,
 * counted from the Unix epoch. Changing any of them breaks every enrolled
 * authenticator, so they are constants rather than options.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

/**
 * How many steps either side of now are accepted.
 *
 * One step, so a code stays usable for up to 90 seconds across the boundary.
 * That is the standard allowance for clock skew between a phone and a server;
 * widening it widens the window an intercepted code stays replayable in.
 */
export const TOTP_WINDOW = 1;

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32, unpadded — the encoding authenticator apps expect. */
export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(input: string): Buffer {
  // Padding and spacing are how these secrets get written down and pasted back.
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Invalid base32 character in TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/**
 * A new secret. 20 bytes is the SHA-1 block size and the length RFC 4226
 * recommends; shorter secrets weaken the HMAC for no gain in usability.
 */
export function generateSecret(): string {
  return base32Encode(randomBytes(20));
}

/** The code for one counter value. */
function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  // writeBigUInt64BE rather than two 32-bit halves: the counter is a 64-bit
  // value in the RFC, and the naive split silently breaks past 2^32 steps.
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  // Dynamic truncation, RFC 4226 section 5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return (binary % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, '0');
}

/** The code for a moment in time. Exported for tests and for enrolment checks. */
export function generateCode(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  return hotp(base32Decode(secretBase32), counter);
}

/**
 * Is `code` valid for this secret right now?
 *
 * Compares in constant time, and against every accepted step, so the answer
 * cannot be narrowed down by how long the comparison took. Returns false rather
 * than throwing on a malformed secret or code: this sits on the sign-in path,
 * and a bad input there is a failed attempt, not a server error.
 */
export function verifyCode(
  secretBase32: string | null | undefined,
  code: string | null | undefined,
  atMs: number = Date.now(),
): boolean {
  if (!secretBase32 || !code) return false;

  // Authenticator apps and password managers space the digits for readability.
  const candidate = code.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(candidate)) return false;

  let secret: Buffer;
  try {
    secret = base32Decode(secretBase32);
  } catch {
    return false;
  }
  if (secret.length === 0) return false;

  const counter = Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
  const candidateBuffer = Buffer.from(candidate);

  let matched = false;
  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift += 1) {
    const expected = Buffer.from(hotp(secret, counter + drift));
    // Both are TOTP_DIGITS long by construction, so the lengths always agree
    // and timingSafeEqual cannot throw.
    if (timingSafeEqual(expected, candidateBuffer)) {
      // No early return: leaving the loop on the first hit would make a code
      // from an earlier step measurably slower to reject than a later one.
      matched = true;
    }
  }
  return matched;
}

/**
 * The otpauth:// URI an authenticator app scans.
 *
 * The issuer appears twice by convention — once as a label prefix and once as a
 * parameter — because apps disagree about which one they read.
 */
export function otpauthUri(
  secretBase32: string,
  accountEmail: string,
  issuer = 'ZoikoMeds',
): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretBase32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
