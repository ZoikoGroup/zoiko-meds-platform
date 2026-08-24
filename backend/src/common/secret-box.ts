import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

/**
 * Symmetric encryption for third-party credentials held at rest.
 *
 * This is for secrets the server must be able to *replay* — the auth header a
 * pharmacy's POS feed expects, for example. Hashing is the right answer for
 * anything we only need to compare (passwords, our own API keys, reset
 * tokens), and those stay hashed; a value we have to send back out cannot be.
 *
 * AES-256-GCM, so a tampered ciphertext fails to open rather than decrypting
 * to something else. The key is derived from INTEGRATION_ENCRYPTION_KEY when
 * set, otherwise from JWT_SECRET, which boot-time validation already forces to
 * be strong and non-placeholder in production. Rotating either one makes
 * existing ciphertexts unreadable: `open` answers null instead of throwing, so
 * the operator is asked for the credential again rather than the request
 * failing with a crypto error.
 */

const VERSION = 'v1';

function key(): Buffer {
  const material =
    process.env.INTEGRATION_ENCRYPTION_KEY || process.env.JWT_SECRET || '';
  if (!material) {
    throw new Error(
      'Cannot encrypt integration credentials: neither INTEGRATION_ENCRYPTION_KEY nor JWT_SECRET is set.',
    );
  }
  // A passphrase of any length becomes the 32 bytes AES-256 requires.
  return createHash('sha256').update(material).digest();
}

/** Encrypt a value for storage. Returns "v1.iv.tag.ciphertext", all base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  return [
    VERSION,
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    enc.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a stored value. Answers null for anything this key cannot open —
 * a rotated key, a truncated column, a value written by a future format —
 * because none of those are conditions the caller can do anything about
 * except treat the credential as absent.
 */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const parts = sealed.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key(),
      Buffer.from(parts[1], 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3], 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}
