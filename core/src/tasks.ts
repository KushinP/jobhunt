import type { Config } from './types.ts';

export interface ScheduledTask {
  task_id: string;
  title: string;
  description: string;
  /** the schedule as cron, in the person's time zone (America/New_York) */
  cron: string;
  /** the schedule in the words Cowork's frequency picker uses */
  cadence: string;
  prompt: string;
}

/** Where the person downloads a skill zip, on this instance's dashboard (PUBLIC_DASH_URL).
 * Behind sign-in, since the zips carry their profile. */
export const SETUP_FILE_URL = (baseUrl: string | undefined, name: string) =>
  `${(baseUrl ?? '').replace(/\/+$/, '')}/api/setup/files/${encodeURIComponent(name)}`;

/** Every prompt opens with this: the dashboard and the API name two statuses differently.
 * Written by the person on 2026-09-21. */
const STATUS_NAMES = 'STATUS NAMES. The dashboard and the API name two statuses differently: the '
  + 'dashboard\'s "Queued" column is status "Generate" in the API, and "Ready" is status "Complete". '
  + 'In tool calls (`list_pipeline`, `set_status`) always pass the API value; in notes and in the '
  + 'report always use the dashboard name (Queued, Ready). Tool results that say "Generate" mean Queued.';

const andList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs[0] ?? '');

/** How to create the tasks, for whichever assistant is doing it. */
export const TASK_SETUP_NOTES = [
  'If you can create scheduled tasks in this session (Cowork scheduled tasks, or Claude Code\'s '
    + 'scheduled-tasks tool), list the existing ones first. For each task below, update one with the '
    + 'same title, or create it: that title, that schedule, the prompt exactly as given. Never create '
    + 'a second copy of a task that exists, or every run happens twice.',
  'If you cannot, give the person each task as a copy-paste block (title, frequency, prompt) and '
    + 'point them to the dashboard, Setup, "Connect Claude", which has the same with copy buttons. In '
    + 'Cowork: Scheduled, New task, Set up manually.',
  'Approval: pick the mode that lets the task use its tools without asking, or every run stalls '
    + 'waiting for a click. The server refuses Applied, Interviewing, Offer and Rejected from '
    + 'automation whatever a prompt says. The weekly task writes Gmail drafts only.',
  'The order on a weekday matters: search, then sweep, then build, so documents are only built for '
    + 'roles that survived the sweep. Keep the times in that order if you change them.',
  'Then run the search task once by hand ("Run now"). That approves its tools and completes setup.',
  'Re-save the prompts after the person changes platforms or cities: a task keeps its own copy.',
];

/**
 * The four scheduled runs (search, sweep, build, weekly review), generated from the person's own choices so the prompt never
 * tells a run to call a source they have not turned on. Served by the connector, so every
 * user gets the current version rather than a copy that drifted on one machine.
 */
