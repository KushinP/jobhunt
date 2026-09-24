/**
 * A D1Like over Cloudflare's D1 HTTP API, so admin scripts can run the core library's own
 * functions (and their validation) against the production database, instead of hand-written
 * SQL that would bypass it. Reads CLOUDFLARE_API_TOKEN from the environment.
 */
import type { D1Like, D1Statement } from '../core/src/repo.ts';

// Both are printed by `wrangler d1 info jobhunt`, and live in .env beside the API token.
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const DATABASE = process.env.D1_DATABASE_ID;

async function query(sql: string, params: unknown[]) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is not set');
  if (!ACCOUNT || !DATABASE) throw new Error('CLOUDFLARE_ACCOUNT_ID and D1_DATABASE_ID must be set (see .env.example)');
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ sql, params: params.map((p) => (p === undefined ? null : p)) }),
    },
  );
  const body = await res.json() as {
    success: boolean; errors?: { message: string }[];
    result?: { results: Record<string, unknown>[]; meta: { changes?: number } }[];
  };
  if (!body.success) throw new Error(body.errors?.map((e) => e.message).join('; ') ?? 'D1 query failed');
  return body.result![0];
}

export const d1: D1Like = {
  prepare(sql: string) {
    const make = (params: unknown[]): D1Statement => ({
      async run() { const r = await query(sql, params); return { meta: r.meta }; },
      async all<T>() { return { results: (await query(sql, params)).results as T[] }; },
      async first<T>() { return ((await query(sql, params)).results[0] ?? null) as T | null; },
    });
    return { ...make([]), bind: (...values: unknown[]) => make(values) };
  },
};
