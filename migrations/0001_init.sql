-- JobHunt OS on D1 (SQLite).
-- What the database enforces: unique dedupe key, "Applied requires a submission record",
-- foreign keys, and the allowed status/enum values.
-- What the application layer enforces (SQLite has no session variables): which actor may
-- write which status, the status history trail, and updated_at.

CREATE TABLE config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,              -- JSON
  note       TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE jobs (
  id                TEXT PRIMARY KEY,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  title             TEXT NOT NULL,
  company           TEXT NOT NULL,
  location          TEXT,
  salary            TEXT,
  url               TEXT,
  source            TEXT NOT NULL,
  source_job_id     TEXT,
  posted_at         TEXT,
  jd_text           TEXT,
  jd_fetched_at     TEXT,
  archetype         INTEGER,
  score             INTEGER,
  score_breakdown   TEXT,                -- JSON
  status            TEXT NOT NULL DEFAULT 'New' CHECK (status IN
                      ('New','Generate','Complete','Applied','Interviewing','Offer',
                       'Rejected','Skip','Unverified','Dead link','Discarded')),
  status_changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  drop_reason       TEXT,
  verified_at       TEXT,
  notes             TEXT,
  -- computed by normalizeKey() in @jobhunt/core; uniqueness is enforced here
  normalized_key    TEXT NOT NULL UNIQUE
);
CREATE INDEX jobs_status_idx  ON jobs (status);
CREATE INDEX jobs_score_idx   ON jobs (score DESC);
CREATE INDEX jobs_created_idx ON jobs (created_at DESC);

