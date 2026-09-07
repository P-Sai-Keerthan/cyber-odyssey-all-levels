import { randomBytes } from 'crypto';

/**
 * Stable external squad reference — the identifier this portal shares with every
 * external challenge application (Level 1 and ORION Level 3 alike).
 *
 * ---------------------------------------------------------------------------
 * WHY GENERATED AND NOT DERIVED
 * ---------------------------------------------------------------------------
 * A deterministic reference would be cheaper — no column to backfill, no
 * collision to handle. Every candidate input is disqualified:
 *
 *   Team.code      the PRIVATE join code. Deriving from it and handing the result
 *                  to two other systems puts a squad-membership secret into their
 *                  logs. Even hashed, a 5-character code from a 32-symbol
 *                  alphabet is ~33M possibilities — brute-forceable offline in
 *                  seconds, so the hash IS the code.
 *   Team.name      changes when a squad is renamed, which would silently orphan
 *                  every score already recorded against the old value.
 *   Team.id        an internal cuid. Publishing primary keys to systems
 *                  participants attack invites them to be guessed at or
 *                  correlated across endpoints, and it couples our storage to
 *                  their wire format.
 *
 * So: 128 random bits, generated once, meaning nothing outside this table.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT IS AND IS NOT
 * ---------------------------------------------------------------------------
 * NOT a credential. It names a squad; it does not authenticate one. Holding it
 * confers nothing: every integration request that mentions it must also carry a
 * valid HMAC over the whole body, and every ticket that produces it is single-use
 * and expires in minutes. Treating it as non-secret is what makes it safe to
 * print in logs on both sides — which is the whole point of having it.
 *
 * The `co_` prefix is source identification, not entropy. When a reference turns
 * up in a Level 1 log or an ORION trace, it is immediately obvious which system
 * minted it.
 */

/** Bytes of entropy. 128 bits: collision-free at any event scale, and unguessable. */
const REF_BYTES = 16;

/** Marks the value as Cyber Odyssey's, so it is identifiable in a foreign log. */
export const EXTERNAL_REF_PREFIX = 'co_';

/**
 * Mints a new external squad reference.
 *
 * `randomBytes` (CSPRNG), never `Math.random`. Hex rather than base64url so the
 * value survives a URL, a CSV, a shell argument and a log line unescaped — it
 * crosses more system boundaries than anything else in the schema.
 */
export function generateExternalTeamRef(): string {
  return `${EXTERNAL_REF_PREFIX}${randomBytes(REF_BYTES).toString('hex')}`;
}

/**
 * Shape check for a value arriving from outside.
 *
 * Cheap rejection of obvious rubbish before a database round trip; it is NOT an
 * authorisation check and must never be treated as one. A well-formed reference
 * that does not exist in `Team` is rejected by the lookup, and a reference that
 * does exist still proves nothing without a valid signature on the request.
 */
export function isWellFormedExternalTeamRef(value: string): boolean {
  return new RegExp(`^${EXTERNAL_REF_PREFIX}[0-9a-f]{${REF_BYTES * 2}}$`).test(value);
}
