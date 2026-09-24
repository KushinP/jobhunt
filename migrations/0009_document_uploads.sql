-- Single-use uploads for built documents. A file used to travel as base64 typed into a tool
-- call, and at 20,000+ characters the copy drifts and the save is refused (observed
-- 2026-09-22: 29 roles, nothing saved). Now the connector hands out a link tied to one file
-- (its role, kind and sha256) that the sandbox sends the file to with curl, or takes the file
-- in short pieces that are checked one by one.
CREATE TABLE uploads (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL CHECK (kind IN ('resume', 'cover_letter')),
  filename     TEXT NOT NULL,
  sha256       TEXT NOT NULL,
  meta         TEXT NOT NULL DEFAULT '{}',
  total_chunks INTEGER,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at   TEXT NOT NULL,
  used_at      TEXT,
  document_id  TEXT
);
CREATE TABLE upload_chunks (
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  idx       INTEGER NOT NULL,
  data      TEXT NOT NULL,
  PRIMARY KEY (upload_id, idx)
);
