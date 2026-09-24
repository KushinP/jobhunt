/**
 * Neutral padding that turns a short fixture into a JD of realistic length (the scorer
 * treats anything under 800 characters as a snippet). It must hit none of the archetype
 * terms, or it would shift every score; a test in score.test.ts checks exactly that.
 */
export const NEUTRAL =
  ' About the role: you will join a small team that values clear writing, steady judgement '
  + 'and kindness toward colleagues. We keep meetings short and decisions written down. '
  + 'Benefits include health coverage, retirement matching, parental leave and paid holidays. '
  + 'We welcome applicants from every background and encourage you to apply even if you do '
  + 'not meet every listed requirement. Hours are flexible within reason, travel is rare, and '
  + 'the hiring process has three conversations over about two weeks. We respond to every '
  + 'applicant. Please tell us in your note what you would want to learn in your first year. '
  + 'Compensation is reviewed annually and we publish our leveling guide internally.';

/** A fixture JD at full length: the meaningful text, then neutral padding. */
export const jd = (text: string) => (text + NEUTRAL).padEnd(820, ' .');
