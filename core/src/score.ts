import type { Config, ScoreResult } from './types.ts';
import { countHits, hasHit, hitOutside } from './normalize.ts';
import { extractPayLine, parseSalary } from './salary.ts';

/**
 * Deterministic scoring. Location and level are hard filters rather than point
 * deductions, because an on-site role in a ruled-out city is not "15 points worse",
 * it is inapplicable; and a VP role is not a realistic target three years out.
 * An earlier additive-only version gave an on-site Austin role 85/100 and would have
 * spent tokens generating documents for it.
 */
export function scoreJob(
  cfg: Config,
  input: {
    title: string; company: string; location?: string | null; jd?: string | null;
    salary?: string | null;
  },
): ScoreResult {
  const w = cfg.weights;
  const title = input.title ?? '';
  // Titles abbreviate: "Founding Ops" and "Forward Deployed Operator" were discarded for
  // missing the target terms "founding operations" and "forward deployed operations".
  const hayTitle = title.toLowerCase()
    .replace(/\bops\b/g, 'operations')
    .replace(/\boperators?\b/g, 'operations');
  const hayLoc = (input.location ?? '').toLowerCase();
  const hayJd = (input.jd ?? '').toLowerCase();
  const hayAll = [title, input.company, input.location ?? '', input.jd ?? '']
    .join(' ').toLowerCase();

  const excluded = (drop_reason: string): ScoreResult => ({
    score: 0, excluded: true, archetype: null, breakdown: {},
    remote: false, level_mismatch: false, drop_reason, auto_generate: false, needs_jd: false,
  });

  // Search results usually arrive without the job description, and domain and skill are
  // 45 of the 100 points. Scoring a title as if it were the whole posting made a role titled
  // exactly "AI Solutions Consultant" score 58 and get thrown away. A short snippet is not a
  // job description either.
  const hasJd = (input.jd ?? '').trim().length >= 800;

  const hasOverride = hasHit(hayAll, cfg.override_terms);
  const targetTitleTerms = cfg.archetypes.flatMap((a) => a.title_terms);
  const titleMatches = hasHit(hayTitle, targetTitleTerms);
  // Title words are read outside the target phrases they sit in: "Chief of Staff" is a
  // BizOps target, not a C-suite role; "Customer Solutions Engineer" is not an engineering
  // job; "Implementation Manager" names the job rather than a management level.
  const titleHas = (terms: readonly string[]) => hitOutside(hayTitle, terms, targetTitleTerms);

  // Matched against the company field alone: "our client" in a JD is often a customer-facing
  // role describing its own customers, but an employer named "... Staffing" never hires for itself.
  if (hasHit(input.company ?? '', cfg.exclude_companies ?? [])) {
    return excluded('excluded company (staffing agency or blind posting)');
  }
  if (titleHas(cfg.exclude_terms_title) && !hasOverride) {
    return excluded('excluded by title term');
  }
  if (hasHit(hayAll, cfg.exclude_terms_any) && !hasOverride) {
    return excluded('excluded by content term');
  }
  if (titleHas(cfg.disqualifying_senior_terms)) {
    return excluded('level mismatch: too senior');
  }

  const prefs = cfg.preferences;
  // Industries the person has ruled out are a preference, not a keyword accident, so the
  // override list does not rescue them.
  if (prefs?.industries_avoid?.length && hasHit(hayAll, prefs.industries_avoid)) {
    return excluded('industry you have ruled out');
  }

  // Only a clearly stated maximum below the floor filters. A missing or unreadable salary
  // never does, since most postings do not state one.
  if (prefs?.comp_floor) {
    const pay = parseSalary(input.salary) ?? parseSalary(extractPayLine(input.jd));
    if (pay && pay.max < prefs.comp_floor) {
      return excluded(`pays below your floor ($${Math.round(pay.max / 1000)}k max, `
        + `floor $${Math.round(prefs.comp_floor / 1000)}k)`);
    }
  }

  const cityTerms = (cfg.preferences?.target_cities ?? []).flatMap((c) => c.match ?? []);
  const isLocal = hasHit(hayLoc, cfg.locations_local) || hasHit(hayLoc, cityTerms);
  // Remote only counts if it can be worked from the US. And a remote phrase in the JD is
  // often company boilerplate: Brex's perks paragraph offers "four weeks per year of fully
  // remote work" right after naming the required office days, which let on-site roles in
  // Vancouver and Salt Lake City through. A JD that also states office time is not remote.
  const abroad = hasHit(hayLoc, cfg.non_us_terms ?? []);
  const jdRemote = hasHit(hayJd, cfg.remote_jd_terms) && !hasHit(hayJd, cfg.onsite_jd_terms ?? []);
  const isRemote = !abroad && (hasHit(hayLoc, cfg.remote_terms) || jdRemote);
  if (!isLocal && !isRemote) {
    return excluded(abroad && !isLocal ? 'outside the US' : 'location not acceptable and not remote');
  }
  const sLocation = isLocal ? w.location : cfg.remote_location_points;

  let bestTotal = -1;
  let bestId: number | null = null;
  let best = { title: 0, domain: 0, skill: 0 };

  for (const a of cfg.archetypes) {
    const sTitle = hasHit(hayTitle, a.title_terms) ? w.title
      : hasHit(hayAll, a.title_terms) ? w.title * 0.5
      : 0;
    const sDomain = w.domain * Math.min(1, countHits(hayAll, a.domain_terms) / 3);
    const sSkill = w.skill * Math.min(1, countHits(hayAll, a.skill_terms) / 3);
    const total = sTitle + sDomain + sSkill;
    if (total > bestTotal) {
      bestTotal = total;
      bestId = a.id;
      best = { title: round1(sTitle), domain: round1(sDomain), skill: round1(sSkill) };
    }
  }
  if (bestId === null) bestTotal = 0;

  // Titles rarely carry the level at the companies that matter most: "Strategic Finance,
  // B2B Product" at OpenAI asks for 7+ years. The JD usually says so outright.
  // Read from the original JD: the sentence splitter needs its capitals.
  const yearsRequired = statedYears(input.jd);
  const maxYears = cfg.max_years_required ?? 99;
  const tooManyYears = yearsRequired != null && yearsRequired > maxYears;
  // "Associate Product Manager" and "Associate Manager" are early-career titles, not a level.
  const seniorTitle = hitOutside(hayTitle, cfg.too_senior_terms,
    [...targetTitleTerms, 'associate manager', 'associate product manager']) && !hasOverride;
  const levelMismatch = seniorTitle || tooManyYears;
  const sSeniority = levelMismatch ? 0 : w.seniority;
  const missingSkill = hasJd ? missingSkillRequired(input.jd, cfg.missing_skills ?? []) : null;

  const total = bestTotal + sSeniority + sLocation;
  const score = Math.round(total);
  const breakdown = {
    ...best, seniority: round1(sSeniority), location: round1(sLocation),
    ...(yearsRequired != null ? { years_required: yearsRequired } : {}),
    ...(missingSkill ? { missing_skill: missingSkill } : {}),
  };

  // Both used to cost only the 20 seniority points, which left the role in New at 80 or, when
  // the years went unread, queued at 100. The sweep then removed them by hand: 20 years/level
  // skips on 09-30 alone. The plan rules out senior titles and more than two years outright.
  const levelDrop = seniorTitle ? 'level mismatch: senior title'
    : tooManyYears ? `requires ${yearsRequired}+ years of experience (limit ${maxYears})`
    : null;

  if (!hasJd) {
    // With only a title to go on, the title is the test: a role whose title matches a
    // target archetype is kept, provisionally, until its JD arrives; one that matches
    // nothing is dropped, because the title is all the evidence there is.
    return {
      score, excluded: false, archetype: bestId, breakdown,
      remote: isRemote && !isLocal, level_mismatch: levelMismatch,
      drop_reason: levelDrop ?? (titleMatches ? null : 'title matches no target role (no JD to judge by)'),
      auto_generate: false,
      needs_jd: titleMatches && !levelDrop,
    };
  }

  return {
    score,
    excluded: false,
    archetype: bestId,
    breakdown,
    remote: isRemote && !isLocal,
    level_mismatch: levelMismatch,
    // A role whose title names a target is not thrown away on thin vocabulary alone:
    // BizOps and chief-of-staff JDs rarely use finance words, and a Boston "Business
    // Operations Lead" scored 48 and was discarded. It waits in New, ranked low, for a person
    // to judge. A JD sharing no vocabulary at all ("Business Analyst" over a front-desk
    // scheduling job) is still a poor fit and is dropped.
    drop_reason: levelDrop ? levelDrop
      : score < cfg.thresholds.hard_cutoff
      && !(titleMatches && best.domain + best.skill > 0) ? 'below hard cutoff'
      // JD keywords alone reach 80 on almost any tech posting, which filled New with
      // "Dynamics365 Administrator" and "Co-Founder & CEO". The title is the test, as it is
      // when there is no JD; an override term (a named early-career program) still rescues.
      : !titleMatches && !hasOverride ? 'title matches no target role'
      : null,
    // A level-mismatched role never auto-spends tokens, however well it keyword-matches.
    // Nor does one whose title matches no target: domain, skill, level and location alone
    // reach 80 on almost any tech JD, which queued "Applied AI Engineer" and
    // "Field Enablement Specialist" for documents. Those wait in New for a person.
    // A required skill the person cannot be tested on keeps the role in New rather than
    // discarding it: the phrase test is loose, and a person can still judge the role worth it.
    auto_generate: score >= cfg.thresholds.auto_generate && !levelMismatch && titleMatches && !missingSkill,
    needs_jd: false,
  };
}

