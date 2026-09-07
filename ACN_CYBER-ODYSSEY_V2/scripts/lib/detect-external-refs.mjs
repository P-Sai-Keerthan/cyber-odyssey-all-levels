/**
 * External-reference detection for CR-13 / SEC-27.
 * Scans content for external CDN/font/analytics references.
 */

export const BLOCKED_HOSTS = Object.freeze([
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
  'code.jquery.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
  'use.typekit.net',
  'use.fontawesome.com',
  'kit.fontawesome.com',
  'esm.sh',
  'cdn.skypack.dev',
  'polyfill.io',
  'www.googletagmanager.com',
  'www.google-analytics.com',
  'connect.facebook.net',
  'browser.sentry-cdn.com',
]);

const LOOPBACK = String.raw`(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])`;
const EXTERNAL = String.raw`https?:\/\/(?!${LOOPBACK})[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+`;

export const RESOURCE_PATTERNS = Object.freeze([
  { name: 'script src', source: String.raw`<script[^>]+src\s*=\s*["']${EXTERNAL}` },
  { name: 'link href', source: String.raw`<link[^>]+href\s*=\s*["']${EXTERNAL}` },
  { name: 'css url()', source: String.raw`(?<!new\s+)url\(\s*["']?${EXTERNAL}` },
  { name: 'css @import', source: String.raw`@import\s+(?:url\()?\s*["']${EXTERNAL}` },
  { name: 'importScripts', source: String.raw`importScripts\(\s*["']${EXTERNAL}` },
  {
    name: 'preconnect/dns-prefetch',
    source: String.raw`rel\s*=\s*["'](?:preconnect|dns-prefetch)["'][^>]*href\s*=\s*["']${EXTERNAL}`,
  },
]);

const MAX_FINDINGS_PER_FILE = 50;

export function scanContent(content, label = '<inline>') {
  const findings = [];

  const push = (kind, excerpt) => {
    findings.push({ file: label, kind, excerpt: excerpt.replace(/\s+/g, ' ').slice(0, 160) });
  };

  for (const host of BLOCKED_HOSTS) {
    let index = content.indexOf(host);
    while (index !== -1) {
      push(
        `blocked host: ${host}`,
        content.slice(Math.max(0, index - 60), index + host.length + 40),
      );
      if (findings.length >= MAX_FINDINGS_PER_FILE) return findings;
      index = content.indexOf(host, index + host.length);
    }
  }

  for (const { name, source } of RESOURCE_PATTERNS) {
    const re = new RegExp(source, 'gi');
    let match;
    while ((match = re.exec(content)) !== null) {
      push(`external ${name}`, match[0]);
      if (findings.length >= MAX_FINDINGS_PER_FILE) return findings;
    }
  }

  return findings;
}
