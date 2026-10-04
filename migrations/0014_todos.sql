-- To-dos: things the person owes that JobHunt cannot work out on its own, such as a HireVue or
-- an online assessment with a deadline. Follow-ups, outreach and interviews are computed from
-- their own tables; this holds only what was written down by hand (or by Claude, on their word).
--
-- kind is checked in code, not by a CHECK constraint, so a new kind never needs a table rebuild.
-- Additive only: one new table.
CREATE TABLE todos (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'other',
  job_id     TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  due_at     TEXT,             -- YYYY-MM-DD, Eastern
  url        TEXT,
  notes      TEXT,
  created_by TEXT NOT NULL DEFAULT 'you',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  done_at    TEXT
);
CREATE INDEX todos_open_idx ON todos (done_at, due_at);
