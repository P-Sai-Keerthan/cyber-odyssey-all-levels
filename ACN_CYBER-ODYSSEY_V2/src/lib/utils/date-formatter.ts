/**
 * Deterministic Date and Time Formatting Utilities for ACN Cyber Odyssey.
 * Strictly guarantees identical string outputs during SSR and Client-side React Hydration
 * by enforcing a fixed locale ('en-US') and deterministic timezone ('UTC').
 */

const DEFAULT_LOCALE = 'en-US';
const DEFAULT_TIMEZONE = 'UTC';

const DATE_FORMATTER = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: DEFAULT_TIMEZONE,
});

const NUMERIC_DATE_FORMATTER = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  timeZone: DEFAULT_TIMEZONE,
});

const TIME_FORMATTER = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: DEFAULT_TIMEZONE,
});

const SHORT_TIME_FORMATTER = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: DEFAULT_TIMEZONE,
});

const DATETIME_FORMATTER = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: DEFAULT_TIMEZONE,
});

const SHORT_DATETIME_FORMATTER = new Intl.DateTimeFormat(DEFAULT_LOCALE, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: DEFAULT_TIMEZONE,
});

function parseSafeDate(input: string | number | Date | null | undefined): Date | null {
  if (!input) return null;
  const d = typeof input === 'object' && input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return null;
  return d;
}

/**
 * Formats a timestamp as 'Aug 31, 2026' deterministically.
 */
export function formatDate(
  input: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parseSafeDate(input);
  if (!d) return fallback;
  return DATE_FORMATTER.format(d);
}

/**
 * Formats a timestamp as '08/31/2026' deterministically.
 */
export function formatNumericDate(
  input: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parseSafeDate(input);
  if (!d) return fallback;
  return NUMERIC_DATE_FORMATTER.format(d);
}

/**
 * Formats a timestamp as '18:30:00' deterministically.
 */
export function formatTime(
  input: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parseSafeDate(input);
  if (!d) return fallback;
  return TIME_FORMATTER.format(d);
}

/**
 * Formats a timestamp as '18:30' deterministically.
 */
export function formatShortTime(
  input: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parseSafeDate(input);
  if (!d) return fallback;
  return SHORT_TIME_FORMATTER.format(d);
}

/**
 * Formats a timestamp as 'Aug 31, 2026, 18:30:00' deterministically.
 */
export function formatDateTime(
  input: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parseSafeDate(input);
  if (!d) return fallback;
  return DATETIME_FORMATTER.format(d);
}

/**
 * Formats a timestamp as 'Aug 31, 2026, 18:30' deterministically.
 */
export function formatShortDateTime(
  input: string | number | Date | null | undefined,
  fallback = '—',
): string {
  const d = parseSafeDate(input);
  if (!d) return fallback;
  return SHORT_DATETIME_FORMATTER.format(d);
}
