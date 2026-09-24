-- Your own rating of a role, separate from the computed score.
-- Two reasons this is not just a nicer sort order: it is the only signal that says whether
-- the scoring rubric agrees with a human, and it captures what a keyword scorer cannot
-- see (a referral, a team you rate, a founder you know).
ALTER TABLE jobs ADD COLUMN rating INTEGER CHECK (rating BETWEEN 1 AND 5);
ALTER TABLE jobs ADD COLUMN rated_at TEXT;

CREATE INDEX jobs_rating_idx ON jobs (rating DESC);

DROP VIEW IF EXISTS v_pipeline;
CREATE VIEW v_pipeline AS
SELECT j.*,
  (SELECT COUNT(*) FROM documents d WHERE d.job_id = j.id AND d.kind = 'resume')       AS resume_count,
  (SELECT COUNT(*) FROM documents d WHERE d.job_id = j.id AND d.kind = 'cover_letter') AS cl_count,
  (SELECT s.applied_at FROM submissions s WHERE s.job_id = j.id)                       AS applied_at,
  (SELECT MIN(i.scheduled_at) FROM interviews i
     WHERE i.job_id = j.id AND i.scheduled_at > datetime('now'))                       AS next_interview_at,
  (SELECT COUNT(*) FROM interviews i WHERE i.job_id = j.id)                            AS interview_count,
  (SELECT COUNT(*) FROM follow_ups f
     WHERE f.job_id = j.id AND f.done = 0 AND f.due_at <= date('now'))                 AS followups_due,
  -- how far apart the machine and the human are, for the calibration view
  CASE WHEN j.rating IS NOT NULL AND j.score IS NOT NULL
       THEN ABS(j.rating - (CASE
              WHEN j.score >= 90 THEN 5
              WHEN j.score >= 80 THEN 4
              WHEN j.score >= 70 THEN 3
              WHEN j.score >= 60 THEN 2
              ELSE 1 END))
  END                                                                                  AS rating_gap
FROM jobs j;

-- Does your own rating predict interviews better than the score does?
CREATE VIEW v_rating_calibration AS
SELECT j.rating,
  COUNT(*)                                                            AS rated,
  ROUND(AVG(j.score), 1)                                              AS avg_score,
  COUNT(s.id)                                                         AS applied,
  COUNT(DISTINCT i.job_id)                                            AS reached_interview,
  ROUND(100.0 * COUNT(DISTINCT i.job_id) / NULLIF(COUNT(s.id), 0), 1) AS interview_rate_pct
FROM jobs j
LEFT JOIN submissions s ON s.job_id = j.id
LEFT JOIN interviews  i ON i.job_id = j.id
WHERE j.rating IS NOT NULL
GROUP BY j.rating
ORDER BY j.rating DESC;
