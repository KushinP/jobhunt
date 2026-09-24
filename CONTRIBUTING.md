# Contributing

This started as one person's job search and became a system. If it is useful to you, changes
are welcome.

## Before a pull request

```bash
node --test core/test/*.test.ts     # must pass, no network needed
npx tsc -p . --noEmit               # workers and core
cd dash/web && npx tsc --noEmit -p . # the dashboard app
```

Tests apply the real migrations to an in-memory SQLite database, so schema changes are covered
by the same run.

## What the tests are for

They pin behaviour that would otherwise drift and quietly cost someone an application:

- the scorer's hard filters and the reasons it gives for dropping a role
- automation never writing Applied, Interviewing, Offer or Rejected
- Applied requiring a record of what was sent
- documents only being built from confirmed evidence
- the generated scheduled prompts naming only the sources that are turned on

If you change any of those, change the test in the same commit and say why in the message.

## House rules for the code

- **Scoring belongs in code, not in prompts.** A rule in a prompt is a rule that drifts.
- **The server enforces, the prompt explains.** Anything that must not happen is refused by
  the server, whatever a prompt says.
- **Comments say why, not what.** The code already says what.
- **Write for the person who has to read the failure at 7am**: error messages should say what
  to do next, not just what went wrong.

## Things worth doing

[KNOWN_ISSUES.md](KNOWN_ISSUES.md) is the list, roughly in order of how much they cost a user.
Issue 1 (one prompt template set) and issue 5 (dedupe by `source_job_id`) are the two with the
widest effect.

## Reporting a problem

Say what you expected, what happened, and which run it was (the dashboard's Runs tab shows the
log for each scheduled task, including the errors). Please do not paste a run log without
reading it first: they contain your roles, your pay expectations and sometimes your email.
