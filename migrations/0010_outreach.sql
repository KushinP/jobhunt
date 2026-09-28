-- Outreach: every message sent to a person about a role, and what came back.
--
-- Nothing in this system sends anything. A row starts as Drafted, the person sends the
-- message themselves, and then marks it Sent. Sent, Accepted, Replied and Meeting are
-- human-only, exactly as the job statuses are: `status_set_by` records who moved it, and
-- automation may never overwrite a status the person set.
--
-- Additive only: no existing table is touched.
CREATE TABLE outreach (
  id            TEXT PRIMARY KEY,
  -- the role this is about. Null only for a create_role touch: asking about work that has
  -- not been posted, so there is no role in the pipeline yet.
  job_id        TEXT REFERENCES jobs(id) ON DELETE SET NULL,
  company       TEXT NOT NULL,
  contact_name  TEXT NOT NULL,
  contact_role  TEXT,
  contact_type  TEXT CHECK (contact_type IN ('dm_post', 'function_lead', 'founder', 'recruiter', 'referral')),
  channel       TEXT NOT NULL CHECK (channel IN ('linkedin', 'email', 'other')),
  contact_url   TEXT,
  contact_email TEXT,
  -- why this person, in this message: what the opening line is built on
  hook_type     TEXT CHECK (hook_type IN ('origin_story', 'contact_post', 'company_event', 'referral', 'other')),
  hook          TEXT,
  touch_kind    TEXT NOT NULL CHECK (touch_kind IN ('connect_note', 'follow_up', 'backup', 'nudge', 'create_role')),
  -- a nudge or a backup points at the touch it follows
  parent_id     TEXT REFERENCES outreach(id) ON DELETE SET NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'Drafted' CHECK (status IN
                  ('Drafted', 'Sent', 'Accepted', 'Replied', 'Meeting', 'No reply', 'Closed')),
  status_set_by TEXT CHECK (status_set_by IN ('you', 'automation')),
  drafted_at    TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at       TEXT,
  accepted_at   TEXT,
  replied_at    TEXT,
  -- set when a touch is marked Sent: three business days later
  follow_up_due TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX outreach_job_idx      ON outreach (job_id);
CREATE INDEX outreach_status_idx   ON outreach (status);
CREATE INDEX outreach_due_idx      ON outreach (follow_up_due);
CREATE INDEX outreach_company_idx  ON outreach (company);
