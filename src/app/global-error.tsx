'use client';

/**
 * Last-resort boundary: an exception in the root layout is not caught by
 * app/error.tsx. Without this file Next.js shows only the generic
 * "Application error" page with a digest, which is impossible to diagnose from
 * the browser. It must render its own <html>/<body>.
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
          background: '#07070A',
          color: '#E7E7EC',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          padding: '24px',
        }}
      >
        <main style={{ maxWidth: '640px', width: '100%' }}>
          <h1 style={{ fontSize: '22px', margin: '0 0 6px' }}>ROYALWEB failed to start</h1>
          <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#9A9AA8' }}>
            The application shell threw an exception. The full stack trace is in the server log.
          </p>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.09)',
              borderRadius: '12px',
              padding: '12px',
              fontSize: '12px',
              color: '#F6A0A0',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            }}
          >
            {error.message || 'Unknown server error'}
          </pre>
          {error.digest ? (
            <p style={{ fontSize: '11px', color: '#6E6E7C', fontFamily: 'ui-monospace, monospace' }}>
              digest: {error.digest}
            </p>
          ) : null}
          <p style={{ fontSize: '12.5px', color: '#9A9AA8', lineHeight: 1.6 }}>
            Check <code>/api/health?deep=1</code>. The usual causes on a serverless host are a read-only data directory,
            a Node.js runtime below 22.13 (no <code>node:sqlite</code>), or a missing{' '}
            <code>ROYALWEB_ENCRYPTION_KEY</code>.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              border: '1px solid rgba(212,175,55,0.4)',
              background: 'rgba(212,175,55,0.1)',
              color: '#E8C766',
              borderRadius: '12px',
              padding: '10px 16px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
