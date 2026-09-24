-- When applications close. "stated": the posting names a deadline ("Apply by October 2").
-- "listing": when the listing expires, which job boards set on their own (LinkedIn: 30 days
-- after posting), so it is shown as a hint, not a deadline. "you": set in the dashboard, and
-- never replaced by a source.
ALTER TABLE jobs ADD COLUMN closes_at TEXT;
ALTER TABLE jobs ADD COLUMN closes_source TEXT CHECK (closes_source IN ('stated', 'listing', 'you'));
CREATE INDEX jobs_closes_idx ON jobs (closes_at);
