# Deploying on every push (Cloudflare Workers Builds)

Both Workers deploy from GitHub when `main` changes, so merging a pull request is the deploy.
The filled-in `wrangler.jsonc` files are gitignored, so the build writes them from the examples
with `tools/write-wrangler-config.mjs`, using build variables you set once in Cloudflare.

## One-time setup, for each Worker (`mcp`, then `job`)

Workers & Pages > the Worker > Settings > Builds > Connect, choose GitHub and this repository.

| Setting | `mcp` | `job` (dashboard) |
|---|---|---|
| Branch | `main` | `main` |
| Root directory | `/` | `/` |
| Build command | `npm ci && npm run ci:build:mcp` | `npm ci && npm run ci:build:dash` |
| Deploy command | `npx wrangler deploy --config mcp/wrangler.jsonc` | `npx wrangler deploy --config dash/wrangler.jsonc` |
| API token | the generated one | the generated one |

Build variables (the same on both; `JOBHUNT_KV_ID` is only read by `mcp`):

| Variable | Value |
|---|---|
| `JOBHUNT_D1_ID` | the `jobhunt` D1 database id |
| `JOBHUNT_KV_ID` | the `jobhunt-oauth` KV namespace id |
| `JOBHUNT_GOOGLE_CLIENT_ID` | your Google OAuth client id |
| `JOBHUNT_ALLOWED_EMAIL` | the one address allowed to sign in |
| `JOBHUNT_SUBDOMAIN` | your workers.dev subdomain |

Runtime secrets (`SESSION_SECRET`, `GOOGLE_CLIENT_SECRET`, `APIFY_TOKEN`) are not build
variables. They stay on each Worker under Settings > Variables & Secrets and survive deploys.

## Migrations are not part of the build

The generated build token is only guaranteed to deploy Workers, not to write to D1, so
`wrangler d1 migrations apply` is left out of the deploy command. Apply a new migration before
merging the code that needs it: `npm run db:migrate:remote` locally, or run its SQL against the
database and record it in `d1_migrations` by file name. Migrations here are additive, so the code
already running is unaffected by one applied early.
