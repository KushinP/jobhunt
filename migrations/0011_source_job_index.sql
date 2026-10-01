-- Dedupe on the source's own job id before title and company: one LinkedIn posting arrived
-- twice under two titles. Ingest looks this up for every sighting (about 2,500 a day), so it
-- needs an index rather than a scan.
--
-- Additive only: no existing table is touched.
CREATE INDEX IF NOT EXISTS jobs_source_job_idx ON jobs (source, source_job_id);
