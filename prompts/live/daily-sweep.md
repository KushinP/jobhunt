---
title: JobHunt: Daily Sweep
cron: "CRON_TZ=America/New_York 0 14 * * 1-5"
model: claude-opus-5-5
---

Daily JobHunt sweep: a quality check on the pipeline between the morning search (10:30 ET) and the document build (14:45 ET). Do not ask any questions; execute and report at the end.

Use the **JobHunt** connector. If it is unavailable, stop and say so.

TIME BUDGET. The document build fires at 14:45 ET, 45 minutes after this sweep starts. Reviewing a deep Queued column at JD level takes longer than that. Work highest score first, and at 14:35 ET stop reviewing whatever is left and go straight to log_run and the report, naming how many roles went unreviewed. A partial sweep that reports on time beats a complete one that reports late: the build starts on whatever is in Queued either way, and a late report hides that it did.

STATUS NAMES. The dashboard and the API name two statuses differently: the dashboard's "Queued" column is status "Generate" in the API, and "Ready" is status "Complete". In tool calls (`list_pipeline`, `set_status`) always pass the API value; in notes and in the report always use the dashboard name (Queued, Ready). Tool results that say "Generate" mean Queued.

WHY THIS EXISTS. Ingest scoring is keyword-based, so it fails in both directions. It lets through roles a person would reject in two seconds (a ServiceNow HR analyst, a partnerships sales role, a Director title, a staffing agency's generic "Business Analyst" posting, a JD requiring six years of experience), and every role left in Queued costs a tailored resume and cover letter at the build. It also throws away good roles on a title match: on 2026-09-23 a bare-titled "Analyst" at a real-estate developer scored 90, with full marks on domain, skill, seniority and location and a JD asking for one or more years, was dropped with drop_reason "title matches no target role" because the title was the bare word "Analyst". STEP 2 removes the first kind before documents are built. STEP 6 audits the second kind. Both report patterns so the server rules can be fixed.

HARD RULES
- You only ever move roles DOWN: to "Skip", "Dead link" or "Discarded". Never move anything to Queued (API "Generate"), never rescore by judgment, never call ingest_jobs or add_role. Nothing is deleted: moved roles stay in the Trash tab and can be restored.
- Never touch a role whose `status_set_by` is "you". The person put it there themselves and their call wins over this sweep. List it under "unsure" if it looks wrong.
- Never touch roles in Ready (API "Complete"), Applied, Interviewing, Offer or Rejected, except the dead-link check in STEP 5.
- Every status change carries a note starting "Sweep: " and naming the specific reason, quoting the title or JD phrase that triggered it. No note, no change.
- When unsure, leave the role alone and list it under "unsure" in the report. A wrong removal is worse than a wrong keep.
- STEP 6 is REPORT ONLY. Never restore, re-queue or re-score anything out of Discarded. List candidates and let the person decide.

STEP 1. `get_config`, `get_preferences`, `get_plan`, and `get_application_profile` (for graduation date {{GRADUATION_DATE}} and work history). The plan's tracks and "Not chasing" list are the standard.

STEP 2. Queued column. `list_pipeline` status "Generate" (the API name for Queued), limit 100. If it returns 100 rows, call it again with `offset` 100, then `offset` 200, until fewer than 100 come back, so the report can state the real depth of the column. Then review by JD in score order, highest first, up to 150 roles or the time budget, whichever comes first. For each, `get_job` and read the title and JD. Move to "Skip" if ANY of these is clearly true:
  a. An internship, co-op, summer programme or MBA-only programme, or a graduation-window programme whose window has already CLOSED (for example "Bachelor Degree, Graduation in December 2024 or Spring/Summer 2025", which is a stale posting for a past class). A start date in 2027 or later is NOT a reason to remove a role, and neither is a graduation window that opens after {{GRADUATION_DATE}}: the person confirmed on 2026-09-23 that later start dates are fine and that they will apply early by choice. Put those under "unsure" instead of removing them.
  b. Level: title says Senior, Sr, Manager, Lead, Principal, Director, Head, VP, or the JD REQUIRES more than 2 years of full-time experience (a range like "1-3 years" or a floor of "2+ years" is fine; a floor of 3 or more, such as "3+ years required", "3-6 years" or "minimum five years", is not).
  c. Function outside every plan track: HR or HR systems, IT administration or a specific enterprise platform admin (ServiceNow, Dynamics, Salesforce admin, package consulting), quota-carrying sales or partnerships, software/data engineering, accounting or audit, insurance, legal, clinical.
  d. Location: the posting's actual work location is outside {{TARGET_CITIES}} and it is not US-remote (watch for titles naming another city than the location field). A whole state or region counts when the person named it as a target, not only its main city.
  e. The JD states a hard requirement they plainly lack: a license (CPA, Series 7/63, bar), a security clearance, a specific degree they do not hold, a civil-service minimum qualification they do not meet, or a named career background with no alternative.
  f. Posted by a staffing or recruiting agency on behalf of an unnamed client, or by an employer that withholds its own name. Agencies seen so far: Robert Half, Insight Global, TEKsystems, KTek Resourcing, ATC, Cypress HCM, Coda Search, Pinnacle Group, Hawthorne Lane, Career Group, Ascend Talent Solutions, Comrise, Apex Systems, Selby Jennings, Hudson Gate Partners, The Chief of Staff Association, The Green Recruitment Company, Dartmouth Partners, Hoxton Circle, Atlas Search, Referment, Proven Recruiting, Plona Partners. Blind employer names seen so far: "Confidential Company", "Undisclosed", "Healthcare Infrastructure Company". No named employer means no role-specific resume or cover letter is possible. An agency posting whose client IS named, and which passes a to e, stays.
  Fit that is merely a stretch stays. Use this line: a pedigree list such as "1-2 years in management consulting or investment banking" is a stretch and stays, because the person's plan positions their experience against exactly those roles; a license, a clearance, a named degree or a specific industry's years of experience is a hard requirement and goes.

STEP 3. New roles from the last 3 days. `list_pipeline` status "New", since_days 3, limit 200. Using the title (and `get_job` only when the title is ambiguous), move to "Discarded" roles that are clearly Director, VP, Head of, Principal, Manager or Lead level, clearly outside every plan track per 2c, or staffing-agency postings per 2f. Leave "Senior Associate" and "Senior Analyst" in New unless the JD requires 3+ years. Do not open every JD; this step is for obvious clutter.

STEP 3b. Stale roles without a JD. `list_pipeline` status "New", `missing_jd` true, limit 200. For each role whose source is "ziprecruiter" or "indeed" and whose created_at is more than 7 days ago, move it to "Skip" with note "Sweep: no JD after 7 days; <source> link unreadable by the server and the Indeed connector". Exception: if its score is at or above the auto bar (config `thresholds.auto_generate`), leave it in New and list it in the report under "Open by hand" with its url; it may be worth a manual look. Do not touch roles from any other source here: the server keeps retrying those.

STEP 4. Duplicates. Across Queued and the New roles from STEP 3, find the same role at the same company listed twice under slightly different titles or sources (e.g. LinkedIn and Indeed copies, or a third-party repost of an employer's own posting). Company-name variants defeat the server's dedupe key, so treat a company name with and without a "US", "Inc." or "Group" suffix as the same company; a shared `source_job_id` is proof of a duplicate whatever the company field says. Keep the copy posted under the employer's own name or with the longer JD; move the other to "Skip" with note "Sweep: duplicate of <kept id>".

STEP 5. Dead links. For roles in Queued or Ready (API "Generate" or "Complete") created more than 7 days ago, open the url. If the posting is removed, expired or redirects to a generic careers page, set "Dead link". Check at most 15 per run.

STEP 6. Discarded audit. REPORT ONLY, change nothing. `list_pipeline` status "Discarded", limit 60. Keep only rows where `status_set_by` is null, which means the scorer dropped the role on arrival rather than a human or this sweep, and `status_changed_at` is within the last 24 hours, and `score` is at or above config `thresholds.hard_cutoff`. Take the 20 highest scores. For each, `get_job` and read `drop_reason`, `score_breakdown` and the JD's stated experience requirement. A drop is WRONG when the role sits in a plan track, the level and location fit, and the only thing against it is the title wording: the signature case is `drop_reason` "title matches no target role" on a role with full or near-full domain and skill scores. Titles that are legitimately in track but match no archetype term include bare "Analyst", bare "Associate", "Financial Analyst" and "Founder's Office". Report each wrong drop as one line: title @ company, score, drop_reason, and the JD's years requirement. Then name any `drop_reason` value that produced three or more wrong drops, because that is the rule to change.

STEP 7. `log_run` with kind "manual", summary starting "Daily sweep:", `found` = roles reviewed, `dropped` = roles moved, and `errors` listing any tool failures.

STEP 8. Report, under 400 words:
  - Counts: roles reviewed, the true depth of the Queued column, moved to Skip / Discarded / Dead link, left alone, and how many went unreviewed if the time budget ran out.
  - Removals from Queued: one line each (title @ company, reason) when there are 15 or fewer. Above 15, group by reason and list the roles under each heading, which fits far more detail in the same space than one line per role.
  - Stale no-JD roles moved to Skip (count only), and the "Open by hand" list: title @ company, score, url.
  - "Unsure" list, including anything left alone because `status_set_by` was "you".
  - WRONGLY DISCARDED, from STEP 6.
  - RULE SUGGESTIONS: any reason that fired 3 or more times today, in either direction, written as a concrete server rule (for example "add 'servicenow' to exclude_terms_title", or "stop dropping on title when domain and skill are full marks"). These are for the person to approve; do not change config yourself.

Never set Applied, Interviewing, Offer or Rejected, and never call `mark_applied`.
