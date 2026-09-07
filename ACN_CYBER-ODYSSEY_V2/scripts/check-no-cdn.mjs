#!/usr/bin/env node
/**
 * Enforcement of CR-13 / SEC-27: Zero external CDNs / assets.
 */

import { readFileSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import process from 'node:process';

import { scanContent } from './lib/detect-external-refs.mjs';

const ROOT = process.cwd();
const BUILD_DIR = join(ROOT, '.next');
const SOURCE_DIR = join(ROOT, 'src');

const SCANNED_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.css',
  '.html',
  '.json',
  '.ts',
  '.tsx',
]);

/**
 * Test files are excluded from the scan.
 *
 * The check exists to prove that no EXTERNAL asset reference reaches a browser.
 * A test file is not shipped to a browser, and the fixtures belonging to this
 * very detector necessarily contain example external URLs in order to assert
 * that the detector catches them.
 *
 * This matters because `output: 'standalone'` copies `scripts/` into
 * `.next/standalone/`, so `detect-external-refs.test.mjs` — the detector's own
 * test data — was being scanned and reported as a violation. That made
 * `npm run verify` fail unconditionally (build, then check) regardless of the
 * application's actual content.
 *
 * Application source is unaffected: everything under `src/` that is not a test
 * is still scanned, as is every real build artefact.
 */
const TEST_FILE_PATTERN = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Directory names skipped during the scan.
 *
 * `scripts` is excluded for the same reason as test files: `output: 'standalone'`
 * copies the repository's `scripts/` directory into `.next/standalone/scripts/`,
 * and that directory contains this checker itself — including the literal list of
 * blocked CDN hostnames it searches for. Scanning it made the tool report its own
 * blocklist as a violation.
 *
 * Nothing under `scripts/` is ever served to a browser: it is Node-only operational
 * tooling (seeding, migrations, pragmas, load testing). Excluding it does not weaken
 * the guarantee, which is about assets a participant's browser can load.
 */
const SKIPPED_DIRECTORIES = new Set(['cache', 'node_modules', 'scripts']);

async function collectFiles(dir, acc = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return acc;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      await collectFiles(full, acc);
    } else if (SCANNED_EXTENSIONS.has(extname(entry.name)) && !TEST_FILE_PATTERN.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

function scanFile(file) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  return scanContent(content, relative(ROOT, file));
}

async function main() {
  let buildPresent = true;
  try {
    await stat(BUILD_DIR);
  } catch {
    buildPresent = false;
  }

  if (!buildPresent) {
    console.error('Error: .next/ not found. Run `npm run build` before this check.');
    process.exit(1);
  }

  const files = [...(await collectFiles(BUILD_DIR)), ...(await collectFiles(SOURCE_DIR))];
  const findings = files.flatMap(scanFile);

  console.log(`Scanned ${files.length} files in .next/ and src/ for external resource references.`);

  if (findings.length > 0) {
    console.error(`\nFAIL - ${findings.length} external reference(s) found.`);
    for (const f of findings.slice(0, 25)) {
      console.error(`  ${f.file}\n    ${f.kind}\n    ${f.excerpt}\n`);
    }
    process.exit(1);
  }

  console.log('PASS - no external CDN, font, or analytics reference in the shipped output.');
}

main().catch((error) => {
  console.error('check-no-cdn failed to run:', error);
  process.exit(1);
});