/**
 * The experience a JD requires: the highest minimum it states as a requirement.
 * The highest, because requirements stack ("10+ years across finance roles; 2+ years in
 * strategic finance" needs ten). "Preferred" and "a plus" lines are not requirements, so a
 * JD saying "2+ years required, 5+ preferred" needs two. A number counts only where it is
 * plainly about the candidate: in a sentence that mentions experience, leading a bullet
 * ("- 6-11 years in management consulting"), or after "required" or "minimum", so "20 years
 * of history" does not.
 *
 * Every rule below comes from a posting read wrong in the production replay:
 * - "3+ years of FP&A experience, ideally in corporate finance" still requires three, so a
 *   preference word discounts only what it qualifies (its clause, or the years right before it).
 * - "Bachelor's degree or 7 years of experience" asks nothing of a graduate, so a degree
 *   sentence is read only up to the "or" that offers the alternative.
 * - "4 year degree" is a degree, "up to 5 years" is a ceiling, and "0 - 3 years" is a range.
 */
export function statedYears(jd: string | null | undefined): number | null {
  if (!jd) return null;
  const found: number[] = [];
  const n = String.raw`(?<![\d.])(?<!up to )(\d{1,2})\s*(?:\+|plus|or more)?\s*(?:(?:-|–|—|to)\s*\d{1,2}\s*\+?\s*)?`
    + String.raw`years?\b(?!['’]?\s*(?:degree|college|university|bachelor|program))`;
  const years = new RegExp(n, 'g');
  for (const sentence of jdSentences(jd)) {
    if (ABOUT_THE_COMPANY.test(sentence) || LEADING_PREFERENCE.test(sentence)) continue;
    const s = clauses(degreePath(sentence)).map(beforePreference).filter(Boolean).join(', ').trim();
    if (!s) continue;
    const bullet = s.match(new RegExp(String.raw`^(?:[-*•·]\s*)?(?:minimum(?: of)?\s*|at least\s*)?${n}`));
    if (bullet) found.push(Number(bullet[1]));
    // "Required 5+ years in technical sales" states a requirement without the word "experience".
    for (const m of s.matchAll(new RegExp(String.raw`\b(?:required|requires|minimum(?: of)?|at least)\s*:?\s*${n}`, 'g'))) {
      found.push(Number(m[1]));
    }
    if (!/\bexperience\b/.test(s)) continue;
    for (const m of s.matchAll(years)) found.push(Number(m[1]));
  }
  const real = found.filter((x) => x <= 15);
  return real.length ? Math.max(...real) : null;
}

