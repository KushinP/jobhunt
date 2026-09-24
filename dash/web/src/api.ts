export interface Job {
  id: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  url: string | null;
  source: string;
  score: number | null;
  score_breakdown: string | null;
  archetype: number | null;
  status: string;
  created_at: string;
  /** when the role last changed status */
  status_changed_at?: string | null;
  posted_at?: string | null;
  applied_at: string | null;
  /** the application deadline, YYYY-MM-DD */
  closes_at?: string | null;
  /** "stated" by the posting, the "listing" expiry a job board sets, or set by "you" */
  closes_source?: 'stated' | 'listing' | 'you' | null;
  next_interview_at: string | null;
  interview_count: number;
  resume_count: number;
  cl_count: number;
  followups_due: number;
  drop_reason: string | null;
  rating: number | null;
  rating_gap: number | null;
  /** the profile of the company this role is at, when it has one */
  company_industry?: string | null;
  company_stage?: string | null;
  company_priority?: 'target' | 'neutral' | 'avoid';
  jd_text?: string | null;
  notes?: string | null;
}

export interface TrashedJob {
  id: string; title: string; company: string; location: string | null; source: string;
  score: number | null; status: string; reason: string | null;
  created_at: string; status_changed_at: string | null;
}

export interface Resolved {
  ok: boolean; reason?: string; via: 'greenhouse' | 'lever' | 'yc' | 'schema' | 'page' | 'none';
  url: string; title: string | null; company: string | null; location: string | null;
  salary: string | null; jd_text: string | null;
  posted_at?: string | null; closes_at?: string | null; closes_source?: 'stated' | 'listing' | null;
  existing: { id: string; status: string; score: number } | null;
}

export interface Watched { ats: string; slug: string }

export type Priority = 'target' | 'neutral' | 'avoid';

export interface CompanyProfile {
  name: string; industry: string | null; stage: string | null; priority: Priority;
  tags: string[]; website: string | null; notes: string | null;
  categorized_by: 'you' | 'claude' | 'source' | null;
}

export interface CompanyRow {
  name: string; total: number; active: number; queued: number; applied: number;
  best_score: number | null; last_seen: string; sources: string | null; watched: Watched | null;
  industry: string | null; stage: string | null; priority: Priority; tags: string[];
  categorized_by: 'you' | 'claude' | 'source' | null;
}

export interface DocRow {
  id: string; job_id: string; kind: string; filename: string; byte_size: number;
  page_count: number | null; page_count_verified: number; base_resume: string | null;
  generated_at: string; title: string; company: string; status: string; submitted: number;
}

export interface JobDetail {
  job: Job;
  documents: {
    id: string; kind: string; filename: string; page_count: number | null;
    page_count_verified: number; base_resume: string | null; sha256: string | null;
    generated_at: string;
  }[];
  history: { from_status: string | null; to_status: string; actor: string; at: string }[];
  interviews: {
    id: string; round: string; interviewer: string | null; interviewer_title: string | null;
    scheduled_at: string | null; outcome: string; hit_rate: number | null; debrief_at: string | null;
  }[];
  /** instructions for building this one role now, prefilled into a Claude chat */
  build_prompt: string;
}

export interface Bootstrap {
  identity: { name: string; email: string };
  thresholds: { hard_cutoff: number; auto_generate: number };
  archetypes: { id: number; name: string }[];
  counts: { status: string; n: number }[];
  followups_due: number;
  onboarding_outstanding: number;
  industries: string[];
  stages: string[];
  /** where this instance's connector lives, from the server's PUBLIC_MCP_URL */
  connector_url: string | null;
}

export interface Metrics {
  weekly: { week: string; found: number; applied: number; interviews: number }[];
  rating_calibration: {
    rating: number; rated: number; avg_score: number | null; applied: number;
    reached_interview: number; interview_rate_pct: number | null;
  }[];
  agreement: { rated: number; avg_gap: number | null; agree: number } | null;
  sources: {
    source: string; found: number; kept: number; applied: number;
    reached_interview: number; interview_rate_pct: number | null;
  }[];
  calibration: {
    score_band: string; scored: number; applied: number;
    reached_interview: number; interview_rate_pct: number | null;
  }[];
}

export interface FollowUp {
  id: string; kind: string; due_at: string; job_id: string; title: string;
  company: string; url: string | null; applied_at: string | null; portal_url: string | null;
}

