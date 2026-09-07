import Link from 'next/link';
import { GradientButton } from '@/components/ui/gradient-button';

/**
 * 404 handler. Kept deliberately uninformative about what does exist: it must not
 * confirm or deny the presence of staff routes to a participant probing URLs.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="border-border/80 bg-card/60 w-full max-w-lg space-y-6 rounded-2xl border p-8 font-mono shadow-2xl backdrop-blur-md">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-bold tracking-widest text-amber-400 uppercase">
            <span className="size-2 rounded-full bg-amber-400" aria-hidden="true" />
            <span>SECTOR NOT FOUND // 404</span>
          </div>
          <h1 className="font-sans text-xl font-bold tracking-tight text-white sm:text-2xl">
            This page doesn&apos;t exist
          </h1>
        </div>

        <p className="text-muted-foreground font-sans text-sm leading-relaxed">
          The address you followed doesn&apos;t match anything in the portal. It may have been
          mistyped, or it may be a link from an older briefing. Head back to your dashboard to
          continue.
        </p>

        <div className="border-border/40 flex flex-wrap items-center gap-3 border-t pt-5">
          <Link href="/dashboard">
            <GradientButton variant="cyan" size="sm" className="text-xs font-semibold uppercase">
              Back to dashboard
            </GradientButton>
          </Link>
          <Link href="/login">
            <GradientButton variant="outline" size="sm" className="text-xs font-semibold uppercase">
              Sign in
            </GradientButton>
          </Link>
        </div>
      </div>
    </main>
  );
}
