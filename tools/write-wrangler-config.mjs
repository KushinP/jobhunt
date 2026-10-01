#!/usr/bin/env node
/**
 * Writes mcp/wrangler.jsonc or dash/wrangler.jsonc from its example, for builds that run from
 * the repository (Cloudflare Workers Builds), where the filled-in config does not exist because
 * it is gitignored. The values come from build variables, so your IDs and allowed address stay
 * out of the public repo.
 *
 *   node tools/write-wrangler-config.mjs mcp|dash
 *
 * Build variables (Workers & Pages > the Worker > Settings > Builds > Variables):
 *   JOBHUNT_D1_ID            the jobhunt D1 database id
 *   JOBHUNT_KV_ID            the OAuth KV namespace id (mcp only)
 *   JOBHUNT_GOOGLE_CLIENT_ID the Google OAuth client id
 *   JOBHUNT_ALLOWED_EMAIL    the one address allowed to sign in
 *   JOBHUNT_SUBDOMAIN        your workers.dev subdomain (job.<this>.workers.dev)
 *
 * A config that already exists is left alone, so a local checkout keeps its own.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const target = process.argv[2];
if (target !== 'mcp' && target !== 'dash') {
  console.error('usage: node tools/write-wrangler-config.mjs mcp|dash');
  process.exit(2);
}
const dir = join(dirname(fileURLToPath(import.meta.url)), '..', target);
const out = join(dir, 'wrangler.jsonc');
if (existsSync(out)) {
  console.log(`${target}/wrangler.jsonc exists; leaving it alone`);
  process.exit(0);
}

const need = ['JOBHUNT_D1_ID', 'JOBHUNT_GOOGLE_CLIENT_ID', 'JOBHUNT_ALLOWED_EMAIL', 'JOBHUNT_SUBDOMAIN',
  ...(target === 'mcp' ? ['JOBHUNT_KV_ID'] : [])];
const missing = need.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.error(`missing build variables: ${missing.join(', ')}`);
  process.exit(1);
}
const v = (k) => process.env[k].trim();

const text = readFileSync(join(dir, 'wrangler.example.jsonc'), 'utf8')
  .replaceAll('YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com', v('JOBHUNT_GOOGLE_CLIENT_ID'))
  .replaceAll('you@example.com', v('JOBHUNT_ALLOWED_EMAIL'))
  .replaceAll('YOUR-SUBDOMAIN', v('JOBHUNT_SUBDOMAIN'))
  .replaceAll('YOUR_D1_DATABASE_ID', v('JOBHUNT_D1_ID'))
  .replaceAll('YOUR_KV_NAMESPACE_ID', process.env.JOBHUNT_KV_ID?.trim() ?? 'YOUR_KV_NAMESPACE_ID');

// A placeholder that survived would deploy a Worker bound to nothing.
const left = text.split('\n').filter((l) => !l.trim().startsWith('//') && /YOUR[_-]|you@example\.com/.test(l));
if (left.length) {
  console.error(`placeholders left in ${target}/wrangler.jsonc:\n${left.join('\n')}`);
  process.exit(1);
}
writeFileSync(out, text);
console.log(`wrote ${target}/wrangler.jsonc`);
