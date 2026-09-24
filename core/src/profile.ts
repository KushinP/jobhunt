/**
 * Application-form answers this system must never store or fill on the person's behalf.
 * Demographic and EEO questions are theirs to answer, identity numbers and passwords are
 * never typed by automation, and a stored answer would be filled in silently on every
 * application. One list, used by both the connector and the dashboard.
 *
 * Field names arrive as "date_of_birth", "SocialSecurityNumber" or "Race / ethnicity", so they
 * are normalized to spaced lowercase words and matched as whole words: "age" must not catch
 * "language" or "manager".
 */
const NEVER_STORE = [
  'race', 'ethnicity', 'ethnic', 'hispanic', 'latino', 'latinx', 'gender', 'sex', 'pronoun', 'pronouns',
  'disability', 'disabled', 'veteran', 'sexual orientation', 'orientation', 'religion', 'religious',
  'age', 'date of birth', 'birth date', 'birthdate', 'birthday', 'dob', 'ssn', 'social security',
  'passport', 'drivers license', 'driver license', 'drivers licence', 'driving licence', 'password',
  'salary history', 'eeo', 'eeoc', 'demographic', 'demographics', 'self identify', 'self identification',
];

export function forbiddenProfileField(field: string): string | null {
  const words = ` ${field
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;
  return NEVER_STORE.find((t) => words.includes(` ${t} `)) ?? null;
}
