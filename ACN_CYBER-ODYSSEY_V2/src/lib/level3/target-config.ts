import 'server-only';
import { cache } from 'react';
import { prisma } from '@/lib/prisma';

/**
 * Level 3 event configuration — read and write.
 *
 * ---------------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH
 * ---------------------------------------------------------------------------
 * The participant page, the Creator console and the scoring summary all read the
 * target address and the track ceilings from HERE. Nothing renders a literal.
 * That is the whole point of the model: an address hardcoded in a component
 * needs a redeploy to change, and mid-event a redeploy is not available.
 *
 * The sample report is not in this file. It is a file, and files live in
 * `LevelResource` — see `@/lib/event/level-resources`.
 */

/** The row id. There is exactly one Level 3 configuration per portal instance. */
const CONFIG_ID = 'default';

export interface Level3TargetConfig {
  /** Dotted-quad IPv4, or null when the Creator has not configured one. */
  targetIp: string | null;
  /** Discovery points available before Track 2 is released. */
  track1Points: number;
  /** CUMULATIVE discovery points once Track 2 is released. Includes Track 1. */
  track2Points: number;
  track2Released: boolean;
  /**
   * The ceiling that applies right now: `track1Points` until Track 2 is
   * released, `track2Points` afterwards. Never the sum — `track2Points` is
   * already cumulative, and adding them would double-count Track 1.
   */
  availableDiscoveryPoints: number;
  updatedAt: string | null;
}

/**
 * Defaults used when no row exists yet.
 *
 * These are the event's published figures, and they are written into the
 * database by the migration default and by `getLevel3Config` on first read — so
 * they are a bootstrap value, not a parallel source of truth. Once the row
 * exists the database wins, including when a Creator lowers a ceiling.
 */
export const LEVEL3_CONFIG_DEFAULTS = {
  track1Points: 3500,
  track2Points: 6500,
  track2Released: false,
} as const;

/**
 * IPv4 dotted-quad validation.
 *
 * Deliberately strict, and deliberately not a regex-only check:
 *
 *   - exactly four octets
 *   - each octet is digits only (so "1e2", "0x7f", " 10" and "10 " all fail)
 *   - each octet is 0-255
 *   - no leading zeros — "010.1.1.1" is rejected because C's inet_aton reads a
 *     leading-zero octet as OCTAL, so a string that looks like one address to a
 *     participant resolves to another for a tool they paste it into
 *
 * IPv6 is rejected rather than accepted: the event's target infrastructure is
 * IPv4, and silently storing an address the challenge environment cannot use
 * would surface as a participant-facing mystery hours later. `isIpv6Shaped`
 * exists so the caller can say *why* rather than "invalid".
 */
const IPV4_OCTET = /^\d{1,3}$/;

export function isIpv6Shaped(value: string): boolean {
  // Any colon at all. IPv4 never contains one, so this cannot false-positive on
  // a valid v4 address, and it catches every v6 form including "::1" and
  // v4-mapped "::ffff:10.0.0.1".
  return value.includes(':');
}

export function isValidIpv4(value: string): boolean {
  const parts = value.split('.');
  if (parts.length !== 4) return false;

  for (const part of parts) {
    if (!IPV4_OCTET.test(part)) return false;
    // Leading zero on a multi-digit octet — see the octal note above.
    if (part.length > 1 && part.startsWith('0')) return false;
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * Normalises and validates a Creator-supplied target address.
 *
 * Returns the value to store, or an error message written for the Creator who
 * typed it. An empty string means "clear the target", which is a legitimate
 * configuration state — the participant page then shows a neutral
 * "not yet assigned" panel rather than a broken field.
 */
export function parseTargetIp(
  raw: string,
): { ok: true; value: string | null } | { ok: false; error: string } {
  const trimmed = raw.trim();

  if (trimmed === '') return { ok: true, value: null };

  if (isIpv6Shaped(trimmed)) {
    return {
      ok: false,
      error:
        'IPv6 addresses are not supported for the Level 3 target. ' +
        'The challenge environment is reachable over IPv4 only — enter a dotted-quad address such as 10.20.30.40.',
    };
  }

  if (!isValidIpv4(trimmed)) {
    return {
      ok: false,
      error:
        `"${trimmed}" is not a valid IPv4 address. ` +
        'Enter four numbers 0-255 separated by dots, with no leading zeros — for example 10.20.30.40.',
    };
  }

  return { ok: true, value: trimmed };
}

function shape(row: {
  targetIp: string | null;
  track1Points: number;
  track2Points: number;
  track2Released: boolean;
  updatedAt: Date;
}): Level3TargetConfig {
  return {
    targetIp: row.targetIp,
    track1Points: row.track1Points,
    track2Points: row.track2Points,
    track2Released: row.track2Released,
    availableDiscoveryPoints: row.track2Released ? row.track2Points : row.track1Points,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Reads the configuration, creating the row on first access.
 *
 * Request-scoped via `cache()`: the /event card grid, the Level 3 page and the
 * score summary each read this within one render, and it is event-wide
 * configuration identical for every viewer. The memo lasts for that render only
 * — a Creator's edit is visible on the very next request.
 *
 * Sits on the Level 3 participant render path, so it is a single primary-key
 * lookup. The create is guarded rather than an upsert-on-every-read: an upsert
 * would take a write lock on the hottest row in the level for every participant
 * on every navigation.
 */
export const getLevel3Config = cache(async function getLevel3Config(): Promise<Level3TargetConfig> {
  const existing = await prisma.level3Config.findUnique({ where: { id: CONFIG_ID } });
  if (existing) return shape(existing);

  try {
    const created = await prisma.level3Config.create({
      data: { id: CONFIG_ID, ...LEVEL3_CONFIG_DEFAULTS },
    });
    return shape(created);
  } catch {
    // A concurrent request created it first; the id is the primary key, so the
    // row exists either way. Re-read rather than guessing.
    const row = await prisma.level3Config.findUnique({ where: { id: CONFIG_ID } });
    if (row) return shape(row);

    // Genuinely unreachable short of the table being gone. Return the bootstrap
    // figures rather than throwing on a participant's page render.
    return {
      targetIp: null,
      ...LEVEL3_CONFIG_DEFAULTS,
      availableDiscoveryPoints: LEVEL3_CONFIG_DEFAULTS.track1Points,
      updatedAt: null,
    };
  }
});

export interface Level3ConfigUpdate {
  targetIp?: string | null;
  track1Points?: number;
  track2Points?: number;
  track2Released?: boolean;
}

/**
 * Writes the configuration. Authorization is the CALLER's responsibility — this
 * is a data-layer function and is only ever reached through a server action that
 * has already established an active CREATOR session.
 */
export async function updateLevel3Config(
  patch: Level3ConfigUpdate,
  actorId: string,
): Promise<Level3TargetConfig> {
  const updated = await prisma.level3Config.upsert({
    where: { id: CONFIG_ID },
    update: { ...patch, updatedById: actorId },
    create: { id: CONFIG_ID, ...LEVEL3_CONFIG_DEFAULTS, ...patch, updatedById: actorId },
  });
  return shape(updated);
}
