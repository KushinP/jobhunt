import type { Config } from './types.ts';
import type { D1Like } from './repo.ts';
import { listBaseResumes, putConfig } from './repo.ts';
import { SOURCES } from './sources.ts';

export interface OnboardingStep {
  key: string;
  /** kept as `what` for the dashboard checklist */
  what: string;
  done: boolean;
  why: string;
  /** what to ask and do, in order. Addressed to the assistant running onboarding. */
  ask: string[];
  save_with: string[];
  /** 'data' steps complete themselves from what actually happened, not from a claim;
   * 'confirmed' ones cannot be seen from here (a skill uploaded to claude.ai), so they complete
   * when the person says they are done */
  verified_by: 'data' | 'saved' | 'confirmed';
}

export interface OnboardingStatus {
  complete: boolean;
  done: number;
  total: number;
  next: Pick<OnboardingStep, 'key' | 'what' | 'ask' | 'save_with'> | null;
  steps: OnboardingStep[];
}

/**
 * The onboarding protocol. Served to whichever assistant is helping, so setup works the
 * same for anyone who connects and picks up where the last session stopped. Steps are
 * ordered so each one's answers feed the next: the evidence bank before the plan, the
 * sources before the connectors, the connectors before the scheduled runs.
 */
export async function onboardingStatus(db: D1Like, cfg: Config): Promise<OnboardingStatus> {
  const [resumes, evRows, cfgRows, goals, placeholders, searchRuns, jobs, confirmedRow] = await Promise.all([
    listBaseResumes(db),
    db.prepare('SELECT kind, source, status, COUNT(*) AS n FROM evidence GROUP BY kind, source, status')
      .all<{ kind: string; source: string; status: string; n: number }>(),
    db.prepare('SELECT key FROM config').all<{ key: string }>(),
    db.prepare("SELECT COUNT(*) AS n FROM goals WHERE status = 'active'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM profile WHERE value = 'CONFIRM'").first<{ n: number }>(),
    db.prepare("SELECT sources_used FROM runs WHERE kind = 'search' ORDER BY started_at DESC LIMIT 10")
      .all<{ sources_used: string | null }>(),
    db.prepare('SELECT COUNT(*) AS n FROM jobs').first<{ n: number }>(),
    db.prepare("SELECT value FROM config WHERE key = 'setup_confirmed'").first<{ value: string }>(),
  ]);
  const confirmed = new Set<string>(parseList(confirmedRow?.value));

  const ev = evRows.results;
  const count = (f: (r: typeof ev[number]) => boolean) =>
    ev.filter(f).reduce((a, r) => a + r.n, 0);
  const saved = new Set(cfgRows.results.map((r) => r.key));
  const prefs = cfg.preferences;
  const answered = new Set(saved.has('preferences') ? (prefs.answered ?? []) : []);

  const chosen = prefs.sources ?? [];
  const needsSetup = chosen.filter((id) => {
    const s = SOURCES.find((x) => x.id === id);
    return s && (s.status === 'connector' || s.status === 'api_key');
  });
  const usedSources = new Set(searchRuns.results.flatMap((r) => {
    try { return (JSON.parse(r.sources_used ?? '[]') as string[]).map((x) => x.toLowerCase()); }
    catch { return []; }
  }));
  const connectorsProven = needsSetup.every((id) => [...usedSources].some((u) => u.includes(id)));

  const boards = cfg.target_boards ?? { greenhouse: [], lever: [], ashby: [] };
  const boardCount = (boards.greenhouse?.length ?? 0) + (boards.lever?.length ?? 0)
    + (boards.ashby?.length ?? 0);

  const steps: OnboardingStep[] = [
    {
      key: 'resume',
      what: 'Your current resume, stored as a master',
      done: resumes.some((r) => r.active),
      why: 'Every tailored resume starts from a master, which keeps dates, titles and credentials identical everywhere.',
      ask: [
        'Ask for their current resume as a .docx. They can upload it in the dashboard (Setup, Base resumes) or send it in this chat.',
        'Store it with save_base_resume, always passing extracted_text.',
      ],
      save_with: ['save_base_resume'],
      verified_by: 'data',
    },
    {
      key: 'resume_claims',
      what: 'Every claim on the resume confirmed, corrected or rejected',
      done: count((r) => r.source === 'resume') >= 3
        && count((r) => r.source === 'resume' && r.status === 'unconfirmed') === 0,
      why: 'Tailoring may only use confirmed evidence. A claim is not true because it was written down, and the slightly overstated ones are exactly what an interviewer probes.',
      ask: [
        'Read the master with get_base_resume. Add EVERY claim to the evidence bank as its own item with source "resume" and source_ref the filename: each role with its dates, each bullet, each metric, each credential. Copy them; do not improve them.',
        'Go through them with the person a few at a time. For each: is it accurate exactly as written, and who did the work (built_myself, led, contributed, team)? Confirm it, correct it, or reject it with a note saying what is actually true.',
        'Rejected items stay in the bank as a record of what not to claim.',
      ],
      save_with: ['add_evidence', 'review_evidence'],
      verified_by: 'data',
    },
    {
      key: 'beyond_resume',
      what: 'What you have done that is not on the resume',
      done: count((r) => r.source === 'user' && r.status === 'confirmed'
        && ['project', 'accomplishment', 'metric'].includes(r.kind)) >= 3,
      why: 'Most people undersell. Things built, launches, and numbers moved that never made the one-page cut are often the strongest material for a specific role.',
      ask: [
        'Ask what they have built, shipped, launched or improved that is not on the resume. Ask for specifics: dates as MM/YYYY, what they personally did, a metric if there is one, and a link or file as proof.',
        'Save each as its own item with honest ownership. Offer to capture 3 to 5 STAR stories (kind "story") for interviews while the details are fresh.',
      ],
      save_with: ['add_evidence'],
      verified_by: 'data',
    },
    {
      key: 'skills',
      what: 'Skills you would be comfortable being tested on',
      done: count((r) => r.kind === 'skill' && r.status === 'confirmed') >= 5,
      why: 'Keyword matching pulls terms onto a resume. A skill with no evidence behind it is where the ambush question comes from.',
      ask: [
        'List tools and skills with a level (familiar, working, strong, expert). For each, ask which project or role proves it, and put that in detail. Leave off anything they could not whiteboard.',
      ],
      save_with: ['add_evidence'],
      verified_by: 'data',
    },
    {
      key: 'boundaries',
      what: 'What must never be claimed',
      done: count((r) => r.kind === 'boundary') >= 1,
      why: 'Written guardrails stop a tailoring pass from reaching for a claim that fits the JD but is not true.',
      ask: [
        'Ask what they must never claim even when a JD asks for it: experience they do not have, titles they did not hold, outcomes that did not happen, work someone else did. Save each as kind "boundary" with what is true instead.',
      ],
      save_with: ['add_evidence'],
      verified_by: 'data',
    },
    {
      key: 'target_roles',
      what: 'The kinds of role to target, in priority order',
      done: saved.has('archetypes'),
      why: 'These drive scoring and which master a role is tailored from.',
      ask: [
        'Show the archetypes from get_config and ask which to target, in priority order, and what is missing. Save with put_config "archetypes"; keep term lists specific enough that roles do not route to the wrong archetype.',
      ],
      save_with: ['put_config'],
      verified_by: 'saved',
    },
    {
      key: 'target_cities',
      what: 'Cities to search in',
      done: answered.has('target_cities') && (prefs.target_cities?.length ?? 0) > 0,
      why: 'Each city is searched, and a role outside them that is not remote is filtered out entirely.',
      ask: [
        'Ask which cities. For each: the search location (e.g. "New York, NY") and the words that mean that city in a posting (e.g. new york, nyc, manhattan, brooklyn). Remote roles are always considered.',
        'Tell them searches per day are queries times cities.',
      ],
      save_with: ['set_preferences'],
      verified_by: 'saved',
    },
    {
      key: 'preferences',
      what: 'Pay, work mode, and what you will not do',
      done: answered.has('work_modes') && answered.has('comp_floor')
        && (prefs.work_modes?.length ?? 0) > 0,
      why: 'A comp floor filters postings that state less; ruled-out industries are filtered however well the role matches.',
      ask: [
        'Work modes they accept: remote, hybrid, onsite.',
        'Comp floor (base below which a role is not worth applying to) and comp target (what they would say if asked).',
        'Company stages and industries they prefer, industries to avoid, and any dealbreakers.',
        'Relocation, sponsorship, earliest start date. These also fill the matching application answers.',
      ],
      save_with: ['set_preferences'],
      verified_by: 'saved',
    },
    {
      key: 'sources',
      what: 'Platforms to search',
      done: answered.has('sources') && chosen.length > 0,
      why: 'Each platform is reached differently. Some are built in, some need a connector, some a paid key, and some are not supported.',
      ask: [
        'Call get_source_catalog and ask which platforms to search. Be plain about how each is reached, what it costs, and which are not supported yet. Recommend company boards first.',
      ],
      save_with: ['set_preferences'],
      verified_by: 'saved',
    },
    {
      key: 'connectors',
      what: 'Connectors and keys for the platforms you chose',
      done: needsSetup.length === 0 || (searchRuns.results.length > 0 && connectorsProven),
      why: 'A platform that needs a connector returns nothing until it is installed, which looks exactly like a quiet day.',
      ask: [
        'Point them to the dashboard, Setup, "Connect Claude": it lists everything below with copy buttons and downloads, and always shows the current versions.',
        'For each chosen platform that needs a claude.ai connector (get_source_catalog says which), walk them through adding it in claude.ai: Settings, Connectors.',
        'Feature connectors: Gmail on the account they apply from (follow-up drafts), and Claude in Chrome for auto-filling applications and for the browser-only platforms (Handshake, Wellfound, any job page).',
        'After this connector is updated, they refresh its tool list in claude.ai (Settings, Connectors, JobHunt) so new tools appear; reconnecting is only needed if refreshing does not show them.',
        'This step completes itself once a search run logs results from the connector platforms.',
      ],
      save_with: [],
      verified_by: 'data',
    },
    {
      key: 'claude_skills',
      what: 'The four JobHunt skills added to Claude',
      done: confirmed.has('claude_skills'),
      why: 'The scheduled document build runs on tailored-resume and tailored-cover-letter; job-extract reads roles from Handshake and other sites in the browser; application-autofill fills application forms. Without the first two the build run stops.',
      ask: [
        'get_scheduled_task_prompts returns the four skill downloads (skills). Give the person the links: they open in their signed-in browser. The dashboard, Setup, "Connect Claude" has the same download buttons.',
        'They upload each zip in claude.ai, Settings, Capabilities, Skills (the same skills reach Cowork). Uploading replaces an older copy with the same name.',
        'Once they say all four are uploaded, call confirm_setup_step with step "claude_skills" and their words. You cannot check this from here, so do not mark it done on a guess.',
      ],
      save_with: ['get_scheduled_task_prompts', 'confirm_setup_step'],
      verified_by: 'confirmed',
    },
    {
      key: 'target_boards',
      what: 'Companies whose own job boards to watch',
      done: !chosen.includes('company_boards') || boardCount > 0,
      why: 'The freshest and least contested postings, and the list is empty by default.',
      ask: [
        'Ask which companies to watch. For each, find its board: try it on Greenhouse, Lever and Ashby with search_company_boards with `boards` set to just that candidate and `ingest` false (a preview, nothing is added), and keep only slugs that return postings. Save with put_config "target_boards" as "slug:Display Name" entries, sending the complete value.',
      ],
      save_with: ['search_company_boards', 'put_config'],
      verified_by: 'saved',
    },
    {
      key: 'application_answers',
      what: 'Application answers with nothing left as CONFIRM',
      done: (placeholders?.n ?? 0) === 0,
      why: 'Auto-fill types these into real forms, so a placeholder would be submitted to an employer.',
      ask: [
        'Call get_application_profile and fill anything still "CONFIRM" with put_application_profile. Never store demographic or EEO answers; those stay theirs to answer on the form.',
      ],
      save_with: ['get_application_profile', 'put_application_profile'],
      verified_by: 'data',
    },
    {
      key: 'goals',
      what: 'At least one goal with a number in it',
      done: (goals?.n ?? 0) > 0,
      why: 'Without a target the weekly review reports activity, not whether the search is working.',
      ask: ['Agree at least one countable goal, usually applications per week. Push back on goals with no number.'],
      save_with: ['set_goal'],
      verified_by: 'data',
    },
    {
      key: 'plan',
      what: 'A written plan',
      done: Boolean(cfg.plan?.trim()),
      why: 'Documents and advice build on what was already decided instead of reopening it every session.',
      ask: [
        'Draft it with them, not for them: positioning per archetype drawn only from confirmed evidence, weekly cadence tied to the goals, and what they have decided not to chase. Save with put_plan.',
      ],
      save_with: ['put_plan'],
      verified_by: 'saved',
    },
    {
      key: 'scheduled_runs',
      what: 'The four scheduled runs set up, and the search run once',
      done: searchRuns.results.length > 0,
      why: 'This is what makes it run without you. Running the search once by hand also approves its tool permissions, so scheduled runs do not stall on a prompt.',
      ask: [
        'The four runs (daily search, daily sweep, document build, weekly review) are scheduled tasks that run in the cloud with the computer off (Claude Cowork). Call get_scheduled_task_prompts: it returns each task\'s title, schedule and prompt, and how to set them up.',
        'Create them now if you can: when this session has a way to create scheduled tasks (Cowork\'s scheduled tasks, or the scheduled-tasks tool in Claude Code), list the existing tasks, then update the one with the same title or create it, with the title, schedule and prompt exactly as returned. Tell the person what you created or changed.',
        'If you cannot create tasks here, hand the person the four as copy-paste blocks (title, frequency, prompt) and point them to the dashboard, Setup, "Connect Claude", which has copy buttons. In Cowork: Scheduled, New task, Set up manually.',
        'Either way: the approval mode must let tools run without asking, or every run stalls. Never leave two copies of a task, or every run happens twice.',
        'Then run the search task once (Run now). That completes this step, and usually the connectors step too.',
      ],
      save_with: ['get_scheduled_task_prompts'],
      verified_by: 'data',
    },
    {
      key: 'first_roles',
      what: 'Roles in the pipeline',
      done: (jobs?.n ?? 0) > 0,
      why: 'Proves search, scoring and dedupe work end to end.',
      ask: ['Complete once a search run or a hand-added role puts something in the pipeline.'],
      save_with: ['add_role'],
      verified_by: 'data',
    },
  ];

  const next = steps.find((s) => !s.done) ?? null;
  const done = steps.filter((s) => s.done).length;
  return {
    complete: done === steps.length,
    done,
    total: steps.length,
    next: next ? { key: next.key, what: next.what, ask: next.ask, save_with: next.save_with } : null,
    steps,
  };
}

function parseList(v: string | null | undefined): string[] {
  try {
    const x = JSON.parse(v ?? '[]');
    return Array.isArray(x) ? x.map(String) : [];
  } catch {
    return [];
  }
}

/** Steps the server cannot check for itself, which the person marks done. */
export const CONFIRMABLE_STEPS = ['claude_skills'] as const;
export type ConfirmableStep = typeof CONFIRMABLE_STEPS[number];

export async function confirmSetupStep(db: D1Like, step: ConfirmableStep, done = true): Promise<string[]> {
  if (!CONFIRMABLE_STEPS.includes(step)) throw new Error(`"${step}" is checked from real activity, not confirmed`);
  const row = await db.prepare("SELECT value FROM config WHERE key = 'setup_confirmed'").first<{ value: string }>();
  const set = new Set(parseList(row?.value));
  if (done) set.add(step); else set.delete(step);
  const list = [...set];
  await putConfig(db, 'setup_confirmed', list, 'setup steps the person confirmed (skills uploaded)');
  return list;
}