CREATE TABLE documents (
  id                  TEXT PRIMARY KEY,
  job_id              TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind                TEXT NOT NULL CHECK (kind IN ('resume','cover_letter')),
  -- The .docx bytes live here rather than in an object store. A resume is ~30KB and a
  -- few hundred of them is ~10MB against D1's 5GB, so R2 (and a payment method on file)
  -- buys nothing at this scale.
  content             BLOB NOT NULL,
  byte_size           INTEGER NOT NULL,
  filename            TEXT NOT NULL,
  base_resume         TEXT,
  word_count          INTEGER,
  page_count          INTEGER,
  page_count_verified INTEGER NOT NULL DEFAULT 0,
  sha256              TEXT,
  spec                TEXT,              -- JSON: the content decisions, for audit
  generated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX documents_job_idx ON documents (job_id, kind);

-- The immutable record of what was actually sent. Replaces 04_Applications/.
CREATE TABLE submissions (
  id                  TEXT PRIMARY KEY,
  job_id              TEXT NOT NULL UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
  applied_at          TEXT NOT NULL DEFAULT (datetime('now')),
  portal_url          TEXT,
  resume_document_id       TEXT REFERENCES documents(id) ON DELETE SET NULL,
  cover_letter_document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
  resume_sha256       TEXT,
  cover_letter_sha256 TEXT,
  method              TEXT,
  notes               TEXT
);

CREATE TABLE interviews (
  id                   TEXT PRIMARY KEY,
  job_id               TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  round                TEXT NOT NULL CHECK (round IN
                         ('recruiter_screen','hiring_manager','case','superday','panel','final')),
  interviewer          TEXT,
  interviewer_title    TEXT,
  interviewer_linkedin TEXT,
  scheduled_at         TEXT,
  format               TEXT,
  prep_ref             TEXT,
  predictions          TEXT,             -- JSON
  outcome              TEXT NOT NULL DEFAULT 'pending' CHECK (outcome IN
                         ('pending','advanced','rejected','withdrew','offer')),
  hit_rate             REAL,
  decisive_hit_rate    REAL,
  debrief_at           TEXT,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX interviews_job_idx ON interviews (job_id);

CREATE TABLE lessons (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  interview_id  TEXT REFERENCES interviews(id) ON DELETE SET NULL,
  company       TEXT,
  role          TEXT,
  outcome       TEXT,
  what_worked   TEXT,
  what_missed   TEXT,
  handled_badly TEXT,
  rule          TEXT NOT NULL,
  promoted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE runs (
  id                  TEXT PRIMARY KEY,
  kind                TEXT NOT NULL CHECK (kind IN
                        ('search','build_docs','weekly','followups','autofill','manual')),
  started_at          TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at         TEXT,
  sources_used        TEXT,              -- JSON array
  sources_unavailable TEXT,              -- JSON array
  found               INTEGER NOT NULL DEFAULT 0,
  kept                INTEGER NOT NULL DEFAULT 0,
  duplicates          INTEGER NOT NULL DEFAULT 0,
  dropped             INTEGER NOT NULL DEFAULT 0,
  errors              TEXT,              -- JSON array
  summary             TEXT
);
CREATE INDEX runs_started_idx ON runs (started_at DESC);

CREATE TABLE follow_ups (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL CHECK (kind IN ('no_response','thank_you','check_in')),
  due_at     TEXT NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  done_at    TEXT,
  draft_id   TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (job_id, kind, due_at)
);

CREATE TABLE status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor       TEXT NOT NULL,
  at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX status_history_job_idx ON status_history (job_id, at DESC);

-- Answers used to auto-fill application forms. One row per field, so the same answer
-- goes out every time instead of being retyped slightly differently.
CREATE TABLE profile (
  field      TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  category   TEXT NOT NULL CHECK (category IN
               ('contact','work_history','education','screening','preference')),
  sensitive  INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A real invariant: you cannot be "Applied" without a record of what was submitted.
-- This is also what keeps automation out of the human-only status, because creating a
-- submission record is a human action in the dashboard.
CREATE TRIGGER jobs_applied_requires_submission
BEFORE UPDATE OF status ON jobs
WHEN NEW.status = 'Applied'
     AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.job_id = NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'Applied requires a submission record: call record_submission first');
END;

CREATE VIEW v_pipeline AS
SELECT j.*,
  (SELECT COUNT(*) FROM documents d WHERE d.job_id = j.id AND d.kind = 'resume')       AS resume_count,
  (SELECT COUNT(*) FROM documents d WHERE d.job_id = j.id AND d.kind = 'cover_letter') AS cl_count,
  (SELECT s.applied_at FROM submissions s WHERE s.job_id = j.id)                       AS applied_at,
  (SELECT MIN(i.scheduled_at) FROM interviews i
     WHERE i.job_id = j.id AND i.scheduled_at > datetime('now'))                       AS next_interview_at,
  (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id)                            AS interview_count,
  (SELECT COUNT(*) FROM follow_ups f
     WHERE f.job_id = j.id AND f.done = 0 AND f.due_at <= date('now'))                 AS followups_due
FROM jobs j;

CREATE VIEW v_source_performance AS
SELECT j.source,
  COUNT(*)                                                             AS found,
  SUM(CASE WHEN j.status NOT IN ('Discarded','Skip') THEN 1 ELSE 0 END) AS kept,
  COUNT(s.id)                                                          AS applied,
  COUNT(DISTINCT i.job_id)                                             AS reached_interview,
  ROUND(100.0 * COUNT(DISTINCT i.job_id) / NULLIF(COUNT(s.id), 0), 1)   AS interview_rate_pct
FROM jobs j
LEFT JOIN submissions s ON s.job_id = j.id
LEFT JOIN interviews  i ON i.job_id = j.id
GROUP BY j.source;

-- Does the score actually predict interviews? If not, the weights are decoration.
CREATE VIEW v_score_calibration AS
SELECT CASE
         WHEN j.score >= 90 THEN '90-100'
         WHEN j.score >= 80 THEN '80-89'
         WHEN j.score >= 70 THEN '70-79'
         ELSE '60-69'
       END                                                            AS score_band,
  COUNT(*)                                                            AS scored,
  COUNT(s.id)                                                         AS applied,
  COUNT(DISTINCT i.job_id)                                            AS reached_interview,
  ROUND(100.0 * COUNT(DISTINCT i.job_id) / NULLIF(COUNT(s.id), 0), 1) AS interview_rate_pct
FROM jobs j
LEFT JOIN submissions s ON s.job_id = j.id
LEFT JOIN interviews  i ON i.job_id = j.id
WHERE j.score >= 60
GROUP BY score_band
ORDER BY score_band DESC;

CREATE VIEW v_weekly_activity AS
SELECT w.week,
  (SELECT COUNT(*) FROM jobs j
     WHERE strftime('%Y-%W', j.created_at) = w.week AND j.status <> 'Discarded') AS found,
  (SELECT COUNT(*) FROM submissions s
     WHERE strftime('%Y-%W', s.applied_at) = w.week)                             AS applied,
  (SELECT COUNT(*) FROM interviews i
     WHERE i.scheduled_at IS NOT NULL
       AND strftime('%Y-%W', i.scheduled_at) = w.week)                           AS interviews
FROM (SELECT DISTINCT strftime('%Y-%W', created_at) AS week FROM jobs
      UNION SELECT strftime('%Y-%W','now')) w
ORDER BY w.week DESC;
