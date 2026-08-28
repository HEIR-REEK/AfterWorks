'use client'

/**
 * Last-resort boundary for failures in the root layout itself (providers, fonts, metadata).
 *
 * It has to render its own `<html>`/`<body>` because the root layout is what failed, and it must not
 * import the app's providers — which is why this looks plainer than `app/error.tsx` on purpose.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b0f14',
          color: '#e6edf5',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <main style={{ maxWidth: '34rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>
            AfterWorks could not start
          </h1>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.6, color: '#96a3b5' }}>
            The application shell failed to render. Your account, earnings and submitted work are
            unaffected. Reloading usually clears it.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: '1.25rem',
              padding: '0.55rem 1rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: '#0b0f14',
              background: '#e6edf5',
              border: 'none',
              borderRadius: '0.75rem',
              cursor: 'pointer',
            }}
          >
            Reload the app
          </button>
          {error?.digest ? (
            <p style={{ marginTop: '1rem', fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: '#5d6b7d' }}>
              ref {error.digest.slice(0, 24)}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  )
}
