-- The shape of the application profile: every field an application form asks for, seeded as
-- CONFIRM so nothing is ever typed into a real form until the person has answered it.
-- Onboarding fills these in (put_application_profile), or they can be edited in the dashboard.
-- Demographic and EEO questions are deliberately absent: those stay the applicant's to answer.
INSERT INTO profile (field, value, category) VALUES
  ('full_name',            'CONFIRM',                                    'contact'),
  ('first_name',           'CONFIRM',                                    'contact'),
  ('last_name',            'CONFIRM',                                    'contact'),
  ('email',                'CONFIRM',                                    'contact'),
  ('phone',                'CONFIRM',                                    'contact'),
  ('street_address',       'CONFIRM',                                    'contact'),
  ('city',                 'CONFIRM',                                    'contact'),
  ('state',                'CONFIRM',                                    'contact'),
  ('postal_code',          'CONFIRM',                                    'contact'),
  ('country',              'CONFIRM',                                    'contact'),
  ('linkedin_url',         'CONFIRM',                                    'contact'),

  ('school',               'CONFIRM',                                    'education'),
  ('degree',               'CONFIRM',                                    'education'),
  ('field_of_study',       'CONFIRM',                                    'education'),
  ('education_start',      'CONFIRM',                                    'education'),
  ('education_end',        'CONFIRM',                                    'education'),
  ('gpa',                  'CONFIRM',                                    'education'),

  -- One block per employer, oldest last. Add more with put_application_profile.
  ('employer_1',           'CONFIRM',                                    'work_history'),
  ('title_1',              'CONFIRM',                                    'work_history'),
  ('location_1',           'CONFIRM',                                    'work_history'),
  ('start_1',              'CONFIRM',                                    'work_history'),
  ('end_1',                'CONFIRM',                                    'work_history'),

  ('work_authorization',   'CONFIRM',                                    'screening'),
  ('requires_sponsorship', 'CONFIRM',                                    'screening'),
  ('languages',            'CONFIRM',                                    'screening'),

  ('notice_period',        'CONFIRM',                                    'preference'),
  ('willing_to_relocate',  'CONFIRM',                                    'preference'),
  ('salary_expectation',   'CONFIRM',                                    'preference'),
  ('preferred_location',   'CONFIRM',                                    'preference'),
  ('earliest_start_date',  'CONFIRM',                                    'preference')
ON CONFLICT(field) DO UPDATE SET
  value = excluded.value, category = excluded.category, updated_at = datetime('now');
