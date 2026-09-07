import 'server-only';
import { randomInt } from 'crypto';

/**
 * Secure temporary-credential generation for account and squad recovery.
 *
 * DESIGN CONSTRAINTS (Creator spec §6 and §10)
 * --------------------------------------------
 * The Creator must be able to RECOVER access for a participant or squad that has
 * lost its credentials. The Creator must NOT be able to DISCLOSE an existing
 * password. Those are different capabilities and the difference is the whole
 * point of this module:
 *
 *   - Existing passwords are stored only as scrypt hashes and are not
 *     recoverable, by anyone, including the Creator. There is deliberately no
 *     "show password" capability anywhere in this codebase.
 *   - Recovery therefore REPLACES the credential rather than revealing it. The
 *     previous credential stops working the moment the new hash is written.
 *
 * The generated plaintext is returned to the calling action exactly once, so it
 * can be shown to the authorised Creator, and is never persisted, never logged,
 * and never written to an audit record. The audit trail records that a reset
 * happened and who performed it — never the value.
 */

/**
 * Alphabet excluding characters that are ambiguous when read aloud or copied
 * from a screen: 0/O, 1/l/I, 5/S, 2/Z. A recovery credential is typically read
 * out by a marshal to a participant, so transcription errors are a real cost.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY';
const DIGITS = '346789';
const SYMBOLS = '!@#$%&*';

/** Long enough that the reduced alphabet still leaves ample entropy. */
const TEMP_PASSWORD_LENGTH = 16;

/**
 * Generates a strong temporary password.
 *
 * Uses `crypto.randomInt` (CSPRNG), never `Math.random`. Composition is
 * guaranteed to include upper, lower, digit and symbol so the value satisfies
 * any downstream policy, and the result is shuffled so those guaranteed
 * characters are not always in the same positions.
 *
 * Entropy: with the pools below, 16 characters drawn from a ~48-character
 * combined alphabet is well over 80 bits — far beyond what a portal login with
 * a 10-attempt lockout could ever be brute-forced against.
 */
export function generateTemporaryPassword(): string {
  const lower = ALPHABET.toLowerCase();
  const pool = ALPHABET + lower + DIGITS + SYMBOLS;

  const pick = (source: string): string => source[randomInt(0, source.length)]!;

  // Guarantee one of each class, then fill the remainder from the full pool.
  const required = [pick(ALPHABET), pick(lower), pick(DIGITS), pick(SYMBOLS)];
  const rest = Array.from({ length: TEMP_PASSWORD_LENGTH - required.length }, () => pick(pool));
  const chars = [...required, ...rest];

  // Fisher-Yates with a CSPRNG, so the guaranteed characters are not positional.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    const a = chars[i]!;
    const b = chars[j]!;
    chars[i] = b;
    chars[j] = a;
  }

  return chars.join('');
}

/**
 * Redacts a credential for any context that might be logged.
 *
 * Nothing in this codebase should ever be passing a plaintext credential to a
 * logger, but this exists so that if a future change is tempted to, the safe
 * form is already at hand.
 */
export function redactCredential(): string {
  return '[redacted]';
}