export interface Run {
  id: string; kind: string; started_at: string; finished_at: string | null;
  found: number; kept: number; duplicates: number; dropped: number;
  sources_used: string | null; sources_unavailable: string | null;
  errors: string | null; summary: string | null;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
    throw new Error(body.error ?? `${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  session: () => req<{ authed: boolean }>('/api/session'),
  logout: () => req<{ ok: true }>('/api/logout', { method: 'POST' }),
  bootstrap: () => req<Bootstrap>('/api/bootstrap'),
  jobs: (params: { status?: readonly string[]; q?: string; company?: string } = {}) => {
    const qs = new URLSearchParams();
    if (params.status?.length) qs.set('status', params.status.join(','));
    if (params.q) qs.set('q', params.q);
    if (params.company) qs.set('company', params.company);
    return req<{ rows: Job[]; total: number }>(`/api/jobs${qs.toString() ? `?${qs}` : ''}`);
  },
  companies: () => req<CompanyRow[]>('/api/companies'),
  company: (name: string) => req<{ name: string; watched: Watched | null; roles: Job[]; profile: CompanyProfile | null }>(
    `/api/companies/${encodeURIComponent(name)}`),
  saveCompany: (name: string, patch: Partial<Omit<CompanyProfile, 'name' | 'categorized_by'>>) =>
    req<CompanyProfile>(`/api/companies/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(patch) }),
  documents: () => req<DocRow[]>('/api/documents'),
  deleteDocument: (id: string) =>
    req<{ job_id: string; status: string }>(`/api/documents/${id}`, { method: 'DELETE' }),
  job: (id: string) => req<JobDetail>(`/api/jobs/${id}`),
  trash: () => req<TrashedJob[]>('/api/trash'),
  setStatus: (id: string, status: string, note?: string) =>
    req<unknown>(`/api/jobs/${id}/status`, {
      method: 'POST', body: JSON.stringify({ status, note }),
    }),
  apply: (id: string, portal_url?: string, notes?: string) =>
    req<unknown>(`/api/jobs/${id}/apply`, {
      method: 'POST', body: JSON.stringify({ portal_url, notes }),
    }),
  setRating: (id: string, rating: number | null) =>
    req<unknown>(`/api/jobs/${id}/rating`, {
      method: 'POST', body: JSON.stringify({ rating }),
    }),
  addJob: (job: {
    title: string; company: string; location?: string; url?: string;
    salary?: string; jd_text?: string; rating?: number | null; queue?: boolean;
    posted_at?: string | null; closes_at?: string | null; closes_source?: 'stated' | 'listing' | null;
  }) => req<{ id: string; score: number; status: string; duplicate: boolean; drop_reason: string | null }>(
    '/api/jobs', { method: 'POST', body: JSON.stringify(job) }),
  fetchJd: (url: string) => req<Resolved>('/api/fetch-jd', { method: 'POST', body: JSON.stringify({ url }) }),
  setDetails: (id: string, patch: { salary?: string | null; location?: string | null; url?: string | null }) =>
    req<{ salary: string | null; location: string | null; url: string | null }>(`/api/jobs/${id}/details`, {
      method: 'POST', body: JSON.stringify(patch),
    }),
  setCloses: (id: string, closes_at: string | null) =>
    req<{ closes_at: string | null; closes_source: string | null }>(`/api/jobs/${id}/closes`, {
      method: 'POST', body: JSON.stringify({ closes_at }),
    }),
  saveNotes: (id: string, notes: string) =>
    req<unknown>(`/api/jobs/${id}/notes`, { method: 'POST', body: JSON.stringify({ notes }) }),
  metrics: () => req<Metrics>('/api/metrics'),
  followups: () => req<FollowUp[]>('/api/followups'),
  completeFollowup: (id: string) =>
    req<unknown>(`/api/followups/${id}/done`, { method: 'POST' }),
  runs: () => req<Run[]>('/api/runs'),
};

export interface SetupData {
  onboarding: {
    complete: boolean; done: number; total: number;
    next: { key: string; what: string } | null;
    /** verified_by 'confirmed': the server cannot check it, so the person marks it done */
    steps: { key: string; done: boolean; what: string; why: string; verified_by?: 'data' | 'saved' | 'confirmed' }[];
  };
  base_resumes: {
    id: string; label: string; archetype: number | null; filename: string;
    byte_size: number; sha256: string | null; active: number; uploaded_at: string;
    has_text: number;
  }[];
  goals: {
    id: string; kind: string; title: string; target_value: number | null; unit: string | null;
    due_at: string | null; status: string; notes: string | null;
    current_value: number | null; measurable: number;
  }[];
  plan: string;
  profile: { field: string; value: string; category: string }[];
  config: {
    identity: Record<string, string>;
    thresholds: { hard_cutoff: number; auto_generate: number };
    archetypes: { id: number; name: string; title_terms: string[]; domain_terms: string[]; skill_terms: string[] }[];
    target_boards: { greenhouse: string[]; lever: string[]; ashby: string[] };
    locations_local: string[];
    query_set: { q: string; archetype: number; scope: string }[];
    exclude_terms_title: string[];
    override_terms: string[];
    base_resume_map: Record<string, string>;
  };
}

