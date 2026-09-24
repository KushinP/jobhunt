---
title: JobHunt: Weekly Review
cron: "CRON_TZ=America/New_York 0 18 * * 5"
model: claude-opus-5-5
---

Weekly JobHunt review. Do not ask any questions; execute and report at the end.

Use the **JobHunt** connector. If it is unavailable, stop and say so.

STATUS NAMES. The dashboard and the API name two statuses differently: the dashboard's "Queued" column is status "Generate" in the API, and "Ready" is status "Complete". In tool calls (`list_pipeline`, `set_status`) always pass the API value; in notes and in the report always use the dashboard name (Queued, Ready). Tool results that say "Generate" mean Queued.

STEP 1. `get_followups`. For each application quiet past the no-response window, draft a short follow-up as a **Gmail draft only**, never sent, using the Gmail connector (the personal Gmail account). If Gmail is not connected, list the follow-ups instead. Six sentences maximum. Then `complete_followup` with the draft id.
STEP 2. `get_metrics` and `list_goals`. Report applications this week against the goal, referral asks against the outreach goal, responses and interviews, which sources convert, and whether the score bands show a real gradient. If they are flat, say the weights are not predicting anything.
STEP 3. `get_plan`, then report applications and interviews by plan track (as the plan names them). Apply the plan's week-4 decision rule when it is due.
STEP 4. `list_pipeline` status "Complete" (the Ready column): anything built over four days ago and not sent is the real bottleneck. List those, oldest first.
STEP 5. `list_pipeline` status New (limit 200), then again with `missing_jd` true, and report both counts. Judge the threshold only on New roles that HAVE a JD: more than 15 of those suggests the auto-queue threshold (config `thresholds.auto_generate`) is too high. Roles without a JD are a fetch backlog, not a threshold signal; report that number separately, with how many come from ZipRecruiter and Indeed.

STEP 6. RETUNE THE SCORER. Two knobs, with different evidence bars. Read `get_config` first.

6a. Threshold (`thresholds.auto_generate`). Retune this every week; it needs no outcome data. From the New-with-JD roles in Step 5, take the score distribution and set `auto_generate` so that roughly 20 to 30 roles sit at or above it, which is about a week of supply at the 8-applications-a-week goal. Do not move it more than 5 points in one week, never below `hard_cutoff` + 5, and never above 90. Write the change with `put_config`, changing only `thresholds.auto_generate`, and state the old value, the new value and the count it implies. Skip the write entirely when the Queued (Generate) backlog is already above 40, and say so: more supply into a queue that is not draining is not the problem.

6b. Weights (`weights`). GATED. Do not touch the weights until `get_metrics` shows at least 5 roles that reached interview, spread across 2 or more score bands. Below that bar, say in one line that weight retuning is still gated and what the current interview count is, and change nothing. Reweighting a flat calibration table fits noise. Note also that a gradient cannot appear while nearly every application comes from a single band, so if the applications are concentrated in one band, report that as a selection artifact rather than as evidence the weights work or fail. When the gate is met: adjust title, domain, skill, seniority and location toward the bands and sources that actually produced interviews, move no single weight by more than 5 points, keep the five summing to 100, write with `put_config`, and show the before and after.

In both cases report exactly what changed. Never change `hard_cutoff`, the archetypes, the query set or the exclusion lists in an automated run.

STEP 7. Under 300 words. Lead with applications submitted, not roles found. Be honest about a slow week.

Never set Applied, Interviewing, Offer or Rejected, and never send an email.
