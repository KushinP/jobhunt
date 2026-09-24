/**
 * Session cookies for the dashboard: an HMAC-signed, HttpOnly, expiring token minted after
 * a successful Google sign-in. No password is stored anywhere; the sign-in itself is
 * handled by Google and restricted to one address.
 */
const COOKIE = 'jh_session';
const TTL_SECONDS = 60 * 60 * 24 * 30;

const enc = new TextEncoder();

async function key(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('SESSION_SECRET is empty on this Worker.');
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
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function mintSession(secret: string): Promise<string> {
  const payload = b64url(enc.encode(JSON.stringify({ exp: Date.now() + TTL_SECONDS * 1000 })));
  const sig = b64url(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(payload)));
  return `${payload}.${sig}`;
}

export async function verifySession(token: string | null, secret: string): Promise<boolean> {
  if (!token || !secret) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return false;
  const valid = await crypto.subtle.verify(
    'HMAC', await key(secret), fromB64url(sig), enc.encode(payload),
  );
  if (!valid) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as { exp: number };
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

export function readCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return v.join('=');
  }
  return null;
}

export function sessionCookie(token: string, secure = true): string {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${TTL_SECONDS}`
    + (secure ? '; Secure' : '');
}

export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}

