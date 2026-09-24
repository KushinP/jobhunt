# JobHunt

An automated job search that runs on your own Cloudflare account and your own Claude
subscription. It finds roles, scores them against what you actually want, writes a tailored
resume and cover letter for the ones worth applying to, and tracks what happened. It stops
short of pressing submit, every time.

There is no hosted version and no server-side model key: you deploy it, your Claude account
does the thinking, and the data stays in your Cloudflare account.

## What it does

- **Finds roles** on company job boards (Greenhouse, Lever, Ashby), Y Combinator, LinkedIn,
  Indeed, Built In, ZipRecruiter, Dice, your LinkedIn job-alert emails, and any page you point
  your browser at (Handshake, Wellfound).
- **Scores them in code**, not in a prompt: title, domain, skills, seniority and location,
  with hard filters for a pay floor, cities, industries you rule out and experience you do not
  have. Scoring lives in TypeScript so it cannot drift between runs, and so you can read why a
  role was dropped.
- **Writes the documents** from an *evidence bank*: a reviewed list of things you have
  actually done. Every bullet has to trace to a confirmed item.
- **Prepares interviews** from the exact files you submitted, and records what happened so the
  next brief is better.
- **Keeps the record**: a board, a table of every role seen, documents, run logs and metrics
  on a small dashboard.

## What it will not do

These are enforced by the server, not by asking the model nicely:

- **Never submits an application.** Autofill fills the form and stops at the submit button.
- **Never sends email.** Follow-ups are written as Gmail drafts.
- **Never claims what you have not confirmed.** Documents may only use confirmed evidence, and
  "boundary" items record claims never to make.
- **Applied, Interviewing, Offer and Rejected are yours.** Automation is refused those
  statuses, and Applied additionally requires a record of what was sent.
- **Never stores demographic or EEO answers.** Those fields are left for you, on the form.
- **Never fails silently.** Every run logs what it did, including the runs that stopped early.

## How it fits together

```
Claude (scheduled tasks, or any chat)
      |  MCP
      v
mcp Worker  ──────────────►  D1 database  ◄────────  job Worker (dashboard + API)
 scoring, sources, documents   roles, evidence,        React app you sign into
                               documents, runs
```

- **`mcp`** is the connector Claude talks to: about 55 tools (search, score, evidence,
  documents, interviews, setup). Sign-in is Google OAuth, restricted to one address.
- **`job`** serves the dashboard and its API from the same database.
- **`core`** holds everything worth testing on its own: the scorer, the repository layer, the
  posting readers, the prompt generator.
- **Skills** (`skills/`) are what Claude uses to write a document or read a job page in your
  browser. They are uploaded to your Claude account as zips, which the dashboard serves.
- **Scheduled tasks** (`prompts/`) are generated from your settings by the server, so a change
  of city or platform does not mean rewriting a prompt.

A weekday looks like: **search** (find and score), **sweep** (throw out the obvious
mismatches before they cost a document), **build** (write resume and cover letter for what
survived), and on Mondays a **weekly review** (follow-up drafts, what is stuck, what the
numbers say).

## Running costs

- **Cloudflare**: Workers, D1 and KV, within the free tier for one person's search.
- **Claude**: your existing subscription. Scheduled tasks need one that includes them.
- **Apify** (optional, for LinkedIn, Indeed and Built In): roughly $0.0001 to $0.001 per
  result, so a few dollars a month. Everything else is free.

## Install

You need Node 24 or newer, a Cloudflare account, a Google OAuth client (for sign-in) and a
Claude account.

```bash
git clone <your fork>
cd app
npm install
cp .env.example .env          # add a Cloudflare API token
bash setup-cloudflare.sh      # creates the D1 database and KV namespace, applies migrations
```

Then edit `mcp/wrangler.jsonc` and `dash/wrangler.jsonc` (the script copies them from the
examples): `ALLOWED_EMAIL` is the only address allowed to sign in, and `PUBLIC_DASH_URL` /
`PUBLIC_MCP_URL` are your two worker hostnames. Set the secrets on both workers:

```bash
npx wrangler secret put SESSION_SECRET --config mcp/wrangler.jsonc       # any long random string
npx wrangler secret put GOOGLE_CLIENT_SECRET --config mcp/wrangler.jsonc
npx wrangler secret put APIFY_TOKEN --config mcp/wrangler.jsonc          # optional
# repeat the first two with --config dash/wrangler.jsonc
npm run deploy:mcp && npm run deploy:dash
```

Open the dashboard, sign in, and follow **Setup → Connect Claude**: it adds the connector,
hands you the four skill zips, and creates the scheduled tasks. Then tell Claude "continue my
JobHunt setup" and it walks the 17-step onboarding (`onboarding/ONBOARDING.md`): your resume,
reviewing every claim on it, what you will and will not claim, the roles you want, cities,
pay, platforms, goals and a plan.

## Where the roles come from, and the terms

Be aware of what each source is before turning it on:

- **Company boards, Y Combinator**: public endpoints, read directly. No account needed.
- **LinkedIn, Indeed, Built In**: read through third-party [Apify](https://apify.com) actors.
  Scraping these sites is against their terms of service; you are the one calling them, with
  your own key, and the responsibility is yours.
- **LinkedIn job-alert emails**: read from your own inbox through Claude's Gmail connector.
  Nothing is scraped; alerts you already asked for are parsed.
- **ZipRecruiter, Dice**: through Claude's own connectors for those sites.
- **Handshake, Wellfound, any job page**: read on demand in your own logged-in browser, at
  human pace, only when you ask. Never on a schedule, and never with your credentials typed by
  anything but you.

The server itself fetches postings to read their descriptions (LinkedIn's public job endpoint,
ATS APIs, and the schema.org data most career pages publish). Indeed and ZipRecruiter refuse
servers, and are left to a connector.

## Repo layout

```
core/        scoring, storage, posting readers, prompt generation, tests
mcp/         the Claude connector Worker (tools, OAuth, uploads)
dash/        the dashboard Worker and its React app
migrations/  the database schema, in order
skills/      the four Claude skills, with a profile template
prompts/     the scheduled-task prompts (the server generates these from your config)
onboarding/  the new-user flow and the source catalog
docs/        engineering notes and the placeholder reference
tools/       admin scripts (backfills, uploading the skill zips)
```

## Development

```bash
npm install
node --test core/test/*.test.ts    # 166 tests, no network, real schema in node:sqlite
npx tsc -p . --noEmit              # type-check workers and core
npm run dev:mcp                    # local connector
npm run dev:dash                   # local dashboard API
npm run dev:web                    # the dashboard's React app
```

Tests run the real migrations against an in-memory SQLite database, so a schema change that
breaks a constraint or a trigger fails the suite rather than production.

## Status

Built for one person's search and used daily since September 2026. It is single-user by
design: one allowed address, one profile, one set of documents. Multi-tenancy would mean a
`user_id` on every table and a different sign-in story.

Known gaps and rough edges are in [KNOWN_ISSUES.md](KNOWN_ISSUES.md). Contributions are
welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

MIT. See [LICENSE](LICENSE).
