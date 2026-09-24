-- The evidence bank: every claim a document is allowed to make, with where it came from,
-- who actually did the work, and whether the person has confirmed it.
--
-- The rule it exists to enforce: generated documents may only use CONFIRMED evidence, so
-- nothing gets invented at tailoring time and nothing depends on what happens to be in a
-- chat window. Items pulled out of a resume or a document start UNCONFIRMED until the
-- person says they are accurate.
CREATE TABLE evidence (
  id           TEXT PRIMARY KEY,
  kind         TEXT NOT NULL CHECK (kind IN
                 ('accomplishment','project','skill','metric','story','credential','boundary')),
  title        TEXT NOT NULL,
  detail       TEXT,
  context      TEXT,
  -- who actually did it. "Led" for something contributed to is the most common inflation,
  -- so it is recorded, not inferred.
  ownership    TEXT CHECK (ownership IN ('built_myself','led','contributed','team')),
  level        TEXT CHECK (level IN ('familiar','working','strong','expert')),
  start_date   TEXT,
  end_date     TEXT,
  metrics      TEXT,
  tools        TEXT,               -- JSON array
  archetypes   TEXT,               -- JSON array of archetype ids this supports
  proof_url    TEXT,
  source       TEXT NOT NULL CHECK (source IN ('resume','user','document','repo')),
  source_ref   TEXT,
  status       TEXT NOT NULL DEFAULT 'unconfirmed'
                 CHECK (status IN ('unconfirmed','confirmed','rejected')),
  confirmed_at TEXT,
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX evidence_kind_status_idx ON evidence (kind, status);
CREATE INDEX evidence_context_idx ON evidence (context);

-- A confirmed claim must say where it came from. An unconfirmed one may still be a draft.
CREATE TRIGGER evidence_confirm_requires_source
BEFORE UPDATE OF status ON evidence
WHEN NEW.status = 'confirmed' AND (NEW.source_ref IS NULL OR NEW.source_ref = '')
     AND NEW.source <> 'user'
BEGIN
  SELECT RAISE(ABORT, 'confirming evidence from a resume, document or repo needs source_ref');
END;
