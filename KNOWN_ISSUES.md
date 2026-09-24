# Known issues

Honest list of what is rough, as of the first public release. Each one is a real thing a new
user will hit, not a hypothetical.

## 1. Two sets of scheduled prompts, and they disagree

`core/src/tasks.ts` generates the four scheduled tasks from your config, and that is the
source of truth. `prompts/` holds two snapshots taken from a running instance:
`prompts/canonical/` (what the server generated) and `prompts/live/` (hand-tuned in the task
scheduler, ahead of the server). The live set adds a fifth task, **error triage**, that the
server does not generate at all, plus a senior-title pre-filter, paging past 100 rows in the
sweep, and a stale-posting cleanup.

Nothing reads the snapshots at runtime; they are there so the improvements are not lost. Fold
them into the generator, then delete them.

## 2. The sweep's agency blocklist is hard-coded

The list of staffing agencies whose unnamed-client postings get skipped is written into the
sweep prompt in `core/src/tasks.ts`. It belongs in config, next to the other exclusion lists,
so it can be edited without a deploy.

## 3. The document skills and the config disagree on how to build a .docx

`config-examples/config.example.json` has an `output_rules.build_method` that says: edit a copy
of the base .docx in place and keep its fonts and tables. The resume and cover-letter skills
still describe building a document from scratch with the `docx` package in Calibri. The
in-place edit is what produced acceptable output. Worse, `build_method` is not in the `Config`
type at all (`core/src/types.ts`), so the server never renders it into a prompt: it only
reaches Claude if it happens to be in the config JSON. Pick the in-place edit, put it in the
type, and fix both skills.

## 4. The skills carry references to a single machine

`skills/tailored-resume` and `skills/tailored-cover-letter` still mention `~/jobhunt/` folders,
a Supabase mirror and a `jobhunt sync-config` command from an earlier version. The cloud-install
header overrides them, but they mislead anyone reading the skill.

## 5. Deduplication is by title and company

`normalizeKey()` treats "the same title at the same company" as one role, so the same job
posted in two cities collapses into one row, and a genuinely different role with an identical
title is hidden. Sources return a stable `source_job_id`; the key should prefer it.

## 6. There is no way to exclude a company

Industries, titles, terms and a pay floor all filter. A company you never want to hear from
again does not: you can mark it "avoid" in the dashboard, which only hides it from lists. An
`exclude_companies` config key should drop its postings on arrival.

## 7. Documents live in the database

A built .docx is a BLOB in D1 (about 30 KB each). Fine for one person's search, and it keeps
setup to one resource, but there is a ceiling. R2 would be the answer if a deployment ever
holds thousands.

## 8. LinkedIn rate-limits the server

`fetch_jds` reads LinkedIn's public job endpoint to fill in missing descriptions. From
Cloudflare's network, requests close together get 429s. It paces itself (about one every three
seconds), retries twice, then leaves the rest for the next run. A big backlog takes a few runs
to clear.

## 9. Single user by design

One allowed sign-in address, one profile, one evidence bank, one set of documents.
Multi-tenancy means a `user_id` on every table, a different dedupe index, and real
authentication. Not started.

## 10. Indeed and ZipRecruiter cannot be read by the server

Both answer 403 to a server fetch, so roles from them arrive without a description and wait for
a connector or your browser to fill one in. The daily search has a fallback through Claude's
Indeed connector; it finds some, not all.
