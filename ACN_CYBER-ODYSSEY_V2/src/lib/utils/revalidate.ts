import { revalidatePath } from 'next/cache';

/**
 * Revalidates one or more routes without ever failing the caller.
 *
 * WHY (Phase 17 / BUG-17-04): cache revalidation runs AFTER the database
 * transaction has committed. If `revalidatePath` throws — it does so whenever it
 * is reached outside a Next.js request scope, and can also fail transiently —
 * the surrounding try/catch turns an operation that genuinely SUCCEEDED into an
 * error response. The participant then sees "submission failed", retries, and
 * hits the duplicate-submission guard on a submission that was already saved.
 *
 * A failed cache invalidation is a staleness problem, never a correctness one:
 * the worst outcome is that a page serves slightly old data until the next
 * navigation. It must not be reported as a failed write.
 */
export function safeRevalidate(...paths: string[]): void {
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch {
      // Outside a request scope (unit tests, background jobs) or a transient
      // cache error. Intentionally swallowed — see the note above.
    }
  }
}