export function scheduledTaskPrompts(cfg: Config): ScheduledTask[] {
  const prefs = cfg.preferences;
  const src = new Set(prefs.sources ?? []);
  const cities = prefs.target_cities?.length
    ? prefs.target_cities
    : [{ name: 'Boston', search: cfg.search_defaults.local_location, match: [] }];
  // Searching every city every day hit Indeed's rate limit after 30 of 45 calls on the first
  // live run. Rotating one city per weekday keeps each connector near 20 calls a day while
  // still covering every city each week; remote roles are searched daily.
  const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const rotation = DAYS.map((d, i) => `${d} "${cities[i % cities.length].search}"`).join(', ');
  const cityList = cities.length === 1
    ? `"${cities[0].search}"`
    : `ONLY today's city (${rotation})`;
  // A rotated city is searched once or twice a week, so a one-day window missed most of its
  // postings; remote runs daily, so one day is enough, except Monday, which must cover the weekend.
  const rotated = cities.length > 1;

  const searchSteps: string[] = [];
  if (src.has('company_boards')) {
    searchSteps.push('- `search_company_boards` with no arguments. Highest priority: these '
      + 'postings are the freshest and least contested. It filters, scores and ingests on the '
      + 'server and returns a summary, so do NOT pass its results to ingest_jobs. If it reports '
      + 'no boards configured, note that for the run log and carry on.');
  }
  if (src.has('yc')) {
    searchSteps.push('- `search_yc_jobs` with no arguments. It reads Y Combinator startups\' '
      + 'job board for the target cities and US remote, and like search_company_boards it '
      + 'filters, fetches JDs, scores and ingests on the server: do NOT pass its results to '
      + 'ingest_jobs. If it reports roles deferred to the next run, that is expected.');
  }
  // LinkedIn is the primary aggregator since 2026-09-18: at about a cent a call it runs every
  // query daily. Indeed is kept as a cheap cross-check on the core queries only.
  if (src.has('linkedin')) {
    searchSteps.push(`- **LinkedIn** (primary): \`search_linkedin\` for EVERY entry in \`query_set\`. `
      + `For scope "local" or "both", search ${cityList} with \`days\` ${rotated ? 7 : 1}. For scope `
      + '"remote" or "both", also search with location "remote" and `days` 1 (7 on Monday). It '
      + 'fetches full JDs and ingests on the server, so do NOT pass its results to ingest_jobs. '
      + 'About a cent a call. If it reports no Apify token or fails, record linkedin in '
      + 'sources_unavailable; never skip it silently.');
  }
  if (src.has('builtin')) {
    const startupQs = cfg.query_set.filter((x) => x.archetype === 1 || x.archetype === 4).map((x) => `"${x.q}"`);
    if (startupQs.length) {
      searchSteps.push(`- **Built In**: ONE \`search_builtin\` call with queries [${startupQs.join(', ')}] `
        + `and location "${cities[0].search}" (Built In ${cities[0].name}). It filters to entry-level `
        + 'and junior, fetches full JDs and ingests on the server; do NOT pass its results to '
        + 'ingest_jobs. It takes one to three minutes.');
    }
  }
  if (src.has('indeed')) {
    const core = cfg.query_set.slice(0, 6).map((x) => `"${x.q}"`);
    searchSteps.push(`- **Indeed** (secondary): \`search_indeed\` for the first six queries only `
      + `(${core.join(', ')}), in ${cityList} with \`days\` ${rotated ? '7' : '1 (3 on Monday)'}. It `
      + 'fetches full JDs and ingests on the server, so do NOT pass its results to ingest_jobs. If '
      + 'it reports no Apify token or fails, record indeed in sources_unavailable; never skip it silently.');
  }
  const freshMinutes = (cfg.search_defaults.freshness_days ?? 14) * 1440;
  if (src.has('ziprecruiter')) {
    // Observed 2026-09-18: 5 results per call, salary returned as an object, and seniority
    // filtering available. Without these parameters it lets senior roles through; MID was
    // dropped the same day after most MID results asked for 4+ years.
    searchSteps.push(`- The **ZipRecruiter** connector (\`search_jobs\`) for every entry in `
      + `\`query_set\`. Pass \`job_role\` = the query, \`location\` = the city, `
      + '`country_admin_code` "US", `employment_types` ["FULL_TIME"], `seniority_classes` '
      + `["NO_EXPERIENCE", "JUNIOR"], \`max_posted_minutes_ago\` ${freshMinutes}`
      + (prefs.comp_floor ? `, \`salary_min\` ${prefs.comp_floor}` : '')
      + `. For scope "local" or "both", search ${cityList}; for scope "remote" or "both", also `
      + 'search with `location_types` ["REMOTE"] and no location. It returns 5 jobs per call; '
      + 'do not page, the daily cadence covers it. Collect title, company, location, '
      + '`salary` as a string like "$79,300 - $160,800" built from min_annual and max_annual, '
      + '`url` as job_redirect_url, and the posting date; never pass a search snippet as jd_text.');
  }
  if (src.has('dice')) {
    const tech = cfg.archetypes
      // AI implementation only: consulting is ranked last in the plan, and Dice's consulting
      // results are mostly IT staffing.
      .filter((a) => /\bai\b|implementation/i.test(a.name))
      .map((a) => a.id);
    // Observed 2026-09-18: without these filters Dice returns mostly contract, part-time and
    // recruiter listings for these queries.
    searchSteps.push(`- The **Dice** connector (\`search_jobs\`) for the \`query_set\` entries `
      + `with archetype ${tech.length ? tech.join(' or ') : '1'} only; Dice lists tech roles, so `
      + 'finance and real estate queries there only add noise. Pass `keyword` = the query, '
      + `\`location\` = ${cities.length === 1 ? 'the city' : "today's city from the rotation above"} `
      + '(and, for each of those queries, once more with `workplace_types` ["Remote"] and no location), `posted_date` '
      + '"SEVEN", `employment_types` ["FULLTIME"], `employer_types` ["Direct Hire"], '
      + '`jobs_per_page` 20. Pass `guid` as source_job_id and `detailsPageUrl` as url; do not '
      + 'pass the summary as jd_text, it is a truncated snippet. When '
      + 'reporting Dice results, include its required note that they were found with '
      + 'AI-powered search and should be verified with the employer.');
  }

  const cityNames = cities.map((c) => c.name);
  const cityWords = cityNames.length > 1
    ? `${cityNames.slice(0, -1).join(', ')} and ${cityNames[cityNames.length - 1]}` : cityNames[0];
  const maxYears = cfg.max_years_required ?? 2;

  if (src.has('linkedin_alerts')) {
    // Written by the person on 2026-09-21 and folded in here: LinkedIn's own saved-search alerts
    // catch postings the scraper's one-day window misses, at no cost.
    searchSteps.push('- **LinkedIn job-alert emails** (the **Gmail** connector'
      + (cfg.identity?.email ? `, inbox ${cfg.identity.email}` : '') + '). `search_threads` with query '
      + '`from:jobalerts-noreply@linkedin.com newer_than:3d` (3 days so Monday picks up the weekend; '
      + 'dedupe is server-side, so overlap is harmless), pageSize 50, paging with pageToken until done. '
      + 'For each thread, `get_thread` with messageFormat "PLAIN_TEXT". Each alert lists jobs as '
      + 'blocks of: title line, company line, location line, then "View job: '
      + 'https://www.linkedin.com/comm/jobs/view/JOB_ID/?...". Extract every job block; ignore the '
      + '"See all jobs", Premium, footer and profile-view emails. Keep `source_job_id` = JOB_ID, '
      + '`url` = "https://www.linkedin.com/jobs/view/JOB_ID/" (the clean form, never the tracking '
      + 'URL), and title, company and location exactly as written. The alert\'s own search keyword '
      + '(first line, "Your job alert for X in Y") is not a filter: keep every job and let the server '
      + 'score it. Do not mark, label, archive or reply to any email. If Gmail is unavailable or '
      + 'errors, record linkedin_alerts in sources_unavailable.');
  }

  const toIngest = [
    src.has('ziprecruiter') ? ['ZipRecruiter', 'ziprecruiter'] : null,
    src.has('dice') ? ['Dice', 'dice'] : null,
    src.has('linkedin_alerts') ? ['LinkedIn alert-email', 'linkedin_email'] : null,
  ].filter((x): x is string[] => x !== null);

  const search = [
    'Run the daily job search and put the results in the JobHunt pipeline. Do not ask any '
    + 'questions; execute and report at the end.',
    '',
    'Use the **JobHunt** connector for everything below. If it is not available, stop and say so.',
    '',
    STATUS_NAMES,
    '',
    'STEP 1. Call `get_config`. Do NOT filter or score roles yourself: the server does both, '
    + 'including the comp floor, target cities and ruled-out industries. "Today" means the '
    + 'weekday in America/New_York; on a weekend, use Monday\'s city.',
    '',
    'STEP 2. Search each source below:',
    ...searchSteps,
    '',
    'If a source errors or rate-limits, retry that call once; if it fails again, stop calling '
    + 'that source for this run, keep what it already returned, and record it in '
    + 'sources_unavailable (say "partial" if some calls worked). Never skip a source silently.',
    ...(src.has('handshake') || src.has('browser') || src.has('wellfound')
      ? ['', 'Handshake, Wellfound and "any job page in your browser" run only on demand through '
        + 'the job-extract skill in the person\'s own Chrome. Do not search them, do not mark '
        + 'them unavailable; list them in the report as "browser only, not run".']
      : []),
    '',
    toIngest.length
      ? `STEP 3. Only ${andList(toIngest.map((x) => x[0]))} results go to \`ingest_jobs\`, one call `
        + `each, with \`source\` ${andList(toIngest.map((x) => `"${x[1]}"`))} respectively. Every other source above `
        + 'already ingested itself on the server. These results usually lack the job description, so '
        + 'most land in New marked needs_jd: that is expected, not a failure. They are held, not '
        + 'judged, until STEP 4 attaches their JD.'
      : 'STEP 3. Nothing to ingest by hand: every source above ingested itself on the server.',
    '',
    'STEP 4. The JD pass.',
    '  a. `fetch_jds` with no ids. The server reads LinkedIn (alert-email links included), '
    + 'Greenhouse, Lever, Ashby, YC and most career pages, which your own fetcher cannot, attaches '
    + 'each description and re-scores it: the role moves to Queued (API "Generate"), Discarded, or '
    + 'stays in New. Call it again while `remaining` is above 0, at most 3 calls.',
    '  b. Its `needs_connector` list is Indeed and ZipRecruiter links, which refuse servers. For up '
    + 'to 15 of them, best score first: if the Indeed connector is connected, search it '
    + '(`search_jobs`) by title and company; if the same role appears, take its full text with '
    + '`get_job_details` and `attach_jd`.'
    + (src.has('dice')
      ? ' For a Dice role that fetch_jds could not read, use the Dice connector\'s `get_job_details` '
        + 'with its guid (the source_job_id) and `attach_jd`.'
      : ''),
    '  c. Leave every role still without a JD in New. Do NOT mark it Unverified: the server tries it '
    + 'again in three days, and the person can open it. Only a posting that plainly says it is gone '
    + 'gets `set_status` "Dead link".',
    '',
    'STEP 5. Call `log_run` with kind "search", `found`, `kept`, `duplicates`, `dropped` (the '
    + 'discarded count), `sources_used` (by the ids above'
    + (src.has('linkedin_alerts') ? ', with linkedin_alerts for the alert emails' : '')
    + '), `sources_unavailable` and any `errors`. Do this even if you stop early, so a broken '
    + 'source shows up in the dashboard instead of looking like a quiet day.',
    '',
    'STEP 6. Report, in this order: sources that failed or were partial; then '
    + '`X found | X kept | X queued for documents | X duplicates | X discarded`; '
    + (src.has('linkedin_alerts') ? 'then a one-line LinkedIn-email tally (alerts read, jobs extracted, kept); ' : '')
    + 'then how many JDs were attached (by the server, by a connector) and where they moved '
    + '(Queued, Discarded, stayed in New, Dead link), and how many still wait for one; then queries '
    + 'that produced nothing; then any role scoring 90 or above by name.',
    '',
    'Never set Applied, Interviewing, Offer or Rejected, and never call `mark_applied`.',
  ].join('\n');

  // Written by the person on 2026-09-21 and folded in here. Ingest scoring is keyword-based and
  // lets through roles a person rejects in two seconds; every one left in Queued costs a
  // tailored resume and cover letter at the build. The sweep only ever moves roles down.
  const sweep = [
    'Daily JobHunt sweep: a quality check on the pipeline between the morning search and the '
    + 'document build. Do not ask any questions; execute and report at the end.',
    '',
    'Use the **JobHunt** connector. If it is unavailable, stop and say so.',
    '',
    STATUS_NAMES,
    '',
    'WHY THIS EXISTS. Ingest scoring is keyword-based, so it lets through roles a person would '
    + 'reject in two seconds (a graduation-year program for another class, a ServiceNow HR analyst, '
    + 'a partnerships sales role, a Director title, a staffing agency\'s generic "Business Analyst" '
    + 'posting). Every role left in Queued costs a tailored resume and cover letter at the build. '
    + 'This sweep removes clear mismatches BEFORE that happens, and reports the patterns so the '
    + 'server rules can be fixed.',
    '',
    'HARD RULES',
    '- You only ever move roles DOWN: to "Skip", "Dead link" or "Discarded". Never move anything '
    + 'to Queued (API "Generate"), never rescore by judgment, never call ingest_jobs or add_role. '
    + 'Nothing is deleted: moved roles stay in the Trash tab and can be restored.',
    '- Never touch a role whose `status_set_by` is "you": the person put it there themselves, and '
    + 'their call wins over this sweep. List it under "unsure" if it looks wrong.',
    '- Never touch roles in Ready (API "Complete"), Applied, Interviewing, Offer or Rejected, '
    + 'except the dead-link check in STEP 5.',
    '- Every status change carries a note starting "Sweep: " and naming the specific reason, '
    + 'quoting the title or JD phrase that triggered it. No note, no change.',
    '- When unsure, leave the role alone and list it under "unsure" in the report. A wrong removal '
    + 'is worse than a wrong keep.',
    '',
    'STEP 1. `get_config`, `get_preferences`, `get_plan`, and `get_application_profile` (for the '
    + 'graduation date and work history). The plan\'s tracks and its "not chasing" list are the standard.',
    '',
    'STEP 2. Queued column. `list_pipeline` status "Generate" (the API name for Queued), limit 100. '
    + 'For each, `get_job` and read the title and JD. Move to "Skip" if ANY of these is clearly true:',
    '  a. A graduation-year program for a class other than the person\'s (a title or JD saying '
    + '"Class of" or "20XX graduates" for a year that is not theirs), or an internship, co-op, '
    + 'summer or MBA-only program.',
    `  b. Level: the title says Senior, Sr, Manager, Lead, Principal, Director, Head or VP, or the JD `
    + `REQUIRES more than ${maxYears} years of full-time experience (a range like "1-3 years" is fine; `
    + '"3+ years required" is not).',
    '  c. Function outside every plan track: HR or HR systems, IT administration or a specific '
    + 'enterprise platform admin (ServiceNow, Dynamics, Salesforce admin), quota-carrying sales or '
    + 'partnerships, software or data engineering, accounting or audit, insurance, legal, clinical.',
    `  d. Location: the posting's actual work location is outside ${cityWords} and it is not `
    + 'US-remote (watch for titles naming a different city than the location field).',
    '  e. The JD states a hard requirement the person plainly lacks: a license (CPA, Series 7/63, '
    + 'bar), a security clearance, a specific degree they do not hold, or a named career background '
    + '(investment banking, Big 4 audit) with no alternative.',
    '  f. Posted by a staffing or recruiting agency on behalf of an unnamed client (e.g. KTek '
    + 'Resourcing, ATC, Robert Half, Insight Global, TEKsystems, "our client"), unless the client is '
    + 'named and the role itself passes a to e.',
    '  Fit that is merely a stretch stays.',
    '',
    'STEP 3. New roles from the last 3 days. `list_pipeline` status "New", `since_days` 3, limit '
    + '200. Using the title (and `get_job` only when the title is ambiguous), move to "Discarded" '
    + 'roles that are clearly Director, VP, Head of, Principal, Manager or Lead level, clearly outside '
    + 'every plan track per 2c, or staffing-agency postings per 2f. Leave "Senior Associate" and '
    + `"Senior Analyst" in New unless the JD requires more than ${maxYears} years. Do not open every JD; `
    + 'this step is for obvious clutter.',
    '',
    'STEP 4. Duplicates. Across Queued and the New roles from STEP 3, find the same role at the '
    + 'same company listed twice under slightly different titles or sources (e.g. LinkedIn and '
    + 'Indeed copies). Keep the copy with the employer\'s own apply URL or the longer JD; move the '
    + 'other to "Skip" with note "Sweep: duplicate of <kept id>".',
    '',
    'STEP 5. Dead links. For roles in Queued or Ready (API "Generate" or "Complete") created more '
    + 'than 7 days ago, open the url. If the posting is removed, expired or redirects to a generic '
    + 'careers page, set "Dead link". Check at most 15 per run.',
    '',
    'STEP 6. `log_run` with kind "manual", summary starting "Daily sweep:", `found` = roles '
    + 'reviewed, `dropped` = roles moved, and `errors` listing any tool failures.',
    '',
    'STEP 7. Report, under 250 words:',
    '  - Counts: reviewed, moved to Skip / Discarded / Dead link, left alone.',
    '  - Each removal from Queued on one line: title @ company, reason.',
    '  - "Unsure" list.',
    '  - RULE SUGGESTIONS: any reason that fired 3+ times today, written as a concrete server rule '
    + '(e.g. "add \'servicenow\' to exclude_terms_title"). These are for the person to approve; do '
    + 'not change config yourself.',
    '',
    'Never set Applied, Interviewing, Offer or Rejected, and never call `mark_applied`.',
  ].join('\n');

  const build = [
    'Build the tailored resume and cover letter for every role in the Queued column of the '
    + 'JobHunt pipeline. Do not ask any questions: where a skill says to ask, choose and note the '
    + 'choice in the report. Execute and report at the end.',
    '',
    'Use the **JobHunt** connector. If it is unavailable, stop and say so.',
    '',
    STATUS_NAMES,
    '',
    'Before any early stop below, call `log_run` with kind "build_docs" and the reason as '
    + '`summary`, so a blocked build is visible in the dashboard.',
    '',
    'STEP 0. `onboarding_status`. If the "resume_claims" step is not done, the evidence bank '
    + 'has not been reviewed, and any resume built now would rest on unverified or missing '
    + 'claims: stop with "evidence bank not reviewed yet, nothing built". Then check you can '
    + 'write a .docx here (python-docx, or the docx npm package); if neither works, stop with '
    + '"cannot create .docx files in this environment".',
    'STEP 1. `list_queue` with limit 100. If empty, stop with "nothing queued". BUILD ORDER: first '
    + 'by the person\'s star rating (`rating`, 1 to 5, 5 highest), highest first, with every unrated '
    + 'role after every rated one; then, within the same rating (and among unrated roles), by '
    + '`score`, highest first. The server should already return the queue in this order. If a row '
    + 'has no `rating` field, read it from `get_job`; if the order returned does not match this '
    + 'rule, re-sort it yourself before starting. `has_resume` and `has_cover_letter` say which '
    + 'file a half-built role still needs: build only that one.',
    'STEP 2. Once: `get_config`, `get_plan` (how to position each archetype) and '
    + '`get_application_profile` (degree, graduation, work history dates for the fit check).',
    'STEP 3. For each queued role, in the build order from STEP 1: build at most SIX per run (roles turned away by the fit check in '
    + 'c do not count toward the six), and fit-check at most 15.',
    '  a. `get_job` for the JD. With no JD, call `fetch_jds` with its id; if the server cannot read '
    + 'it, fetch the posting yourself and `attach_jd`; if it cannot be retrieved at all, skip the '
    + 'role and leave it in Queued.',
    '  b. `list_evidence` with status "confirmed" and the role\'s archetype (once per archetype, '
    + 'then reuse it). This is the ONLY material you may use. Read every item of kind '
    + '"boundary" first: claims never to make, however well they would fit the JD.',
    '  c. Fit check, before spending anything on documents. List the JD\'s REQUIRED '
    + 'qualifications (not "preferred", "a plus" or "nice to have"). Check each against the '
    + 'confirmed evidence and the application profile. The role fails if any is '
    + 'plainly unmet: more years of experience than the work history shows; a specific career '
    + 'background the person has never had (for example a Controller or accounting career, '
    + 'investment banking, management consulting, software or sales engineering) with no "or '
    + 'similar" alternative the evidence meets; or a required degree, license or credential '
    + 'they do not hold. A stretch is fine; an unmet hard requirement is not. On a fail, '
    + '`set_status` New with note "Fit check: <the unmet requirement, quoted from the JD>" and '
    + 'move on: no documents, no retry. Exception: a role whose `queued_by` is "you" is the '
    + 'person\'s own call, so build it anyway and list the unmet requirements in the report.',
    '  d. `get_base_resume` with `archetype` = the role\'s archetype and `include_file` true. '
    + 'The server picks the right master. Keep its structure, section order and formatting.',
    '  e. Tailor with the **tailored-resume** skill, then the **tailored-cover-letter** skill. '
    + 'Every bullet must trace to a confirmed evidence item: reword it into the JD\'s '
    + 'vocabulary, reorder, choose which to show, but never add a tool, metric, project, scope '
    + 'or outcome that is not in the bank. Respect `ownership`: "contributed" never becomes '
    + '"led", "team" never becomes "built". No em dashes. Dates as MM/YYYY - MM/YYYY.',
    '  f. Verify page count by rendering to PDF if LibreOffice is available; otherwise treat '
    + 'it as an estimate and say so.',
    '  g. Build BOTH files before saving either. Never paste a file into a tool call: a long base64 '
    + 'copy drifts and is refused. For each file, call `start_document_upload` with the role, kind, '
    + 'filename, `sha256` = your local file\'s sha256, the content spec listing the evidence ids used, '
    + 'and `page_count_verified` set honestly. Then run the `curl` command it returns from the shell '
    + '(replace FILE with the path): the file goes straight from the sandbox, and the JSON reply with '
    + 'ok true and a link means it is saved. If curl cannot connect (the sandbox blocks the domain), '
    + 'run its `chunks` command and send each printed piece with `upload_document_chunk`; a piece '
    + 'that arrives different is refused alone, so resend just that one. If a file still cannot be '
    + 'saved, leave the role in Queued and report it.',
    '  h. `set_status` "Complete" (the Ready column) only after BOTH documents are saved. On any '
    + 'failure leave the role in Queued (API "Generate"): the queue brings it back with only the '
    + 'missing file to build.',
    'STEP 4. `log_run` with kind "build_docs", `found` = roles looked at, `kept` = roles built, '
    + '`dropped` = roles turned away by the fit check, and any `errors`.',
    'STEP 5. Report, in this order: blockers; roles now Ready to submit (title, company, star rating, score, and the '
    + 'links save_document returned); roles the person queued that miss a requirement, with it; '
    + 'roles turned away by the fit check, with the unmet requirement; anything skipped or failed. '
    + 'For each resume, the evidence ids used and any JD requirement the bank could not honestly support.',
    '',
    'Never set Applied, Interviewing, Offer or Rejected, and never call `mark_applied`.',
  ].join('\n');

  const weekly = [
    'Weekly JobHunt review. Do not ask any questions; execute and report at the end.',
    '',
    'Use the **JobHunt** connector. If it is unavailable, stop and say so.',
    '',
    STATUS_NAMES,
    '',
    'STEP 1. Follow-ups. `get_followups`. For each application quiet past the no-response window, '
    + 'find the thread with the company (their application confirmation or a recruiter\'s email) '
    + 'with the Gmail connector\'s `search_threads`'
    + (cfg.identity?.email ? ` (the inbox ${cfg.identity.email}, which applications go out from)` : '')
    + ', and write a short follow-up (six sentences at most) as a draft IN that thread with '
    + '`create_draft`. Never call `send_message`, `reply` or `forward`: drafts only. Then '
    + '`complete_followup` with the draft id. If there is no thread, do not draft and do not guess '
    + 'an address: leave the follow-up open and list it for the person. If Gmail is not connected, '
    + 'list them all.',
    'STEP 2. `get_metrics` and `list_goals`. Each goal against its computed progress (applications '
    + 'this week against the weekly goal first); a goal list_goals marks not measurable is named '
    + 'once as "not tracked", with no number. Then responses and interviews, which sources convert, '
    + 'and whether the score bands show a real gradient (if they are flat, say the weights are not '
    + 'predicting anything).',
    'STEP 3. `get_plan`, then report applications and interviews by the plan\'s tracks, as the plan '
    + 'names them. Apply any decision rule the plan sets (such as a week-4 rule) when it is due.',
    'STEP 4. Where work is stuck, oldest first.',
    '  a. Built and not sent: `list_pipeline` status "Complete" (the Ready column), roles whose '
    + '`status_changed_at` is more than four days ago.',
    '  b. Queued and never built: `list_pipeline` status "Generate" (the Queued column), roles whose '
    + '`status_changed_at` is more than 2 days ago and that have no documents (resume_count 0). Any '
    + 'of these means the document build is failing or blocked: read `list_runs` kind "build_docs" '
    + 'and say why (not running, stopping early, or turning everything away), with the count.',
    'STEP 5. The backlog: how many roles wait in New and in Queued, and how many still need a JD '
    + '(`list_pipeline` status "New", `missing_jd` true). Count the roles in New scoring 70 or more; '
    + 'more than 15 suggests the auto-queue threshold (config `thresholds.auto_generate`) is too '
    + 'high: say so, with the number.',
    'STEP 6. Categorize companies. `list_companies` with `uncategorized` true, then '
    + '`set_companies` with an industry and stage for each, judged from the role titles, the JD '
    + 'excerpt and what you know. Leave a field out rather than guess. Never set priority.',
    'STEP 7. Run health. `list_runs` with kind "search": any source unavailable on two or more of '
    + 'the last five runs is broken, not quiet. Name it. Then kind "build_docs" and the sweep (kind '
    + '"manual", summary starting "Daily sweep"): a weekday with no run of either means the task '
    + 'did not fire.',
    'STEP 8. `log_run` with kind "weekly" and a one-line summary.',
    'STEP 9. Under 300 words. Lead with applications submitted, not roles found; then what is '
    + 'blocking the person (built and not sent, broken sources), then the rest. Be honest about a slow week.',
    '',
    'Never set Applied, Interviewing, Offer or Rejected, never send an email, and never submit anything.',
  ].join('\n');

  return [
    {
      task_id: 'jobhunt-search', title: 'JobHunt: daily search',
      description: 'Searches the chosen platforms each weekday morning and adds scored, deduped roles',
      cron: '30 10 * * 1-5', cadence: 'On weekdays, 10:30 AM', prompt: search,
    },
    {
      task_id: 'jobhunt-sweep', title: 'JobHunt: daily sweep',
      description: 'Clears clear mismatches out of Queued before documents are built for them',
      cron: '15 11 * * 1-5', cadence: 'On weekdays, 11:15 AM, after the search', prompt: sweep,
    },
    {
      task_id: 'jobhunt-build-docs', title: 'JobHunt: build documents',
      description: 'Builds evidence-backed resumes and cover letters for queued roles',
      cron: '0 12 * * 1-5', cadence: 'On weekdays, noon, after the sweep', prompt: build,
    },
    {
      task_id: 'jobhunt-weekly', title: 'JobHunt: weekly review',
      description: 'Monday review: follow-up drafts, conversion by track, and what is stuck',
      cron: '0 8 * * 1', cadence: 'Weekly, Monday 8:00 AM', prompt: weekly,
    },
  ];
}

/**
 * The instructions for building one role right now, for the dashboard's "Build now" button.
 * It opens a Claude chat with this prefilled, so it stays short and points at the full
 * build-docs prompt rather than copying it (a prefilled link caps out around 14,000 chars).
 */
export function buildOnePrompt(job: { id: string; title: string; company: string }): string {
  return [
    `Build the tailored resume and cover letter for one JobHunt role now: ${job.title} at ${job.company} (JobHunt id ${job.id}).`,
    '',
    'Use the JobHunt connector. Call `get_scheduled_task_prompts` and follow the jobhunt-build-docs '
    + `instructions for this one role only: do step 0 and step 2, skip step 1, then step 3 for id ${job.id}.`,
    'I queued this role myself, so if the fit check finds an unmet requirement, build it anyway and '
    + 'tell me what the JD asks for that my confirmed evidence does not show.',
    'When both files are saved and the role is Complete, give me the links that save_document returned.',
    'Never set Applied, Interviewing, Offer or Rejected, and never call `mark_applied`.',
  ].join('\n');
}
