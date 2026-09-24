> Engineering notes from the author's own instance (2026-09-23). Kept because they document known scorer bugs and the fixes still owed in server code.

# The scorer's title gate is discarding good roles

Found 2026-09-23 during the daily sweep. One of the four fixes is applied. The
other three need code changes in the JobHunt Worker and cannot be made from
config or from a scheduled run. This doc is the implementation spec for them.

## The evidence

`Analyst` at **Hines**, San Francisco. Score 90. `score_breakdown`:
title 10/20, domain 25/25, skill 20/20, seniority 20/20, location 15/15.
JD asks for "One or more years related experience in real estate or in a
financial analysis role", Argus and Excel DCF modelling, acquisitions and
development, $107,100 to $123,200. A Track B bullseye.

`drop_reason`: **"title matches no target role."**

Discarded because the title is the bare word "Analyst". The title gate is a hard
drop that overrides full marks on every other dimension, and it contradicts the
title scorer, which gave the same title 10 of 20 points rather than 0.

## Scale

Of 60 Discarded rows sampled, about 20 were false negatives, all scoring 80 to
90, all in a plan track: Hines Analyst and Associate, Brookfield Associate
Housing, Greystone Bridge Lending, Wells Fargo Commercial Mortgage, Altus Group
Advisory (they make Argus), Salient Founder's Office, Pallet GTM Strategy,
Moody's Strategic Programs, Galvanize Venture and Growth, and five roles titled
plainly "Financial Analyst".

The same scorer sent "Implementation Manager" requiring 5 to 8 years into Queued
at score 100. It is miscalibrated in both directions; the expensive direction is
the silent one.

## 1. APPLIED 2026-09-23: missing title terms

`put_config` on `archetypes`. Added bare "analyst" and "associate" to archetypes
2, 3, 4 and 5, which approximates demoting the gate from config alone: domain
and skill scoring plus `hard_cutoff` 60 still filter out an unrelated marketing
analyst. Also added "financial analyst" (2 and 4), which existed in no archetype
at all despite five losses, plus "founder's office", "founders office", "gtm
strategy", "growth strategy", "portfolio management", "lending", "mortgage",
"venture", "integrations specialist", "ai innovation" and "enablement".

Watch for: this widens what passes the gate, so intake volume rises. If Queued
grows, the lever is `thresholds.auto_generate` via the weekly retune, not
narrowing these terms again.

## 2. NOT APPLIED: demote the title gate (Worker code)

No config key controls it. In the scoring path, stop returning
`drop_reason: "title matches no target role"` as a hard drop. Make the title
match a score contribution only. If a hard floor is wanted, condition it on the
other dimensions, for example drop only when title scores 0 AND domain + skill
together are below half their combined weight (currently 45, so below 22).

## 3. NOT APPLIED: enforce max_years_required (Worker code)

`max_years_required` is already 2 and `score_breakdown` already records a
parsed `years_required` (both Santander rows on 2026-09-23 show
`"years_required": 3`), but nothing gates on it. Roles requiring 3, 4, 6 and 10
years still reached Queued at score 100. This was 19 of 40 Queued removals in
one sweep.

Make `years_required > max_years_required` a hard exclusion at ingest, with
`drop_reason` naming the parsed figure. Treat a range floor as the figure:
"1-3 years" and "2+ years" pass, "3-6 years" and "minimum five years" do not.

Deliberately NOT done from config: adding "3+ years" to `exclude_terms_any`
would also kill roles whose JD says "3+ years preferred", turning a
Queued-noise problem into new silent false negatives, which is the exact failure
this doc is about.

## 4. NOT APPLIED: an exclude_companies key (Worker code)

No such key exists, and `put_config` only replaces keys that already exist.
Add one, matched against the company field at ingest. 18 agency or blind
postings arrived in a single day.

Seed list: Robert Half, Insight Global, TEKsystems, KTek Resourcing, ATC,
Cypress HCM, Coda Search, Pinnacle Group, Hawthorne Lane, Career Group, Ascend
Talent Solutions, Comrise, Apex Systems, Selby Jennings, Hudson Gate Partners,
The Chief of Staff Association, The Green Recruitment Company, Dartmouth
Partners, Hoxton Circle, Atlas Search, Referment, Proven Recruiting, Plona
Partners. Also drop when the company field matches "confidential" or
"undisclosed".

Do NOT implement this as a JD-text match on "our client": customer-facing JDs
say "our clients" routinely, and that would create false negatives.

## 5. NOT APPLIED: dedupe on source_job_id (Worker code)

`normalized_key` is title plus company, so one posting under two company
spellings ingests twice. On 2026-09-23 LinkedIn job 4469920249 landed as both
"CRP Affordable Housing and Community Development" and "Castellan Real Estate
Partners", and "Santander" / "Santander US" split into two records. Prefer
`source_job_id` when present, and normalize company by stripping US, Inc, LLC,
Corporation and Group before comparing.

## Prompt changes already applied 2026-09-23

- Daily Sweep: STEP 6 Discarded audit, report-only, 20 rows a day, filtered to
  scorer-set drops so it does not re-litigate its own removals. Also pages past
  the 100-row `list_pipeline` limit (Queued held 166 that morning; the old
  prompt could only see the top 100), and has a 14:35 ET stop so it reports
  before the build.
- Daily Search: WRONG DROPS section naming any role discarded that run scoring
  80+, with its `drop_reason`, so this surfaces the same morning. Plus a
  pre-ingest title filter for ZipRecruiter and Dice, whose `seniority_classes`
  and `salary_min` filters are ignored, and a STEP 4d that reports LinkedIn
  alert-email company and location fields the JD contradicts.
- Build Documents moved from 14:45 to 15:30 ET so the sweep has 90 minutes
  rather than 45.
