---
title: "JobHunt: weekly review"
schedule: "Weekly, Monday 8:00 AM"
cron: "0 8 * * 1"
timezone: America/New_York
task_id: jobhunt-weekly
description: "Monday review: follow-up drafts, conversion by track, and what is stuck"
---

Weekly JobHunt review. Do not ask any questions; execute and report at the end.

Use the **JobHunt** connector. If it is unavailable, stop and say so.

STATUS NAMES. The dashboard and the API name two statuses differently: the dashboard's "Queued" column is status "Generate" in the API, and "Ready" is status "Complete". In tool calls (`list_pipeline`, `set_status`) always pass the API value; in notes and in the report always use the dashboard name (Queued, Ready). Tool results that say "Generate" mean Queued.

STEP 1. Follow-ups. `get_followups`. For each application quiet past the no-response window, find the thread with the company (their application confirmation or a recruiter's email) with the Gmail connector's `search_threads` (the inbox {{APPLY_EMAIL}}, which applications go out from), and write a short follow-up (six sentences at most) as a draft IN that thread with `create_draft`. Never call `send_message`, `reply` or `forward`: drafts only. Then `complete_followup` with the draft id. If there is no thread, do not draft and do not guess an address: leave the follow-up open and list it for the person. If Gmail is not connected, list them all.
STEP 2. `get_metrics` and `list_goals`. Each goal against its computed progress (applications this week against the weekly goal first); a goal list_goals marks not measurable is named once as "not tracked", with no number. Then responses and interviews, which sources convert, and whether the score bands show a real gradient (if they are flat, say the weights are not predicting anything).
STEP 3. `get_plan`, then report applications and interviews by the plan's tracks, as the plan names them. Apply any decision rule the plan sets (such as a week-4 rule) when it is due.
STEP 4. Where work is stuck, oldest first.
  a. Built and not sent: `list_pipeline` status "Complete" (the Ready column), roles whose `status_changed_at` is more than four days ago.
  b. Queued and never built: `list_pipeline` status "Generate" (the Queued column), roles whose `status_changed_at` is more than 2 days ago and that have no documents (resume_count 0). Any of these means the document build is failing or blocked: read `list_runs` kind "build_docs" and say why (not running, stopping early, or turning everything away), with the count.
STEP 5. The backlog: how many roles wait in New and in Queued, and how many still need a JD (`list_pipeline` status "New", `missing_jd` true). Count the roles in New scoring 70 or more; more than 15 suggests the auto-queue threshold (config `thresholds.auto_generate`) is too high: say so, with the number.
STEP 6. Categorize companies. `list_companies` with `uncategorized` true, then `set_companies` with an industry and stage for each, judged from the role titles, the JD excerpt and what you know. Leave a field out rather than guess. Never set priority.
STEP 7. Run health. `list_runs` with kind "search": any source unavailable on two or more of the last five runs is broken, not quiet. Name it. Then kind "build_docs" and the sweep (kind "manual", summary starting "Daily sweep"): a weekday with no run of either means the task did not fire.
STEP 8. `log_run` with kind "weekly" and a one-line summary.
STEP 9. Under 300 words. Lead with applications submitted, not roles found; then what is blocking the person (built and not sent, broken sources), then the rest. Be honest about a slow week.

Never set Applied, Interviewing, Offer or Rejected, never send an email, and never submit anything.
