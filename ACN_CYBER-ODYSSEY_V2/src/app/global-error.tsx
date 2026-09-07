'use client';

/**
 * Last-resort boundary for errors thrown in the root layout itself, where
 * `app/error.tsx` cannot render. It must supply its own <html>/<body>.
 *
 * Deliberately self-contained: no imported components and no Tailwind classes,
 * because whatever broke may be the stylesheet or the layout tree.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#06080d',
          color: '#e6edf3',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          padding: '1.5rem',
        }}
      >
        <div style={{ maxWidth: '32rem', width: '100%' }}>
          <p
            style={{
              color: '#fb7185',
              fontSize: '0.7rem',
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              fontWeight: 700,
              margin: '0 0 0.5rem',
            }}
          >
            Critical fault // portal shell
          </p>
          <h1 style={{ fontSize: '1.35rem', margin: '0 0 1rem', fontWeight: 700 }}>
            The portal could not load
          </h1>
          <p style={{ color: '#9aa7b4', lineHeight: 1.6, margin: '0 0 1rem' }}>
            A fault occurred before the interface could start. Your account and any work you have
            already submitted are unaffected. Reload to try again, and tell an event marshal if it
            persists.
          </p>
          {error.digest && (
            <p
              style={{
                color: '#67e8f9',
                fontSize: '0.75rem',
                wordBreak: 'break-all',
                margin: '0 0 1.25rem',
              }}
            >
              Reference code: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            style={{
              background: '#0e7490',
              color: '#ffffff',
              border: 'none',
              borderRadius: '0.5rem',
              padding: '0.6rem 1.1rem',
              fontSize: '0.8rem',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
            }}
          >
            Reload portal
          </button>
        </div>
      </body>
    </html>
  );
}
