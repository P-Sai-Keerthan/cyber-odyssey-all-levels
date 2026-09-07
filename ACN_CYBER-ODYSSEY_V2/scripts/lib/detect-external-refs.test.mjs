import { describe, it, expect } from 'vitest';
import { scanContent, BLOCKED_HOSTS } from './detect-external-refs.mjs';

describe('detect-external-refs', () => {
  it('detects blocked CDN hosts', () => {
    for (const host of BLOCKED_HOSTS) {
      const findings = scanContent(`const url = "https://${host}/script.js";`);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0]?.kind).toContain('blocked host');
    }
  });

  it('permits localhost and safe internal references', () => {
    const findings = scanContent(`const url = "http://localhost:3000/api";`);
    expect(findings.length).toBe(0);
  });

  it('detects external script tags', () => {
    const findings = scanContent('<script src="https://example.com/analytics.js"></script>');
    expect(findings.length).toBe(1);
    expect(findings[0]?.kind).toBe('external script src');
  });

  it('detects external css imports and urls', () => {
    const findings = scanContent('@import url("https://example.com/style.css");');
    expect(findings.length).toBeGreaterThan(0);
  });
});
