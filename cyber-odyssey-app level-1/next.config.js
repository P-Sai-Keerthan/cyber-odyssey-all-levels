/**
 * Level 1 challenge application — Next.js configuration.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 * This application had no Next config, and it sits in a directory whose PARENT
 * also contained a `package-lock.json`. Next.js walks upward looking for a
 * lockfile to decide where the workspace root is, found the parent's, and
 * printed on every build:
 *
 *     ⚠ Next.js inferred your workspace root, but it may not be correct.
 *       We detected multiple lockfiles and selected the directory of
 *       C:\...\all levels\package-lock.json as the root directory.
 *
 * That is not merely noise. The inferred root decides which files Next traces
 * into a build, so a wrong root can pull the sibling Portal application into
 * this app's output — or miss files this app actually needs.
 *
 * The parent lockfile was an orphan: five lines, `"packages": {}`, and no
 * package.json beside it. It has been removed. These two applications are
 * INDEPENDENT deployables, not a workspace: separate package.json files,
 * separate lockfiles, separate databases (SQLite for the Portal, PostgreSQL
 * here), separate ports, separate release cadences. Pinning the root here states
 * that intent in code, so re-creating a stray file upstairs cannot silently
 * change what this build contains.
 */

const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This directory is the root. Not the parent, whatever it happens to contain.
  turbopack: {
    root: __dirname,
  },
  outputFileTracingRoot: path.join(__dirname),

  poweredByHeader: false,
  reactStrictMode: true,

  /**
   * Security headers.
   *
   * Deliberately WITHOUT a Content-Security-Policy. Level 1 is an intentionally
   * vulnerable application: several of its challenges are client-side and a CSP
   * would neutralise the exercise the participants came to solve. The headers
   * kept here are the ones that protect the SESSION rather than the challenge —
   * clickjacking the admin console and leaking the entry ticket through a
   * Referer are not part of anybody's puzzle.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
