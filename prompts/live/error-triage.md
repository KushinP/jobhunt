---
title: JobHunt: Error Triage
cron: "CRON_TZ=America/New_York 30 17 * * 1-5"
model: claude-opus-5-5
---

End-of-day JobHunt error triage. Do not ask questions; execute and report at the end. No em dashes anywhere.

Use the **JobHunt** connector and the scheduled-task tools (list_triggers, fire_trigger). If JobHunt is unavailable, stop and say so.

WHY THIS EXISTS. The daily search, sweep and build runs log errors via log_run. Most repeat daily and nobody acts on them. This task sorts today's errors, retries what is safely retryable, tracks what repeats, and hands the person a short list of what only he can fix. It is PROPOSE-ONLY for anything structural.

HARD RULES
- Never change scoring config, exclude terms, preferences, company lists, base resumes, evidence, or plan (no put_config, set_preferences, set_companies, save_base_resume, add_evidence, put_plan).
- Never move a role's status, never build documents, never call ingest_jobs or add_role.
- The only write actions allowed: fetch_jds (retry), fire_trigger (at most once per task per day, see STEP 2), and one log_run at the end.
- Status names: API "Generate" = dashboard "Queued"; "Complete" = "Ready". Use dashboard names in the report.

STEP 1: GATHER
- list_runs limit=60. "Today" = runs whose started_at falls on today's date in America/New_York (started_at is UTC).
- Find the most recent previous triage run: kind "manual" whose summary starts with "Error triage". Its summary holds the running issue list (see STEP 5). If none exists, start fresh.
- list_triggers and find the JobHunt scheduled tasks (names starting "JobHunt:", excluding this one). For each that was due today (Daily Search 10:30, Daily Sweep 14:00, Build Documents 14:45 ET, weekdays; Weekly Review Fri 18:00 ignored here), check last_run status and fired_at.

STEP 2: SILENT FAILURES
A scheduled run that FAILED, or fired today but logged no run of its kind (search for Daily Search, build_docs for Build Documents, manual "Daily sweep" for Daily Sweep), is a silent failure: the worst kind, because nothing shows on the dashboard. For each: if it has not already been re-fired today, fire_trigger it ONCE with text "Re-fired by Error Triage after a failed/unlogged run." Never re-fire a task that succeeded and logged normally. Record what you did.

STEP 3: CLASSIFY every error string from today's runs, plus each sources_unavailable entry, into exactly one bucket:
- TRANSIENT: rate limits (fetch_jds rate_limited, Indeed connector throttled), proxy drops, "service unavailable", upload/sha256 mismatches that were resolved in-run.
- INFRA: things no session can fix: a connector missing from the session (e.g. Dice), robots.txt blocks, URL-too-long fetcher limits, JS-rendered career pages, OAuth failures.
- BUG: JobHunt server or config logic producing wrong results: exclude terms that miss variants, senior titles scoring into New, dedupe failures on company-name variants, tools missing from the connector, save_document integrity failures that recur across runs, list limits truncating.
- HUMAN: needs the person's own decision or content: base-resume claims outside the evidence bank or violating boundaries, a role they set themselves, account/login steps.
Normalize each to a short stable key (e.g. "dice-connector-missing", "fetch_jds-rate-limit", "exclude-commission-variants") so the same issue matches across days. Errors already self-corrected in the same run with no lingering effect go under TRANSIENT with note "resolved in-run" and need no action.

STEP 4: RETRY TRANSIENT
- If any run today hit a fetch_jds rate limit or left roles needing JDs: list_pipeline missing_jd=true status=Generate, then call fetch_jds limit=10. Continue while remaining > 0, up to 3 calls total. Stop immediately on rate_limited. Report JDs attached and roles still waiting.
- Do not retry document builds: roles left Queued are picked up by tomorrow's build automatically. Just count them.

STEP 5: RECURRENCE
Merge today's keys with the previous triage's issue list. For each key keep: bucket, first_seen date, days_seen count, last_seen date, status (open / quiet). A key not seen for 5 weekdays becomes quiet and drops off after 10. Any BUG or INFRA key with days_seen >= 3 is ESCALATED.

STEP 6: PROPOSE FIXES (text only, never apply)
For each BUG key that is new or escalated, write a concrete proposed fix: what is wrong, one example from the logs, and the specific change (e.g. "add exclude terms 'commission-based', 'commission based', '100% commission'"; "normalize company names by stripping trailing parenthetical locations before title+company dedupe"). For INFRA, name the one change that would remove it (e.g. "add the Dice connector to the Daily Search scheduled task's connections") or say "accept, no fix".

STEP 7: LOG AND REPORT
Call log_run once: kind "manual", found = number of distinct error keys today, kept = 0, errors = [] (do not re-log the errors), sources_used = [], summary starting exactly "Error triage YYYY-MM-DD:" followed by:
1. One line: runs checked, silent failures and re-fires, JDs retried.
2. "ISSUES:" then one line per open key in the form `key | bucket | first_seen | days_seen | last_seen | open/quiet | ESCALATED?` (this is tomorrow's state, keep it machine-readable).
3. "PROPOSED FIXES:" the STEP 6 items.
4. "FOR YOU:" HUMAN items only.

Final message (this is what reaches the person's phone):
- If there were no silent failures, no new keys, no escalations and no HUMAN items: reply exactly "JobHunt triage: clean." and nothing else.
- Otherwise, at most 12 bullets, most urgent first: silent failures and re-fires, escalated issues with the proposed fix, new BUGs, HUMAN items, then one line on transient retries. Lead with outcomes, no filler.
