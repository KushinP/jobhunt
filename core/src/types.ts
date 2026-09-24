export type JobStatus =
  | 'New' | 'Generate' | 'Complete' | 'Applied' | 'Interviewing' | 'Offer'
  | 'Rejected' | 'Skip' | 'Unverified' | 'Dead link' | 'Discarded';

/** Statuses that mean a human made a judgement. Automation may never write these. */
export const HUMAN_ONLY_STATUSES: readonly JobStatus[] =
  ['Applied', 'Interviewing', 'Offer', 'Rejected'] as const;

/** 'human': a click in the dashboard. 'human-via-chat': Claude acting on the person's own words
 * in a chat, quoted in the note. 'automation': a scheduled run or the scorer. */
export type Actor = 'human' | 'human-via-chat' | 'automation';

export interface RawJob {
  title: string;
  company: string;
  location?: string | null;
  salary?: string | null;
  url?: string | null;
  source?: string | null;
  source_job_id?: string | null;
  posted_at?: string | null;
  jd_text?: string | null;
  /** the application deadline, YYYY-MM-DD */
  closes_at?: string | null;
  /** "stated": the posting names a deadline; "listing": when the listing expires, which job
   * boards set on their own (LinkedIn: 30 days after posting); "you": set in the dashboard */
  closes_source?: ClosesSource | null;
}

export type ClosesSource = 'stated' | 'listing' | 'you';

export interface ScoreBreakdown {
  title: number;
  domain: number;
  skill: number;
  seniority: number;
  location: number;
  /** the lowest minimum experience the JD states, when it states one */
  years_required?: number;
}

export interface ScoreResult {
  score: number;
  excluded: boolean;
  archetype: number | null;
  breakdown: ScoreBreakdown | Record<string, never>;
  remote: boolean;
  level_mismatch: boolean;
  drop_reason: string | null;
  auto_generate: boolean;
  /** scored from the title alone: provisional until the job description is attached */
  needs_jd: boolean;
}

export interface Archetype {
  id: number;
  name: string;
  title_terms: string[];
  domain_terms: string[];
  skill_terms: string[];
}

export interface Weights {
  title: number; domain: number; skill: number; seniority: number; location: number;
}

export interface Config {
  weights: Weights;
  thresholds: { hard_cutoff: number; auto_generate: number };
  /** Location points for a fully remote role. Local roles get weights.location. */
  remote_location_points: number;
  archetypes: Archetype[];
  exclude_terms_title: string[];
  exclude_terms_any: string[];
  override_terms: string[];
  locations_local: string[];
  remote_terms: string[];
  remote_jd_terms: string[];
  /** a location naming any of these is outside the US, even when it also says remote */
  non_us_terms: string[];
  /** JD phrases that mean office time is required, which outrank a remote phrase in the JD */
  onsite_jd_terms: string[];
  disqualifying_senior_terms: string[];
  too_senior_terms: string[];
  /** a JD whose stated minimum experience is above this is a level mismatch */
  max_years_required: number;
  base_resume_map: Record<string, string>;
  query_set: { q: string; archetype: number; scope: 'local' | 'remote' | 'both' }[];
  search_defaults: {
    country_code: string; local_location: string; remote_location: string;
    job_type: string; freshness_days: number;
  };
  target_boards: { greenhouse: string[]; lever: string[]; ashby: string[] };
  follow_up_rules: { no_response_days: number; thank_you_days: number };
  /** The written job-search plan: positioning, narrative, weekly cadence. Markdown. */
  plan: string;
  identity: {
    name: string; email: string; phone: string; city: string;
    linkedin: string; contact_line: string;
  };
  output_rules: {
    page_cap: number; page_cap_exception_archetype: number; page_cap_exception: number;
    words_per_page: number; font: string; body_pt: number; body_color: string;
    accent_color: string; no_em_dashes: boolean; date_range_format: string;
    section_order: string[];
  };
  preferences: Preferences;
}

export type WorkMode = 'remote' | 'hybrid' | 'onsite';

/** What makes a role acceptable, beyond what it is. Captured once at onboarding. */
export interface Preferences {
  work_modes: WorkMode[];
  /** base salary in USD below which a role is not worth applying to; filters when stated */
  comp_floor: number | null;
  /** the number you would say if asked; also fills the salary answer on forms */
  comp_target: number | null;
  company_stages: string[];
  industries_prefer: string[];
  /** matched against the JD like an exclusion term */
  industries_avoid: string[];
  relocation: 'no' | 'yes' | 'for_the_right_role' | null;
  sponsorship_needed: boolean | null;
  earliest_start: string | null;
  dealbreakers: string[];
  /** which platforms to search, by catalog id */
  sources: string[];
  /** where to look. Each city is searched, and its match terms count as local when scoring. */
  target_cities: TargetCity[];
  notes: string;
  /** which fields the person has actually answered. A field with a default is not an
   * answer, so onboarding checks this rather than whether a value exists. */
  answered: string[];
}

export interface TargetCity {
  name: string;
  /** passed to search sources, e.g. "New York, NY" */
  search: string;
  /** words in a posting's location that mean this city, e.g. ["new york", "nyc", "brooklyn"] */
  match: string[];
}

export interface IngestResult {
  found: number;
  kept: number;
  auto_generate: number;
  duplicates: number;
  discarded: number;
  errors: { reason: string; raw: unknown }[];
  inserted: {
    id: string; title: string; company: string; score: number; status: JobStatus;
    needs_jd: boolean;
  }[];
}
