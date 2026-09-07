import * as path from 'path';

/**
 * Roots that server-managed files are permitted to live under, relative to cwd.
 */
export const UPLOAD_ROOTS = {
  submissions: ['uploads', 'submissions'],
  resources: ['uploads', 'resources'],
} as const;

/**
 * Resolves a stored file path and verifies it is contained within `rootSegments`.
 * Returns the absolute path, or null if the path escapes the root.
 *
 * WHY (Phase 17 / SEC-17-03): the previous check was
 *
 *   if (!resolved.startsWith(baseDir) && !resolved.startsWith(process.cwd())) reject
 *
 * which has two defects. The `process.cwd()` alternative made ANY file inside the
 * project directory servable — `.env`, `prisma/dev.db`, source files — the moment
 * a storagePath value was wrong or attacker-influenced. And bare `startsWith` on a
 * string is prefix-matching, not containment: `/app/uploads/submissions-evil/x`
 * passes a `startsWith('/app/uploads/submissions')` test.
 *
 * This implementation compares path segments via `path.relative`, so a sibling
 * directory sharing a name prefix is correctly rejected, and there is no
 * project-root escape hatch. Defence in depth: storagePath is server-generated,
 * so this guards against a database compromise or a future code path that lets
 * a client influence the value — not against normal operation.
 */
export function resolveContainedPath(
  storagePath: string,
  rootSegments: readonly string[],
): string | null {
  if (!storagePath || storagePath.includes('\0')) return null;

  const root = path.resolve(process.cwd(), ...rootSegments);
  const resolved = path.resolve(
    root,
    path.isAbsolute(storagePath) ? storagePath : path.resolve(process.cwd(), storagePath),
  );

  const relative = path.relative(root, resolved);

  // Contained iff the relative path does not climb out and is not absolute.
  // An empty relative path means the target IS the root directory, not a file.
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return resolved;
}
