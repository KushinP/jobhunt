---
title: "JobHunt: daily search"
schedule: "On weekdays, 10:30 AM"
cron: "30 10 * * 1-5"
timezone: America/New_York
task_id: jobhunt-search
description: "Searches the chosen platforms each weekday morning and adds scored, deduped roles"
---

Run the daily job search and put the results in the JobHunt pipeline. Do not ask any questions; execute and report at the end.

Use the **JobHunt** connector for everything below. If it is not available, stop and say so.

STATUS NAMES. The dashboard and the API name two statuses differently: the dashboard's "Queued" column is status "Generate" in the API, and "Ready" is status "Complete". In tool calls (`list_pipeline`, `set_status`) always pass the API value; in notes and in the report always use the dashboard name (Queued, Ready). Tool results that say "Generate" mean Queued.

STEP 1. Call `get_config`. Do NOT filter or score roles yourself: the server does both, including the comp floor, target cities and ruled-out industries. "Today" means the weekday in America/New_York; on a weekend, use Monday's city.

STEP 2. Search each source below:
- `search_company_boards` with no arguments. Highest priority: these postings are the freshest and least contested. It filters, scores and ingests on the server and returns a summary, so do NOT pass its results to ingest_jobs. If it reports no boards configured, note that for the run log and carry on.
- `search_yc_jobs` with no arguments. It reads Y Combinator startups' job board for the target cities and US remote, and like search_company_boards it filters, fetches JDs, scores and ingests on the server: do NOT pass its results to ingest_jobs. If it reports roles deferred to the next run, that is expected.
- **LinkedIn** (primary): `search_linkedin` for EVERY entry in `query_set`. For scope "local" or "both", search ONLY today's city ({{CITY_ROTATION}}) with `days` 7. For scope "remote" or "both", also search with location "remote" and `days` 1 (7 on Monday). It fetches full JDs and ingests on the server, so do NOT pass its results to ingest_jobs. About a cent a call. If it reports no Apify token or fails, record linkedin in sources_unavailable; never skip it silently.
- **Indeed** (secondary): `search_indeed` for the first six queries only ("AI Implementation Consultant", "Strategic Finance Analyst", "Real Estate Acquisitions Analyst", "Commercial Real Estate Credit Analyst", "AI Solutions Consultant", "Business Operations Analyst"), in ONLY today's city ({{CITY_ROTATION}}) with `days` 7. It fetches full JDs and ingests on the server, so do NOT pass its results to ingest_jobs. If it reports no Apify token or fails, record indeed in sources_unavailable; never skip it silently.
- The **ZipRecruiter** connector (`search_jobs`) for every entry in `query_set`. Pass `job_role` = the query, `location` = the city, `country_admin_code` "US", `employment_types` ["FULL_TIME"], `seniority_classes` ["NO_EXPERIENCE", "JUNIOR"], `max_posted_minutes_ago` 20160, `salary_min` {{COMP_FLOOR}}. For scope "local" or "both", search ONLY today's city ({{CITY_ROTATION}}); for scope "remote" or "both", also search with `location_types` ["REMOTE"] and no location. It returns 5 jobs per call; do not page, the daily cadence covers it. Collect title, company, location, `salary` as a string like "$79,300 - $160,800" built from min_annual and max_annual, `url` as job_redirect_url, and the posting date; never pass a search snippet as jd_text.
- The **Dice** connector (`search_jobs`) for the `query_set` entries with archetype 1 only; Dice lists tech roles, so finance and real estate queries there only add noise. Pass `keyword` = the query, `location` = today's city from the rotation above (and, for each of those queries, once more with `workplace_types` ["Remote"] and no location), `posted_date` "SEVEN", `employment_types` ["FULLTIME"], `employer_types` ["Direct Hire"], `jobs_per_page` 20. Pass `guid` as source_job_id and `detailsPageUrl` as url; do not pass the summary as jd_text, it is a truncated snippet. When reporting Dice results, include its required note that they were found with AI-powered search and should be verified with the employer.
- **LinkedIn job-alert emails** (the **Gmail** connector, inbox {{APPLY_EMAIL}}). `search_threads` with query `from:jobalerts-noreply@linkedin.com newer_than:3d` (3 days so Monday picks up the weekend; dedupe is server-side, so overlap is harmless), pageSize 50, paging with pageToken until done. For each thread, `get_thread` with messageFormat "PLAIN_TEXT". Each alert lists jobs as blocks of: title line, company line, location line, then "View job: https://www.linkedin.com/comm/jobs/view/JOB_ID/?...". Extract every job block; ignore the "See all jobs", Premium, footer and profile-view emails. Keep `source_job_id` = JOB_ID, `url` = "https://www.linkedin.com/jobs/view/JOB_ID/" (the clean form, never the tracking URL), and title, company and location exactly as written. The alert's own search keyword (first line, "Your job alert for X in Y") is not a filter: keep every job and let the server score it. Do not mark, label, archive or reply to any email. If Gmail is unavailable or errors, record linkedin_alerts in sources_unavailable.

If a source errors or rate-limits, retry that call once; if it fails again, stop calling that source for this run, keep what it already returned, and record it in sources_unavailable (say "partial" if some calls worked). Never skip a source silently.

Handshake, Wellfound and "any job page in your browser" run only on demand through the job-extract skill in the person's own Chrome. Do not search them, do not mark them unavailable; list them in the report as "browser only, not run".

STEP 3. Only ZipRecruiter, Dice and LinkedIn alert-email results go to `ingest_jobs`, one call each, with `source` "ziprecruiter", "dice" and "linkedin_email" respectively. Every other source above already ingested itself on the server. These results usually lack the job description, so most land in New marked needs_jd: that is expected, not a failure. They are held, not judged, until STEP 4 attaches their JD.

STEP 4. The JD pass.
  a. `fetch_jds` with no ids. The server reads LinkedIn (alert-email links included), Greenhouse, Lever, Ashby, YC and most career pages, which your own fetcher cannot, attaches each description and re-scores it: the role moves to Queued (API "Generate"), Discarded, or stays in New. Call it again while `remaining` is above 0, at most 3 calls.
  b. Its `needs_connector` list is Indeed and ZipRecruiter links, which refuse servers. For up to 15 of them, best score first: if the Indeed connector is connected, search it (`search_jobs`) by title and company; if the same role appears, take its full text with `get_job_details` and `attach_jd`. For a Dice role that fetch_jds could not read, use the Dice connector's `get_job_details` with its guid (the source_job_id) and `attach_jd`.
  c. Leave every role still without a JD in New. Do NOT mark it Unverified: the server tries it again in three days, and the person can open it. Only a posting that plainly says it is gone gets `set_status` "Dead link".

STEP 5. Call `log_run` with kind "search", `found`, `kept`, `duplicates`, `dropped` (the discarded count), `sources_used` (by the ids above, with linkedin_alerts for the alert emails), `sources_unavailable` and any `errors`. Do this even if you stop early, so a broken source shows up in the dashboard instead of looking like a quiet day.

STEP 6. Report, in this order: sources that failed or were partial; then `X found | X kept | X queued for documents | X duplicates | X discarded`; then a one-line LinkedIn-email tally (alerts read, jobs extracted, kept); then how many JDs were attached (by the server, by a connector) and where they moved (Queued, Discarded, stayed in New, Dead link), and how many still wait for one; then queries that produced nothing; then any role scoring 90 or above by name.

Never set Applied, Interviewing, Offer or Rejected, and never call `mark_applied`.
