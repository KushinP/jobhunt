-- A profile per company, so roles can be filtered by what kind of company they are at, not
-- only by title. Keyed by the company name exactly as it appears on jobs.company. Filled by
-- the person in the dashboard or by Claude from job descriptions; a field the person set is
-- never overwritten by Claude (categorized_by = 'you').
CREATE TABLE companies (
  name           TEXT PRIMARY KEY,
  industry       TEXT,
  stage          TEXT,
  priority       TEXT NOT NULL DEFAULT 'neutral' CHECK (priority IN ('target', 'neutral', 'avoid')),
  tags           TEXT NOT NULL DEFAULT '[]',
  website        TEXT,
  notes          TEXT,
  categorized_by TEXT CHECK (categorized_by IN ('you', 'claude', 'source')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX companies_industry_idx ON companies (industry);
CREATE INDEX jobs_company_idx ON jobs (company);

-- Files the dashboard hands out during setup (the skill zips uploaded to claude.ai). They carry
-- the person's profile, so they live behind sign-in here rather than as public assets.
CREATE TABLE setup_files (
  name        TEXT PRIMARY KEY,
  content_b64 TEXT NOT NULL,
  description TEXT,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
