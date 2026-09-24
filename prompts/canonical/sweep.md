---
title: "JobHunt: daily sweep"
schedule: "On weekdays, 11:15 AM, after the search"
cron: "15 11 * * 1-5"
timezone: America/New_York
task_id: jobhunt-sweep
description: "Clears clear mismatches out of Queued before documents are built for them"
---

Daily JobHunt sweep: a quality check on the pipeline between the morning search and the document build. Do not ask any questions; execute and report at the end.

Use the **JobHunt** connector. If it is unavailable, stop and say so.

STATUS NAMES. The dashboard and the API name two statuses differently: the dashboard's "Queued" column is status "Generate" in the API, and "Ready" is status "Complete". In tool calls (`list_pipeline`, `set_status`) always pass the API value; in notes and in the report always use the dashboard name (Queued, Ready). Tool results that say "Generate" mean Queued.

WHY THIS EXISTS. Ingest scoring is keyword-based, so it lets through roles a person would reject in two seconds (a graduation-year program for another class, a ServiceNow HR analyst, a partnerships sales role, a Director title, a staffing agency's generic "Business Analyst" posting). Every role left in Queued costs a tailored resume and cover letter at the build. This sweep removes clear mismatches BEFORE that happens, and reports the patterns so the server rules can be fixed.

HARD RULES
- You only ever move roles DOWN: to "Skip", "Dead link" or "Discarded". Never move anything to Queued (API "Generate"), never rescore by judgment, never call ingest_jobs or add_role. Nothing is deleted: moved roles stay in the Trash tab and can be restored.
- Never touch a role whose `status_set_by` is "you": the person put it there themselves, and their call wins over this sweep. List it under "unsure" if it looks wrong.
- Never touch roles in Ready (API "Complete"), Applied, Interviewing, Offer or Rejected, except the dead-link check in STEP 5.
- Every status change carries a note starting "Sweep: " and naming the specific reason, quoting the title or JD phrase that triggered it. No note, no change.
- When unsure, leave the role alone and list it under "unsure" in the report. A wrong removal is worse than a wrong keep.

STEP 1. `get_config`, `get_preferences`, `get_plan`, and `get_application_profile` (for the graduation date and work history). The plan's tracks and its "not chasing" list are the standard.

STEP 2. Queued column. `list_pipeline` status "Generate" (the API name for Queued), limit 100. For each, `get_job` and read the title and JD. Move to "Skip" if ANY of these is clearly true:
  a. A graduation-year program for a different class than the person's (e.g. "2027 graduates", "Class of 20XX"), or an internship, co-op, summer or MBA-only program.
  b. Level: the title says Senior, Sr, Manager, Lead, Principal, Director, Head or VP, or the JD REQUIRES more than 2 years of full-time experience (a range like "1-3 years" is fine; "3+ years required" is not).
  c. Function outside every plan track: HR or HR systems, IT administration or a specific enterprise platform admin (ServiceNow, Dynamics, Salesforce admin), quota-carrying sales or partnerships, software or data engineering, accounting or audit, insurance, legal, clinical.
  d. Location: the posting's actual work location is outside {{TARGET_CITIES}} and it is not US-remote (watch for titles naming a different city than the location field).
  e. The JD states a hard requirement the person plainly lacks: a license (CPA, Series 7/63, bar), a security clearance, a specific degree they do not hold, or a named career background (investment banking, Big 4 audit) with no alternative.
  f. Posted by a staffing or recruiting agency on behalf of an unnamed client (e.g. KTek Resourcing, ATC, Robert Half, Insight Global, TEKsystems, "our client"), unless the client is named and the role itself passes a to e.
  Fit that is merely a stretch stays.

STEP 3. New roles from the last 3 days. `list_pipeline` status "New", `since_days` 3, limit 200. Using the title (and `get_job` only when the title is ambiguous), move to "Discarded" roles that are clearly Director, VP, Head of, Principal, Manager or Lead level, clearly outside every plan track per 2c, or staffing-agency postings per 2f. Leave "Senior Associate" and "Senior Analyst" in New unless the JD requires more than 2 years. Do not open every JD; this step is for obvious clutter.

STEP 4. Duplicates. Across Queued and the New roles from STEP 3, find the same role at the same company listed twice under slightly different titles or sources (e.g. LinkedIn and Indeed copies). Keep the copy with the employer's own apply URL or the longer JD; move the other to "Skip" with note "Sweep: duplicate of <kept id>".

STEP 5. Dead links. For roles in Queued or Ready (API "Generate" or "Complete") created more than 7 days ago, open the url. If the posting is removed, expired or redirects to a generic careers page, set "Dead link". Check at most 15 per run.

STEP 6. `log_run` with kind "manual", summary starting "Daily sweep:", `found` = roles reviewed, `dropped` = roles moved, and `errors` listing any tool failures.

STEP 7. Report, under 250 words:
  - Counts: reviewed, moved to Skip / Discarded / Dead link, left alone.
  - Each removal from Queued on one line: title @ company, reason.
  - "Unsure" list.
  - RULE SUGGESTIONS: any reason that fired 3+ times today, written as a concrete server rule (e.g. "add 'servicenow' to exclude_terms_title"). These are for the person to approve; do not change config yourself.

Never set Applied, Interviewing, Offer or Rejected, and never call `mark_applied`.
