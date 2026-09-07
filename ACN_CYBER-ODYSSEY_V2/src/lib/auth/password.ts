import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);

const KEY_LENGTH = 64;

/**
 * Hashes a plaintext password using crypto.scrypt with a unique random salt.
 * Formats as `salt:derivedKeyHex`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a stored `salt:derivedKeyHex` hash
 * in constant time to prevent timing attacks.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;

    const salt = parts[0]!;
    const originalHash = parts[1]!;

    const originalHashBuffer = Buffer.from(originalHash, 'hex');
    const derivedKeyBuffer = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;

    if (originalHashBuffer.length !== derivedKeyBuffer.length) {
      return false;
    }

    return timingSafeEqual(originalHashBuffer, derivedKeyBuffer);
  } catch {
    return false;
  }
}
