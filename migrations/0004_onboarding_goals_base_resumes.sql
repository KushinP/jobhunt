-- Base resumes stored in the system rather than only on one laptop, so a scheduled run,
-- a phone, or a cloud session can all tailor from the same masters.
CREATE TABLE base_resumes (
  id             TEXT PRIMARY KEY,
  label          TEXT NOT NULL,
  archetype      INTEGER,
  filename       TEXT NOT NULL,
  content        BLOB NOT NULL,
  byte_size      INTEGER NOT NULL,
  sha256         TEXT,
  -- plain text pulled out at upload time: the tailoring step needs to read the master
  -- without unzipping a .docx, and the claim audit diffs against it
  extracted_text TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  uploaded_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (label)
);
CREATE INDEX base_resumes_archetype_idx ON base_resumes (archetype) WHERE active = 1;

-- Goals, so the system can say whether the search is on track rather than only what it did.
CREATE TABLE goals (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN
                 ('weekly_applications','weekly_outreach','total_applications',
                  'interviews','offer_by','target_comp','custom')),
  title        TEXT NOT NULL,
  target_value REAL,
  unit         TEXT,
  due_at       TEXT,
  status       TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','met','missed','paused','abandoned')),
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX goals_status_idx ON goals (status);

-- Progress for the countable goal kinds, computed from what actually happened rather
-- than self-reported. A goal nobody measures is a wish.
CREATE VIEW v_goal_progress AS
SELECT g.*,
  CASE g.kind
    WHEN 'weekly_applications' THEN
      (SELECT COUNT(*) FROM submissions s
        WHERE strftime('%Y-%W', s.applied_at) = strftime('%Y-%W', 'now'))
    WHEN 'total_applications' THEN (SELECT COUNT(*) FROM submissions)
    WHEN 'interviews' THEN (SELECT COUNT(*) FROM interviews)
  END AS current_value,
  CASE WHEN g.kind IN ('weekly_applications','total_applications','interviews')
       THEN 1 ELSE 0 END AS measurable
FROM goals g;
