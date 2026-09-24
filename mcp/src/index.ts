import {
  AuthorizationError, OAuthProvider, type AuthRequest,
} from '@cloudflare/workers-oauth-provider';
import {
  checkClaims, exchangeGoogleCode, googleAuthUrl, signState, verifyState, finishUpload, UploadError,
} from '@jobhunt/core';
import { JobHuntMCP } from './agent.ts';
import type { Env } from './env.ts';

export { JobHuntMCP };

const SCOPE = 'jobhunt';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function page(body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>JobHunt</title><link rel="icon" href="/favicon.svg" type="image/svg+xml"><style>
:root{color-scheme:light dark;--bg:#fbfaf9;--fg:#1c1b19;--mut:#6b6864;--line:#e4e1dc;--accent:#1f4e79;--risk:#b3261e}
@media(prefers-color-scheme:dark){:root{--bg:#191817;--fg:#eceae7;--mut:#9a958f;--line:#312f2c;--accent:#7fb2e5;--risk:#e8837c}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);
font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:16px}
.card{width:100%;max-width:26rem;border:1px solid var(--line);border-radius:14px;padding:1.75rem}
h1{margin:0 0 .35rem;font-size:1.2rem;letter-spacing:-.01em}
p{margin:.25rem 0 1.25rem;color:var(--mut);font-size:.9rem}
.err{color:var(--risk)}
a.btn{display:flex;align-items:center;justify-content:center;gap:.6rem;padding:.7rem;
border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--fg);
text-decoration:none;font-weight:600}
a.btn:hover{border-color:var(--accent)}
ul{margin:.5rem 0 1.25rem;padding-left:1.1rem;color:var(--mut);font-size:.85rem}
li{margin:.2rem 0}
.meta{margin-top:1.25rem;padding-top:1rem;border-top:1px solid var(--line);font-size:.78rem;color:var(--mut)}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem}
</style></head><body><div class="card">${body}</div></body></html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

const GOOGLE_MARK = `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"/>
<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18Z"/>
<path fill="#FBBC05" d="M3.97 10.72a5.41 5.41 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34Z"/>
<path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58Z"/></svg>`;

// The dashboard's briefcase icon, so the connector shows the same icon in Claude's list.
// Kept in sync with dash/web/public/favicon.{svg,ico}.
const FAVICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"> <rect width="64" height="64" rx="14" fill="#1f4e79"/> <rect x="23.5" y="13.5" width="17" height="14" rx="3.5" fill="none" stroke="#fff" stroke-width="5"/> <rect x="11" y="22" width="42" height="29" rx="5" fill="#fff"/> <rect x="11" y="33" width="42" height="3.5" fill="#1f4e79"/> <rect x="28.5" y="30.5" width="7" height="8.5" rx="1.5" fill="#fff" stroke="#1f4e79" stroke-width="2"/> </svg>';
const FAVICON_ICO = 'AAABAAIAICAAAAEAIACXAQAAJgAAABAQAAABACAAGQEAAL0BAACJUE5HDQoaCgAAAA1JSERSAAAAIAAAACAIBgAAAHN6evQAAAFeSURBVHjaY2BAAvJ+lTJA3A7EZ4H4P5XxWajZMgzYAFAiBog/0sBidAyyIwab5f/pjGOQg/3jADjgIzg6oPHyf4BwOwOpCS65ZdH//mV7sGKQHKkJk4EUDQfP3fpPCIDUkGImAyk+JxaQEhJEOwAUxDCgGlyLIQ8SgwGQWpo6AJea4eUAkCGfv/74TykAmYHPQVgdEFs/7z+1AchMoh2AHNzUArhCgWwHPHv94f+WI5fAGMSmqwNAFmpHNIDzOwiD2IQcQZIDwqtm4SxuQTircxlKwQRig8Tw6QGZSVE2RMcgC2EAxCbXHAZchsPiFxvuXLTjf2DpdLgDQGyQGD49uBxJVhoA5W2LpA64ehCbUJlB9Vww4NlweDugee5WqjsAZCbRDjCKbfn/5sMXqlkOMgtkJknlAEgDyNX4ChdiMMgMXJbDHHB2AFvFZwdFs3xgOyYD3jUbFJ3TgeyeAwA/iLq2LwF/PQAAAABJRU5ErkJggolQTkcNChoKAAAADUlIRFIAAAAQAAAAEAgGAAAAH/P/YQAAAOBJREFUeNpjYAACeb/KGCC+A8T/icQgtTEMSJr/k4ljGHDZHFg6/X9W5zIwBrFxuYQBm0T/sj3/0QFIDJtarAZcvvsURQOIDRIjaEDZ5LVgxW8+fPl//PI9MBuEQWyQGIgNUoPVAO+Cyf+JBSC1GAaAAgsZ/Pz1+3/noh1gDGIjA5BaDAO0Ixr+u+T0w7Fdes//LUcugTGIjSwHUothQGz9vP+3Hr2EY5C/YdEIYiPLgdQS9AI+gNUL4VWziDYApBbDANXg2v+Lth5HcSo2DFIDUotswB0K8sIdyjMTpdkZAIbPcqXq5pNOAAAAAElFTkSuQmCC';

const defaultHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);

    // A built document, sent straight from Claude's sandbox with curl to the single-use link
    // start_document_upload handed out. The link is the credential: one file, one role, once.
    const up = url.pathname.match(/^\/upload\/([0-9a-f]{48})$/);
    if (up) {
      if (request.method !== 'PUT' && request.method !== 'POST') {
        return Response.json({ ok: false, error: 'send the file with PUT: curl -X PUT --data-binary @FILE <this url>' }, { status: 405 });
      }
      const len = Number(request.headers.get('content-length') ?? 0);
      if (len > 5_000_000) return Response.json({ ok: false, error: 'the file is over 5 MB' }, { status: 413 });
      try {
        const saved = await finishUpload(env.DB, up[1], new Uint8Array(await request.arrayBuffer()), env.PUBLIC_DASH_URL);
        return Response.json({ ok: true, ...saved });
      } catch (e) {
        const status = e instanceof UploadError ? e.status : 500;
        return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status });
      }
    }

    if (url.pathname === '/favicon.svg') {
      return new Response(FAVICON_SVG, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
    }
    if (url.pathname === '/favicon.ico') {
      const bytes = Uint8Array.from(atob(FAVICON_ICO), (c) => c.charCodeAt(0));
      return new Response(bytes, { headers: { 'content-type': 'image/x-icon', 'cache-control': 'public, max-age=86400' } });
    }

    if (url.pathname === '/') {
      return page(`<h1>JobHunt connector</h1>
        <p>The Claude connector for one person's job search pipeline.</p>
        <div class="meta">To connect: in claude.ai, Settings, Connectors, <b>Add custom connector</b>,
        with the address <code>${url.origin}/mcp</code>. Approval is one Google sign-in.<br><br>
        The rest of setup (skills, platform connectors, the scheduled tasks) is on the dashboard:
        ${env.PUBLIC_DASH_URL
          ? `<a href="${env.PUBLIC_DASH_URL}">${env.PUBLIC_DASH_URL.replace(/^https?:\/\//, '')}</a>`
          : 'set PUBLIC_DASH_URL to link it here'}, Setup, Connect Claude.</div>`);
    }

    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return page('<h1>Not configured</h1><p class="err">GOOGLE_CLIENT_ID and '
        + 'GOOGLE_CLIENT_SECRET are not set on this Worker.</p>', 503);
    }

    // Step 1: a client asks for authorization. Show what it wants, then hand off to Google.
    if (url.pathname === '/authorize') {
      let oauthRequest: AuthRequest;
      try {
        oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      } catch (error) {
        if (!(error instanceof AuthorizationError)) throw error;
        if (!error.redirectUri) {
          return page(`<h1>Cannot authorize</h1><p class="err">${escapeHtml(error.description)}</p>`, 400);
        }
        const redirect = new URL(error.redirectUri);
        redirect.searchParams.set('error', error.code);
        redirect.searchParams.set('error_description', error.description);
        if (error.state) redirect.searchParams.set('state', error.state);
        return Response.redirect(redirect.toString(), 302);
      }

      const client = await env.OAUTH_PROVIDER.lookupClient(oauthRequest.clientId);
      if (!client) {
        return page('<h1>Unknown client</h1><p class="err">This OAuth client is not registered.</p>', 400);
      }

      // The original request is signed into the state so it survives the Google round
      // trip without being stored anywhere or trusted from the query string on return.
      const state = await signState(env.SESSION_SECRET, { qs: url.search.replace(/^\?/, '') });
      const href = googleAuthUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: `${url.origin}/authorize/callback`,
        state,
        loginHint: env.ALLOWED_EMAIL,
      });

      return page(`<h1>Connect to JobHunt</h1>
        <p><strong>${escapeHtml(client.clientName || oauthRequest.clientId)}</strong> is asking
        to read and write your job pipeline. It will be able to:</p>
        <ul>
          <li>search job boards and add roles</li>
          <li>read and score roles, and build application documents</li>
          <li>record interviews and debrief lessons</li>
        </ul>
        <a class="btn" href="${escapeHtml(href)}">${GOOGLE_MARK} Continue with Google</a>
        <div class="meta">It cannot mark anything Applied, Interviewing, Offer or Rejected;
        those stay yours. It never submits an application.</div>`);
    }

    // Step 2: back from Google. Verify, then complete the original OAuth request.
    if (url.pathname === '/authorize/callback') {
      const err = url.searchParams.get('error');
      if (err) return page(`<h1>Sign-in failed</h1><p class="err">${escapeHtml(err)}</p>`, 401);

      const state = await verifyState<{ qs?: string }>(
        env.SESSION_SECRET, url.searchParams.get('state'));
      if (!state?.qs) {
        return page('<h1>Sign-in expired</h1><p class="err">Start the connection again from '
          + 'your MCP client.</p>', 401);
      }

      const code = url.searchParams.get('code');
      if (!code) return page('<h1>Sign-in failed</h1><p class="err">No authorization code.</p>', 401);

      const exchanged = await exchangeGoogleCode({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        code,
        redirectUri: `${url.origin}/authorize/callback`,
      });
      if ('error' in exchanged) {
        return page(`<h1>Sign-in failed</h1><p class="err">${escapeHtml(exchanged.error)}</p>`, 401);
      }

      const verdict = checkClaims(exchanged.claims, env.GOOGLE_CLIENT_ID, env.ALLOWED_EMAIL);
      if (!verdict.ok) {
        return page(`<h1>Not allowed</h1><p class="err">${escapeHtml(verdict.reason)}</p>`, 403);
      }

      let oauthRequest: AuthRequest;
      try {
        oauthRequest = await env.OAUTH_PROVIDER.parseAuthRequest(
          new Request(`${url.origin}/authorize?${state.qs}`));
      } catch {
        return page('<h1>Cannot authorize</h1><p class="err">The original request is no '
          + 'longer valid. Start again from your MCP client.</p>', 400);
      }

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: oauthRequest,
        userId: verdict.email,
        metadata: { email: verdict.email },
        scope: oauthRequest.scope.length ? oauthRequest.scope : [SCOPE],
        props: { userId: verdict.email, displayName: verdict.email },
      });
      return Response.redirect(redirectTo, 302);
    }

    return new Response('Not found', { status: 404 });
  },
};

export default new OAuthProvider({
  apiRoute: '/mcp',
  apiHandler: JobHuntMCP.serve('/mcp', { binding: 'JOBHUNT_MCP' }) as never,
  defaultHandler: defaultHandler as never,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/token',
  clientRegistrationEndpoint: '/register',
  scopesSupported: [SCOPE],
});