export interface SetupTask {
  task_id: string; title: string; description: string; cron: string; prompt: string; cadence: string;
}
export interface SetupFile { name: string; description: string | null; bytes: number; updated_at: string }

export const setupApi = {
  get: () => req<SetupData>('/api/setup'),
  tasks: () => req<SetupTask[]>('/api/setup/tasks'),
  files: () => req<SetupFile[]>('/api/setup/files'),
  confirmStep: (step: string, done = true) =>
    req<{ confirmed: string[] }>('/api/setup/confirm', { method: 'POST', body: JSON.stringify({ step, done }) }),
  uploadBaseResume: (b: {
    label: string; filename: string; content_base64: string; archetype: number | null;
  }) => req<{ id: string; replaced: boolean; text_extracted: boolean; text_reason?: string }>(
    '/api/base-resumes', { method: 'POST', body: JSON.stringify(b) }),
  deleteBaseResume: (id: string) =>
    req<unknown>(`/api/base-resumes/${id}`, { method: 'DELETE' }),
  saveGoal: (g: {
    id?: string; kind?: string; title?: string; target_value?: number | null;
    unit?: string; due_at?: string; status?: string; notes?: string;
  }) => req<{ id: string }>('/api/goals', { method: 'POST', body: JSON.stringify(g) }),
  deleteGoal: (id: string) => req<unknown>(`/api/goals/${id}`, { method: 'DELETE' }),
  savePlan: (plan: string) =>
    req<unknown>('/api/plan', { method: 'POST', body: JSON.stringify({ plan }) }),
  saveConfig: (key: string, value: unknown) =>
    req<unknown>('/api/config', { method: 'POST', body: JSON.stringify({ key, value }) }),
  saveProfile: (entries: { field: string; value: string; category: string }[]) =>
    req<{ saved: number; refused: string[] }>('/api/profile', {
      method: 'POST', body: JSON.stringify({ entries }),
    }),
};

export interface FlowNode {
  id: string; label: string; depth: number; count: number;
  tone: 'progress' | 'win' | 'loss' | 'idle' | 'stalled';
  parent: string | null; statuses?: string[]; ids: string[];
}
export interface Flow {
  nodes: FlowNode[];
  links: { source: string; target: string; value: number }[];
  total: number;
}
export const flowApi = { get: () => req<Flow>('/api/flow') };

export interface EvidenceItem {
  id: string;
  kind: 'accomplishment' | 'project' | 'skill' | 'metric' | 'story' | 'credential' | 'boundary';
  title: string;
  detail: string | null;
  context: string | null;
  ownership: 'built_myself' | 'led' | 'contributed' | 'team' | null;
  level: string | null;
  start_date: string | null;
  end_date: string | null;
  metrics: string | null;
  tools: string[];
  archetypes: number[];
  proof_url: string | null;
  source: 'resume' | 'user' | 'document' | 'repo';
  source_ref: string | null;
  status: 'unconfirmed' | 'confirmed' | 'rejected';
  notes: string | null;
}

export interface TargetCity { name: string; search: string; match: string[] }

export interface PreferencesData {
  preferences: {
    work_modes: string[]; comp_floor: number | null; comp_target: number | null;
    company_stages: string[]; industries_prefer: string[]; industries_avoid: string[];
    relocation: string | null; sponsorship_needed: boolean | null; earliest_start: string | null;
    dealbreakers: string[]; sources: string[]; target_cities: TargetCity[]; notes: string;
  };
  sources: {
    id: string; name: string; status: string; how: string; setup: string[]; cost: string;
    notes?: string;
  }[];
  feature_connectors: { id: string; name: string; for: string; setup: string }[];
  query_count: number;
}

export const evidenceApi = {
  list: () => req<{ items: EvidenceItem[]; summary: Record<string, Record<string, number>> }>('/api/evidence'),
  save: (e: Partial<EvidenceItem> & { kind: string; title: string }) =>
    req<{ id: string }>('/api/evidence', { method: 'POST', body: JSON.stringify(e) }),
  setStatus: (id: string, status: string, note?: string) =>
    req<unknown>(`/api/evidence/${id}/status`, { method: 'POST', body: JSON.stringify({ status, note }) }),
  remove: (id: string) => req<unknown>(`/api/evidence/${id}`, { method: 'DELETE' }),
};

export const prefsApi = {
  get: () => req<PreferencesData>('/api/preferences'),
  save: (patch: Record<string, unknown>) =>
    req<{ warnings: string[]; synced_answers: string[] }>('/api/preferences', {
      method: 'POST', body: JSON.stringify(patch),
    }),
};
