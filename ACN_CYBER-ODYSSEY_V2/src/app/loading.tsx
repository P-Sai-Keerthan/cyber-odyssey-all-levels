/**
 * Default route-loading state.
 *
 * Every portal page is server-rendered on demand (`cookies()` forces dynamic
 * rendering), so navigation waits on the database. With no loading.tsx the
 * browser simply held the previous screen with no feedback — indistinguishable
 * from a frozen page, which under event pressure prompts participants to hammer
 * refresh and multiply the load.
 */
export default function Loading() {
  return (
    <main
      className="flex min-h-screen items-center justify-center px-4 py-12"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex flex-col items-center gap-4 font-mono">
        <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-cyan-400 uppercase">
          <span className="size-2 animate-pulse rounded-full bg-cyan-400" aria-hidden="true" />
          <span>ESTABLISHING SECURE UPLINK</span>
        </div>

        <div className="flex items-center gap-1.5" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-2.5 animate-bounce rounded-full bg-cyan-500/70"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>

        <p className="text-muted-foreground font-sans text-xs">Loading your terminal…</p>
      </div>
    </main>
  );
}
