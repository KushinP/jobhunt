---
title: JobHunt: Build Documents
cron: "CRON_TZ=America/New_York 30 15 * * 1-5"
model: claude-opus-5-5
---

Build the tailored resume and cover letter for every role in the Queued column of the JobHunt pipeline. Do not ask any questions: where a skill says to ask, choose and note the choice in the report. Execute and report at the end.

Use the **JobHunt** connector. If it is unavailable, stop and say so.

STATUS NAMES. The dashboard and the API name two statuses differently: the dashboard's "Queued" column is status "Generate" in the API, and "Ready" is status "Complete". In tool calls (`list_pipeline`, `set_status`) always pass the API value; in notes and in the report always use the dashboard name (Queued, Ready). Tool results that say "Generate" mean Queued.

Before any early stop below, call `log_run` with kind "build_docs" and the reason as `summary`, so a blocked build is visible in the dashboard.

STEP 0. `onboarding_status`. If the "resume_claims" step is not done, the evidence bank has not been reviewed, and any resume built now would rest on unverified or missing claims: stop with "evidence bank not reviewed yet, nothing built". Then check you can write a .docx here (python-docx, or the docx npm package); if neither works, stop with "cannot create .docx files in this environment".
STEP 1. `list_queue` with limit 100. If empty, stop with "nothing queued". BUILD ORDER: first by the person's star rating (`rating`, 1 to 5, 5 highest), highest first, with every unrated role after every rated one; then, within the same rating (and among unrated roles), by `score`, highest first. The server should already return the queue in this order. If a row has no `rating` field, read it from `get_job`; if the order returned does not match this rule, re-sort it yourself before starting. `has_resume` and `has_cover_letter` say which file a half-built role still needs: build only that one.
STEP 2. Once: `get_config`, `get_plan` (how to position each archetype) and `get_application_profile` (degree, graduation, work history dates for the fit check).
STEP 3. For each queued role, in the build order from STEP 1: build at most SIX per run (roles turned away by the fit check in c do not count toward the six), and fit-check at most 15.
  a. `get_job` for the JD. With no JD, call `fetch_jds` with its id; if the server cannot read it, fetch the posting yourself and `attach_jd`; if it cannot be retrieved at all, skip the role and leave it in Queued.
  b. `list_evidence` with status "confirmed" and the role's archetype (once per archetype, then reuse it). This is the ONLY material you may use. Read every item of kind "boundary" first: claims never to make, however well they would fit the JD.
  c. Fit check, before spending anything on documents. List the JD's REQUIRED qualifications (not "preferred", "a plus" or "nice to have"). Check each against the confirmed evidence and the application profile. The role fails if any is plainly unmet: more years of experience than the work history shows; a specific career background the person has never had (for example a Controller or accounting career, investment banking, management consulting, software or sales engineering) with no "or similar" alternative the evidence meets; or a required degree, license or credential they do not hold. A stretch is fine; an unmet hard requirement is not. On a fail, `set_status` New with note "Fit check: <the unmet requirement, quoted from the JD>" and move on: no documents, no retry. Exception: a role whose `queued_by` is "you" is the person's own call, so build it anyway and list the unmet requirements in the report.
  d. `get_base_resume` with `archetype` = the role's archetype and `include_file` true. The server picks the right master. Keep its structure, section order and formatting.
  e. Tailor with the **tailored-resume** skill, then the **tailored-cover-letter** skill. Every bullet must trace to a confirmed evidence item: reword it into the JD's vocabulary, reorder, choose which to show, but never add a tool, metric, project, scope or outcome that is not in the bank. Respect `ownership`: "contributed" never becomes "led", "team" never becomes "built". No em dashes. Dates as MM/YYYY - MM/YYYY.
  f. Verify page count by rendering to PDF if LibreOffice is available; otherwise treat it as an estimate and say so.
  g. Build BOTH files before saving either. Then `save_document` for each, with the content spec listing the evidence ids used, `page_count_verified` set honestly, and `sha256` = your local file's sha256: the server refuses a copy that arrived with a changed character instead of storing a broken file. If it is refused, send it again; if it is refused twice, re-zip the .docx at a different compression level (same content, new bytes) and send that once; if that also fails, leave the role in Queued and report it.
  h. `set_status` "Complete" (the Ready column) only after BOTH documents are saved. On any failure leave the role in Queued (API "Generate"): the queue brings it back with only the missing file to build.
STEP 4. `log_run` with kind "build_docs", `found` = roles looked at, `kept` = roles built, `dropped` = roles turned away by the fit check, and any `errors`.
STEP 5. Report, in this order: blockers; roles now Ready to submit (title, company, star rating, score, and the links save_document returned); roles the person queued that miss a requirement, with it; roles turned away by the fit check, with the unmet requirement; anything skipped or failed. For each resume, the evidence ids used and any JD requirement the bank could not honestly support.

Never set Applied, Interviewing, Offer or Rejected, and never call `mark_applied`.
