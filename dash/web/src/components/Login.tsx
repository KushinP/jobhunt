export function Login() {
  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-panel p-7 text-center">
        <h1 className="text-xl font-semibold tracking-tight">JobHunt</h1>
        <p className="mt-1 mb-6 text-sm text-muted">
          One account can sign in here. Everything else is refused.
        </p>
        <a
          href="/api/auth/start"
          className="flex items-center justify-center gap-2.5 rounded-lg border border-line
                     bg-bg px-3 py-2.5 font-medium transition hover:border-accent"
        >
          <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z" />
            <path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z" />
          </svg>
          Sign in with Google
        </a>
        <p className="mt-4 text-xs text-muted">
          No password to remember, and nothing about your job search is public.
        </p>
      </div>
    </div>
  );
}
