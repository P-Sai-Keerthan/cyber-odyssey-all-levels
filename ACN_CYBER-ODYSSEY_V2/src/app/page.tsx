import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="space-y-4">
        <h1 className="text-foreground font-mono text-2xl font-bold tracking-wider uppercase">
          ACN Cyber Odyssey
        </h1>
        <p className="text-muted-foreground text-sm">Access the digital investigation workspace.</p>
        <div className="pt-2">
          <Link
            href="/login"
            className="text-cyan-accent text-sm font-semibold underline underline-offset-4 hover:text-cyan-300"
          >
            Enter Portal →
          </Link>
        </div>
      </div>
    </main>
  );
}
