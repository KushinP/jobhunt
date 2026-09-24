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
  const hayTitle = title.toLowerCase();
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
  const yearsRequired = statedYears(hayJd);
  const levelMismatch = titleHas(cfg.too_senior_terms)
    || (yearsRequired != null && yearsRequired > (cfg.max_years_required ?? 99));
  const sSeniority = levelMismatch ? 0 : w.seniority;

  const total = bestTotal + sSeniority + sLocation;
  const score = Math.round(total);
  const breakdown = {
    ...best, seniority: round1(sSeniority), location: round1(sLocation),
    ...(yearsRequired != null ? { years_required: yearsRequired } : {}),
  };

  if (!hasJd) {
    // With only a title to go on, the title is the test: a role whose title matches a
    // target archetype is kept, provisionally, until its JD arrives; one that matches
    // nothing is dropped, because the title is all the evidence there is.
    return {
      score, excluded: false, archetype: bestId, breakdown,
      remote: isRemote && !isLocal, level_mismatch: levelMismatch,
      drop_reason: titleMatches ? null : 'title matches no target role (no JD to judge by)',
      auto_generate: false,
      needs_jd: titleMatches,
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
    drop_reason: score < cfg.thresholds.hard_cutoff
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
    auto_generate: score >= cfg.thresholds.auto_generate && !levelMismatch && titleMatches,
    needs_jd: false,
  };
}

/**
 * The experience a JD requires: the highest minimum it states as a requirement.
 * The highest, because requirements stack ("10+ years across finance roles; 2+ years in
 * strategic finance" needs ten). "Preferred" and "a plus" lines are not requirements, so a
 * JD saying "2+ years required, 5+ preferred" needs two. A number counts only where it is
 * plainly about the candidate: in a sentence that mentions experience, or leading a bullet
 * ("- 6-11 years in management consulting"), so "20 years of history" does not.
 */
export function statedYears(jd: string | null | undefined): number | null {
  if (!jd) return null;
  const found: number[] = [];
  const years = /(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?years?\b/g;
  for (const line of jd.toLowerCase().split(/\n|(?<=[.;!?])\s+/)) {
    const s = line.trim();
    if (!s || /\b(preferred|nice to have|bonus|a plus|ideally|desired|not required)\b/.test(s)) continue;
    const bullet = s.match(/^(?:[-*•·]\s*)?(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?years?\b/);
    if (bullet) found.push(Number(bullet[1]));
    if (!/\bexperience\b/.test(s)) continue;
    for (const m of s.matchAll(years)) found.push(Number(m[1]));
  }
  const real = found.filter((n) => n <= 15);
  return real.length ? Math.max(...real) : null;
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