const PREFERRED = /\b(preferred|nice to have|bonus|(?:a|strong) plus|an asset|ideally|desired|desirable|encouraged|not required)\b/;
// "Ideally, you also have 4+ years..." and "Preferred: 3+ years" qualify the whole sentence.
const LEADING_PREFERENCE = /^(?:[-*•·]\s*)?(?:ideally|preferred|bonus|nice to have)\b/;
// "We bring 10 years of experience to every client" is about the company, not the candidate.
const ABOUT_THE_COMPANY = /\b(we have|we've|we bring|our (company|team|firm|founders) (has|have|brings?)|founded in|been in business|in business for)\b/;
const NUMBER_WORDS: Record<string, string> = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8',
  nine: '9', ten: '10', eleven: '11', twelve: '12', fifteen: '15',
};

/** Clauses of a sentence. A spaced dash between two numbers is a range ("0 - 3 years"). */
function clauses(sentence: string): string[] {
  return sentence.split(/[,;()]|(?<!\d)\s[-–—]\s|\s[-–—]\s(?!\d)/);
}

/** A sentence naming a degree, cut at the "or" that offers a non-degree path to it:
 * "bachelor's degree or 4+ years of experience", "... or high school diploma with 5 years". */
function degreePath(sentence: string): string {
  const degree = /\b(degree|bachelor\S*|diploma|ged)\b/.exec(sentence);
  if (!degree) return sentence;
  // Only an "or" that goes on to offer years, a diploma or an equivalent; "(business, finance,
  // or similar)" is a list of fields.
  const or = /\bor\b(?=[^.)]{0,40}?(?:\d{1,2}\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?years?|high school|ged|diploma|equivalent))/g;
  or.lastIndex = degree.index + degree[0].length;
  const alt = or.exec(sentence);
  return alt ? sentence.slice(0, alt.index) : sentence;
}

