import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatNumericDate,
  formatTime,
  formatShortTime,
  formatDateTime,
  formatShortDateTime,
} from '@/lib/utils/date-formatter';

describe('Deterministic Date and Time Formatter (Hydration Safety)', () => {
  const fixedTimestamp = '2026-08-31T18:30:45.000Z';
  const dateObj = new Date(fixedTimestamp);
  const numericTime = dateObj.getTime();

  it('formats dates identically regardless of input type (string, Date, number)', () => {
    const formattedFromString = formatDate(fixedTimestamp);
    const formattedFromDate = formatDate(dateObj);
    const formattedFromNumber = formatDate(numericTime);

    expect(formattedFromString).toBe('Aug 31, 2026');
    expect(formattedFromDate).toBe('Aug 31, 2026');
    expect(formattedFromNumber).toBe('Aug 31, 2026');
  });

  it('formats numeric dates (MM/DD/YYYY) deterministically', () => {
    expect(formatNumericDate(fixedTimestamp)).toBe('08/31/2026');
  });

  it('formats 24-hour time deterministically in UTC', () => {
    expect(formatTime(fixedTimestamp)).toBe('18:30:45');
    expect(formatShortTime(fixedTimestamp)).toBe('18:30');
  });

  it('formats combined date-time deterministically in UTC', () => {
    expect(formatDateTime(fixedTimestamp)).toBe('Aug 31, 2026, 18:30:45');
    expect(formatShortDateTime(fixedTimestamp)).toBe('Aug 31, 2026, 18:30');
  });

  it('safely handles null, undefined, and invalid date inputs with fallback', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('invalid-date-string')).toBe('—');
    expect(formatDate(null, 'Never')).toBe('Never');

    expect(formatDateTime(null)).toBe('—');
    expect(formatTime(undefined)).toBe('—');
  });
});
