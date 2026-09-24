-- When the server last failed to read a role's posting. fetch_jds skips a role for three days
-- after a failure, so the same unreadable postings do not fill every day's JD pass, and they
-- stay in New for a person or a connector instead of being marked Unverified unseen.
ALTER TABLE jobs ADD COLUMN jd_fetch_failed_at TEXT;
