/**
 * Google sign-in, restricted to a single allowlisted address.
 *
 * Used by both Workers so there is one sign-in for the dashboard and for approving the
 * MCP connection. No password is stored anywhere; the only durable secrets are the Google
 * client secret and the HMAC key that signs the OAuth state and the session cookie.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const STATE_TTL_MS = 10 * 60 * 1000;

const enc = new TextEncoder();

async function hmacKey(secret: string): Promise<CryptoKey> {
  if (!secret) {
    throw new Error(
      'SESSION_SECRET is empty on this Worker. Set it with: '
      + 'wrangler secret put SESSION_SECRET',
    );
  }
  return crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'],
  );
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
}

/** Signed, expiring, stateless round-trip data. Nothing is stored server side. */
export async function signState(secret: string, data: Record<string, unknown>): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ ...data, exp: Date.now() + STATE_TTL_MS })));
  const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${sig}`;
}

export async function verifyState<T = Record<string, unknown>>(
  secret: string, token: string | null,
): Promise<T | null> {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const valid = await crypto.subtle.verify(
    'HMAC', await hmacKey(secret), fromB64url(sig), enc.encode(payload),
  );
  if (!valid) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { exp?: number };
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    return data as T;
  } catch {
    return null;
  }
}

export function googleAuthUrl(opts: {
  clientId: string; redirectUri: string; state: string; loginHint?: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', opts.state);
  // Always show the chooser: this account is single-user, and a silently reused Google
  // session makes a wrong-account sign-in confusing to diagnose.
  url.searchParams.set('prompt', 'select_account');
  if (opts.loginHint) url.searchParams.set('login_hint', opts.loginHint);
  return url.toString();
}

export interface IdTokenClaims {
  iss?: string; aud?: string; exp?: number; email?: string;
  email_verified?: boolean | string; sub?: string;
}

/**
 * Exchanges the authorization code and returns the id_token claims.
 *
 * The token comes straight from Google's token endpoint over TLS with our client secret,
 * so the channel itself authenticates it; per Google's own guidance signature
 * verification is unnecessary for tokens received this way. The claims are still checked
 * below, which is what actually matters here.
 */
export async function exchangeGoogleCode(opts: {
  clientId: string; clientSecret: string; code: string; redirectUri: string;
}): Promise<{ claims: IdTokenClaims } | { error: string }> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) return { error: `google token exchange failed: ${res.status} ${await res.text()}` };

  const body = await res.json() as { id_token?: string };
  if (!body.id_token) return { error: 'google returned no id_token' };

  const parts = body.id_token.split('.');
  if (parts.length !== 3) return { error: 'malformed id_token' };
  try {
    return { claims: JSON.parse(new TextDecoder().decode(fromB64url(parts[1]))) as IdTokenClaims };
  } catch {
    return { error: 'could not read id_token claims' };
  }
}

/** The allowlist check. One address gets in; everything else is refused by name. */
export function checkClaims(
  claims: IdTokenClaims, clientId: string, allowedEmail: string,
): { ok: true; email: string } | { ok: false; reason: string } {
  if (!claims.iss || !ISSUERS.includes(claims.iss)) {
    return { ok: false, reason: 'unexpected token issuer' };
  }
  if (claims.aud !== clientId) return { ok: false, reason: 'token was issued for another app' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < Date.now()) {
    return { ok: false, reason: 'token has expired' };
  }
  const verified = claims.email_verified === true || claims.email_verified === 'true';
  if (!verified) return { ok: false, reason: 'that Google address is not verified' };

  const email = (claims.email ?? '').toLowerCase();
  if (!email || email !== allowedEmail.toLowerCase()) {
    return { ok: false, reason: `${claims.email ?? 'that account'} is not the allowed account` };
  }
  return { ok: true, email };
}
