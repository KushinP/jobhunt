import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';

export interface Env {
  OAUTH_KV: KVNamespace;
  OAUTH_PROVIDER: OAuthHelpers;
  DB: D1Database;
  JOBHUNT_MCP: DurableObjectNamespace;
  /** Signs the OAuth round-trip state. `wrangler secret put SESSION_SECRET` */
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  /** `wrangler secret put GOOGLE_CLIENT_SECRET` */
  GOOGLE_CLIENT_SECRET: string;
  /** The single Google address allowed to approve a connection. */
  ALLOWED_EMAIL: string;
  /** This instance's dashboard origin, e.g. https://job.example.workers.dev */
  PUBLIC_DASH_URL: string;
  /** This instance's connector origin, e.g. https://mcp.example.workers.dev */
  PUBLIC_MCP_URL: string;
  APIFY_TOKEN?: string;
}

export interface AuthProps extends Record<string, unknown> {
  userId: string;
  displayName: string;
}

export const ok = (data: unknown, summary?: string) => ({
  content: [{
    type: 'text' as const,
    text: (summary ? `${summary}\n\n` : '') + JSON.stringify(data, null, 2),
  }],
});

export const fail = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});
