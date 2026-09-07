import { randomInt } from 'crypto';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 5;

/**
 * Generates a distinct, non-ambiguous team joining code.
 * Example: `CYB-7K4M2`
 */
export function generateTeamCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const randomIndex = randomInt(0, ALPHABET.length);
    code += ALPHABET[randomIndex];
  }
  return `CYB-${code}`;
}

/**
 * Normalizes user-entered team joining code (trims, uppercase, handles optional prefix).
 */
export function normalizeTeamCode(input: string): string {
  const clean = input.trim().toUpperCase();
  if (clean.startsWith('CYB-')) {
    return clean;
  }
  if (clean.startsWith('CYB')) {
    return `CYB-${clean.slice(3)}`;
  }
  return `CYB-${clean}`;
}
