import type { Config } from './types.ts';

/**
 * Defaults live in code so they are version-controlled and reviewable; the `config`
 * table overrides any key at runtime, so tuning the rubric never needs a deploy.
 * Mirror of ~/jobhunt/00_Admin/CLAUDE.md. If the two disagree, that is a bug.
 */
export const DEFAULT_CONFIG: Config = {
  weights: { title: 20, domain: 25, skill: 20, seniority: 20, location: 15 },
  thresholds: { hard_cutoff: 60, auto_generate: 75 },
  remote_location_points: 10,

  // Filled during onboarding and stored in the config table; these defaults only show the
  // shape. The contact line is printed verbatim at the top of every document.
  identity: {
    name: '',
    email: '',
    phone: '',
    city: '',
    linkedin: '',
    contact_line: '',
  },

  output_rules: {
    page_cap: 1,
    page_cap_exception_archetype: 1,
    page_cap_exception: 2,
    words_per_page: 330,
    font: 'Calibri',
    body_pt: 11,
    body_color: '2F2F2F',
    accent_color: '1F4E79',
    no_em_dashes: true,
    date_range_format: 'MM/YYYY - MM/YYYY',
    section_order: ['Contact', 'Education', 'Work Experience', 'Leadership Experience', 'Skills'],
  },

  // An example metro: onboarding replaces this with the words that mean the person's own
  // cities. A posting whose location matches none of these, and is not remote, is filtered.
  locations_local: [
    'boston', 'cambridge', 'brookline', 'somerville', 'newton', 'waltham',
    'massachusetts', 'greater boston', 'ma',
  ],
  remote_terms: ['remote', 'anywhere', 'distributed', 'work from anywhere'],
  remote_jd_terms: ['fully remote', 'remote-first', 'work from home', '100% remote', 'remote position'],
  onsite_jd_terms: [
    'days in the office', 'days per week in the office', 'days a week in the office',
    'days in office', 'in-office', 'hybrid',
  ],
  non_us_terms: [
    'canada', 'toronto', 'vancouver', 'montreal', 'british columbia', 'ontario', 'mexico',
    'brazil', 'latam', 'united kingdom', 'uk', 'england', 'london', 'dublin', 'ireland',
    'europe', 'emea', 'germany', 'berlin', 'munich', 'france', 'paris', 'spain', 'madrid',
    'barcelona', 'netherlands', 'amsterdam', 'poland', 'switzerland', 'zurich', 'israel',
    'tel aviv', 'india', 'bangalore', 'bengaluru', 'hyderabad', 'pune', 'mumbai', 'delhi',
    'apac', 'singapore', 'japan', 'tokyo', 'korea', 'seoul', 'australia', 'sydney',
    'melbourne', 'philippines', 'manila',
  ],

  disqualifying_senior_terms: [
    'vp', 'vice president', 'svp', 'evp', 'chief', 'managing director', 'head of',
    'partner', 'c-suite',
  ],
  too_senior_terms: [
    'director', 'principal', 'senior manager', 'lead', 'leader', 'senior', 'sr', 'staff',
    'manager', 'iii',
  ],
  // About two years out of school. A JD asking three or more waits in New for a person to
  // judge rather than being queued for documents.
  max_years_required: 2,

  exclude_terms_title: [
    'internship', 'intern', 'co-op', 'coop', 'apprentice', 'apprenticeship', 'fellowship',
    'volunteer', 'unpaid', 'commission only', 'door to door', 'door-to-door',
    'insurance agent', 'life insurance', 'financial advisor trainee', 'summer analyst',
    // Adjacent functions whose titles share a target word ("Software Engineer, AI
    // Enablement", "Recruiter, Mergers & Acquisitions", "Data Scientist, Real Estate").
    // "engineer" is read outside target phrases, so "Solutions Engineer" survives it.
    'engineer', 'architect', 'forward deployed', 'fde', 'data scientist', 'research scientist',
    'full stack', 'backend', 'frontend', 'accountant', 'accounting', 'recruiter', 'recruiting',
    'talent', 'workplace', 'construction', 'account executive', 'sales development', 'bdr',
    'sdr', 'it solutions', 'it support', 'it operations', 'part-time', 'part time',
  ],
  exclude_terms_any: [
    'security clearance', 'top secret', 'ts/sci', 'multi-level marketing',
    'door-to-door canvassing',
  ],
  override_terms: [
    'rotational analyst program', 'analyst development program', 'associate product manager',
    'new grad analyst', 'new grad associate', 'early career analyst',
  ],

  archetypes: [
    {
      id: 1,
      name: 'AI implementation / deployment',
      title_terms: [
        'ai implementation', 'implementation consultant', 'solutions consultant', 'ai solutions',
        'implementation manager', 'ai strategy',
        'ai adoption', 'ai enablement', 'deployment strategist', 'technical account manager',
        'customer solutions', 'ai consultant', 'solutions engineer', 'implementation specialist',
      ],
      domain_terms: [
        'artificial intelligence', 'ai', 'machine learning', 'llm', 'genai', 'generative ai',
        'automation', 'saas', 'b2b', 'workflow', 'digital transformation', 'platform',
        'integration', 'onboarding', 'customer success',
      ],
      skill_terms: [
        'stakeholder', 'cross-functional', 'product', 'roadmap', 'implementation', 'discovery',
        'requirements', 'training', 'change management', 'client-facing', 'presentation',
        'go-to-market', 'gtm',
      ],
    },
    {
      id: 2,
      name: 'CRE acquisitions / development',
      title_terms: [
        'real estate', 'acquisitions', 'development analyst', 'asset management',
        'investments analyst', 'dispositions', 'acquisitions analyst',
      ],
      domain_terms: [
        'commercial real estate', 'multifamily', 'industrial', 'retail', 'office',
        'entitlement', 'ground-up', 'development', 'property', 'lease', 'joint venture',
        'brokerage', 'mixed-use',
      ],
      skill_terms: [
        'underwriting', 'argus', 'financial modeling', 'excel', 'market research',
        'due diligence', 'cash flow', 'valuation', 'cap rate', 'net operating income',
        'rent roll', 'pro forma',
      ],
    },
    {
      id: 3,
      name: 'CRE private credit / capital markets',
      title_terms: [
        'credit analyst', 'capital markets', 'private credit', 'credit associate',
        'structured finance', 'debt capital markets', 'loan analyst',
      ],
      domain_terms: [
        'commercial real estate', 'private credit', 'mezzanine', 'bridge loan', 'cmbs',
        'securitization', 'originations', 'senior loan', 'debt fund', 'balance sheet',
      ],
      skill_terms: [
        'credit memo', 'underwriting', 'debt service coverage', 'dscr', 'loan sizing',
        'financial modeling', 'covenant', 'risk rating', 'cash flow',
      ],
    },
    {
      id: 4,
      name: 'Startup strategic finance / BizOps',
      title_terms: [
        'strategic finance', 'business operations', 'biz ops', 'chief of staff',
        'revenue operations', 'fp&a', 'finance associate', 'corporate strategy',
        'strategy associate', 'operations analyst', 'business analyst', 'bizops',
        'strategy & operations', 'strategy and operations', 'strategy & ops',
        "founder's associate", 'founders associate', 'founder associate', 'strategic projects',
        'special projects', 'operations associate', 'founding operations',
        'operations generalist', 'founding generalist',
      ],
      domain_terms: [
        'startup', 'series a', 'series b', 'venture-backed', 'saas', 'arr', 'forecasting',
        'budgeting', 'pricing', 'unit economics', 'board', 'fundraising', 'go-to-market', 'gtm',
        // BizOps and chief-of-staff JDs, measured on 47 real postings 2026-09-18
        'high-growth', 'scaling', 'strategic initiatives', 'operating cadence', 'early-stage',
        'ceo', 'founder', 'founders', 'y combinator', 'okrs',
      ],
      skill_terms: [
        'financial modeling', 'excel', 'sql', 'dashboard', 'kpi', 'variance', 'forecast',
        'business case', 'cross-functional', 'analysis', 'metrics', 'reporting', 'insights',
        'analytics', 'prioritization', 'project management', 'process improvement',
      ],
    },
    {
      id: 5,
      name: 'Early-stage VC (secondary)',
      title_terms: [
        'venture capital', 'investment analyst', 'investment associate', 'sourcing analyst',
        'platform associate',
      ],
      domain_terms: [
        'venture', 'early-stage', 'pre-seed', 'seed', 'portfolio', 'startups', 'deal flow',
        'thesis', 'fund',
      ],
      skill_terms: ['sourcing', 'diligence', 'market map', 'thesis', 'financial modeling', 'founder'],
    },
  ],

  base_resume_map: {
    '1': 'Base_Resume_AI_Implementation.docx',
    '2': 'Base_Resume_CRE.docx',
    '3': 'Base_Resume_CRE_Credit.docx',
    '4': 'Base_Resume_StrategicFinance.docx',
    '5': 'Base_Resume_VC.docx',
    fallback: 'Base_Resume_AI_Implementation.docx',
  },

  query_set: [
    { q: 'AI Implementation Consultant', archetype: 1, scope: 'both' },
    { q: 'AI Solutions Consultant', archetype: 1, scope: 'both' },
    { q: 'Implementation Specialist', archetype: 1, scope: 'local' },
    { q: 'AI Strategy Associate', archetype: 1, scope: 'remote' },
    { q: 'Real Estate Acquisitions Analyst', archetype: 2, scope: 'local' },
    { q: 'Real Estate Development Analyst', archetype: 2, scope: 'local' },
    { q: 'Commercial Real Estate Credit Analyst', archetype: 3, scope: 'local' },
    { q: 'Debt Capital Markets Analyst', archetype: 3, scope: 'local' },
    { q: 'Strategic Finance Analyst', archetype: 4, scope: 'both' },
    { q: 'Business Operations Analyst', archetype: 4, scope: 'both' },
    { q: 'Chief of Staff startup', archetype: 4, scope: 'local' },
    { q: 'Strategy and Operations Associate', archetype: 4, scope: 'both' },
    { q: 'Venture Capital Analyst', archetype: 5, scope: 'local' },
  ],

  search_defaults: {
    country_code: 'US',
    local_location: 'Boston, MA',
    remote_location: 'remote',
    job_type: 'fulltime',
    freshness_days: 14,
  },

  target_boards: { greenhouse: [], lever: [], ashby: [] },
  follow_up_rules: { no_response_days: 10, thank_you_days: 1 },

  plan: '',

  preferences: {
    work_modes: [],
    comp_floor: null,
    comp_target: null,
    company_stages: [],
    industries_prefer: [],
    industries_avoid: [],
    relocation: null,
    sponsorship_needed: null,
    earliest_start: null,
    dealbreakers: [],
    sources: ['company_boards', 'yc', 'indeed', 'manual'],
    target_cities: [{
      name: 'Boston',
      search: 'Boston, MA',
      match: ['boston', 'cambridge', 'somerville', 'brookline', 'newton', 'waltham',
        'greater boston', 'massachusetts'],
    }],
    notes: '',
    answered: [],
  },
};

export interface ConfigStore { key: string; value: string }

/** DB rows override defaults key by key. A malformed row is ignored, not fatal: a bad
 * config edit must not take the whole pipeline down. */
export function mergeConfig(rows: ConfigStore[]): Config {
  const out: Config = structuredClone(DEFAULT_CONFIG);
  for (const row of rows ?? []) {
    if (!(row.key in out)) continue;
    try {
      (out as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value);
    } catch {
      // keep the default
    }
  }
  return out;
}