/** A clause cut at its preference word, or nothing when that word sits right after a stated
 * number of years and so qualifies the years themselves. */
function beforePreference(clause: string): string {
  const cue = PREFERRED.exec(clause);
  if (!cue) return clause;
  const head = clause.slice(0, cue.index);
  const lastYears = [...head.matchAll(/\byears?\b/g)].pop();
  return lastYears && cue.index - lastYears.index! < 40 ? '' : head;
}

/**
 * A JD as lowercase sentences, with number words as digits. Scraped LinkedIn text arrives with
 * its block boundaries deleted ("...is a plus.Experience5+ years of experience in..."), which
 * made the whole requirements section one "sentence" that contained "a plus" and was skipped,
 * so a posting asking 5+ years scored full seniority. Sentences are therefore also split at
 * punctuation with no space after it, and where a word runs straight into a number or into a
 * capitalised word ("consultingExperience"). Camel-case product names ("HubSpot") are kept
 * whole by requiring four lowercase letters before the capital.
 */
export function jdSentences(jd: string): string[] {
  return jd
    .replace(/([.;!?:])(?=[A-Za-z])/g, '$1\n')
    .replace(/([a-z]{2}[.;!?:])(?=\d)/g, '$1\n')
    .replace(/([a-z]{4})(?=[A-Z][a-z])/g, '$1\n')
    .replace(/([a-z])(?=\d)/g, '$1\n')
    .toLowerCase()
    // "three (3) years" and "three years" read the same as "3 years"
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen)\s*\((\d{1,2})\)/g, '$2')
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen)\b/g, (w) => NUMBER_WORDS[w])
    .split(/\n|(?<=[.;!?])\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

// Words that make a mention of a skill a requirement rather than a passing reference, and
// words that soften it back ("a strong interest in learning SQL", "familiarity with SQL ... or
// advanced analysis tools", "knowledge of SQL or strong desire to learn").
const STRONG = /\b(strong|advanced|proficien\w*|expert\w*|deep|hands-on|fluen\w*|required|requires|must|mastery|solid|write|writing)\b/;
const SOFT = /\b(interest in|desire to|willing\w* to|eager to|learn\w*|familiar\w*|exposure|basic|comfort\w*)\b/;
// About the candidate, not the product: "leverages the strength of Microsoft SQL technology to
// provide advanced applications" is a company blurb.
const CANDIDATE = /\b(you|your|experience|proficien\w*|skills?|knowledge|ability|required|requires|must|fluen\w*|expertise|qualifications?)\b/;

/**
 * The first skill the person has said they cannot be tested on that a JD states as a
 * requirement: "Strong SQL skills", "Advanced SQL and working knowledge of Python". A mention
 * in a preferred line, or without a word that makes it a requirement ("exposure to SQL"), does
 * not count. Build runs sent 60% of queued roles back to New on exactly these lines.
 */
export function missingSkillRequired(jd: string | null | undefined, skills: readonly string[]): string | null {
  if (!jd || !skills?.length) return null;
  for (const s of jdSentences(jd)) {
    if (PREFERRED.test(s) || SOFT.test(s) || !STRONG.test(s) || !CANDIDATE.test(s)) continue;
    for (const skill of skills) {
      if (hasHit(s, [skill])) return skill;
    }
  }
  return null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** The status a freshly scored role should land in. */
export function statusForScore(r: ScoreResult): 'Discarded' | 'Generate' | 'New' {
  if (r.excluded || r.drop_reason) return 'Discarded';
  return r.auto_generate ? 'Generate' : 'New';
}

export function baseResumeFor(cfg: Config, archetype: number | null): string {
  if (archetype != null) {
    const hit = cfg.base_resume_map[String(archetype)];
    if (hit) return hit;
  }
  return cfg.base_resume_map.fallback;
}
