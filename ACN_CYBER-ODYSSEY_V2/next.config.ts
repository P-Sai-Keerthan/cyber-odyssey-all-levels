import type { NextConfig } from 'next';
import path from 'path';

const isProd = process.env.NODE_ENV === 'production';

/**
 * Content Security Policy.
 * Every directive resolves to 'self' or none (CR-13 / SEC-27).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? '' : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
]
  .join('; ')
  .concat(';');

/** Security headers applied to every response. */
const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

/**
 * `output: 'standalone'` is for containerised deployment ONLY.
 *
 * Next refuses to serve `.next/static` through `next start` when standalone
 * output is configured — it prints a warning and then 400s every asset, which
 * means no JavaScript reaches the browser and nothing on the page is
 * interactive. A local `npm run build && npm start` must therefore NOT set it.
 *
 * The key is SPREAD IN rather than set to `undefined`. Under this project's
 * `exactOptionalPropertyTypes: true`, `output: undefined` is a type error —
 * an optional property may be absent, but it may not be present-and-undefined.
 * Writing it as a conditional spread omits the key entirely, which is what
 * "not configured" actually means and what the type demands.
 */

const nextConfig: NextConfig = {
  ...(process.env['DOCKER_BUILD'] ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: path.join(__dirname),
  reactStrictMode: true,
  poweredByHeader: false,
  images: { unoptimized: true },
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  /**
   * Server Action request bodies carry file uploads, and the default cap is 1 MB.
   *
   * THIS WAS THE LEVEL 2 SUBMISSION BUG. Next.js reads the multipart body itself,
   * counts the bytes, and throws `ApiError(413, 'Body exceeded 1 MB limit.')`
   * BEFORE the action function is entered — see
   * next/dist/server/app-render/action-handler.js, where `defaultBodySizeLimit`
   * is '1 MB'. So a squad attaching a 1.7 MB report never reached a single line
   * of validation: the promise rejected, the workspace's catch block reported
   * "An unexpected error occurred during submission", and the server log showed
   * nothing from the submission code because none of it ran.
   *
   * 25 MB, not 20: the limit applies to the whole encoded request, which is the
   * 20 MB file plus multipart boundaries, field names and any second attachment.
   * Sizing it at exactly the per-file limit would reject a file that is legal by
   * a few kilobytes of envelope.
   *
   * Level 2 now posts to /api/event/level-2/submission, a route handler with no
   * such cap, so it no longer depends on this value. It stays because Level 3
   * still submits its report through a Server Action and would otherwise fail in
   * exactly the same way.
   */
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },

  async redirects() {
    return [
      {
        source: '/',
        destination: '/login',
        permanent: false,
      },
    ];
  },

  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
