import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { type RawJob, forbiddenProfileField, hasHit, ingestJobs, loadConfig, normalizeKey } from '@jobhunt/core';
import { type Env, fail, ok } from './env.ts';
import { searchCompanyBoards } from './sources/boards.ts';
import { searchBuiltIn } from './sources/builtin.ts';
import { searchIndeed } from './sources/indeed.ts';
import { searchLinkedIn } from './sources/linkedin.ts';
import { FETCH_BUDGET, YC_ROLES, fetchYcJob, listYcPostings, minYears, toRawJob, usEligible, ycLocationSlug } from './sources/yc.ts';

export function registerSourceTools(server: McpServer, env: Env): void {
  server.registerTool('search_company_boards', {
    description: 'Search the target companies\' own Greenhouse, Lever and Ashby boards, the '
      + 'freshest and least contested source. Filtering and scoring happen on the server: only '
      + 'postings whose title matches a target archetype are kept, and they are ingested with '
      + 'their full job descriptions, so they are scored properly straight away. Returns a '
      + 'summary, not the postings; do NOT pass these to ingest_jobs again. Set ingest false to '
      + 'preview matching titles instead. Omit `boards` to use the target_boards config.',
    inputSchema: {
      boards: z.object({
        greenhouse: z.array(z.string()).optional(),
        lever: z.array(z.string()).optional(),
        ashby: z.array(z.string()).optional(),
      }).optional(),
      ingest: z.boolean().default(true),
    },
  }, async ({ boards, ingest }) => {
    const cfg = await loadConfig(env.DB);
    const use = boards ?? cfg.target_boards;
    const total = (use.greenhouse?.length ?? 0) + (use.lever?.length ?? 0) + (use.ashby?.length ?? 0);
    if (total === 0) {
      return fail('No company boards configured. Add them with put_config on "target_boards", as '
        + '"slug" or "slug:Display Name", e.g. {"greenhouse":["scaleai:Scale AI"],"ashby":["ramp:Ramp"]}.');
    }
    const r = await searchCompanyBoards(use);
    // Boards list every opening a company has: most are engineering or sales roles that
    // would only be ingested to be discarded. The title is enough to drop those here.
    const titleTerms = cfg.archetypes.flatMap((a) => a.title_terms);
    const matching = r.jobs.filter((j) => hasHit(j.title.toLowerCase(), titleTerms));

    if (!ingest) {
      return ok({
        boards: total, postings_seen: r.jobs.length, title_matches: matching.length,
        preview: matching.slice(0, 50).map((j) => ({ title: j.title, company: j.company, location: j.location, url: j.url })),
        board_errors: r.errors,
      }, `${matching.length} of ${r.jobs.length} postings match a target archetype`);
    }

    const res = await ingestJobs(env.DB, cfg, 'company_boards', matching);
    return ok({
      boards: total, postings_seen: r.jobs.length, title_matches: matching.length,
      found: res.found, kept: res.kept, auto_generate: res.auto_generate,
      duplicates: res.duplicates, discarded: res.discarded,
      kept_roles: res.inserted.map((i) => `${i.score}  ${i.status}  ${i.title} @ ${i.company}`),
      board_errors: r.errors,
    }, `${r.jobs.length} postings on ${total} boards; ${matching.length} matched a target title; `
      + `${res.kept} kept (${res.auto_generate} queued for documents), ${res.discarded} discarded, `
      + `${res.duplicates} already known.`
      + (r.errors.length ? ` ${r.errors.length} board${r.errors.length === 1 ? '' : 's'} failed (see board_errors): `
        + 'check the slug, or remove boards that no longer exist.' : ''));
  });

  server.registerTool('search_yc_jobs', {
    description: 'Search Y Combinator startups\' job board (Work at a Startup) for roles matching '
      + 'the target archetypes, in the target cities plus US remote. Filtering, JD retrieval and '
      + 'scoring all happen on the server, and matches are ingested with their full job '
      + 'descriptions. Returns a summary; do NOT pass these to ingest_jobs again. Roles already '
      + 'in the pipeline are skipped without refetching. Set ingest false to preview matches.',
    inputSchema: {
      roles: z.array(z.string()).optional()
        .describe(`YC role pages to read. Default: ${YC_ROLES.join(', ')}`),
      locations: z.array(z.string()).optional()
        .describe('YC location slugs, e.g. "boston", "new-york", "san-francisco", "remote". Default: the target cities, plus remote if remote work is wanted.'),
      max_years: z.number().int().min(0).max(15).optional()
        .describe('Drop postings whose stated minimum experience is above this. Defaults to the config\'s max_years_required. YC states it as a field, so this is exact rather than a guess from the JD.'),
      ingest: z.boolean().default(true),
    },
  }, async ({ roles, locations, max_years: maxArg, ingest }) => {
    const cfg = await loadConfig(env.DB);
    const max_years = maxArg ?? cfg.max_years_required ?? 3;
    const prefs = cfg.preferences;
    const locs = locations?.length ? locations : [
      ...(prefs.target_cities ?? []).map((c) => ycLocationSlug(c.name)),
      ...((prefs.work_modes ?? []).includes('remote') ? ['remote'] : []),
    ];
    if (!locs.length) return fail('No target cities set and remote not wanted: nothing to search.');

    const list = await listYcPostings(roles?.length ? roles : YC_ROLES, locs);
    const titleTerms = cfg.archetypes.flatMap((a) => a.title_terms);
    const dropped = { title: 0, not_full_time: 0, outside_us: 0, experience: 0, known: 0 };
    const candidates = [];
    for (const p of list.postings) {
      if (!hasHit(p.title.toLowerCase(), titleTerms)) { dropped.title++; continue; }
      if (p.type && !/full.?time/i.test(p.type)) { dropped.not_full_time++; continue; }
      if (!usEligible(p.location)) { dropped.outside_us++; continue; }
      const years = minYears(p.minExperience);
      if (years != null && years > max_years) { dropped.experience++; continue; }
      const known = await env.DB.prepare('SELECT 1 AS k FROM jobs WHERE normalized_key = ?')
        .bind(normalizeKey(p.title, p.companyName)).first();
      if (known) { dropped.known++; continue; }
      candidates.push(p);
    }

    if (!ingest) {
      return ok({
        pages: list.pages, postings_seen: list.postings.length, dropped, page_errors: list.errors,
        candidates: candidates.map((p) => ({ title: p.title.trim(), company: p.companyName, batch: p.companyBatchName,
          location: p.location, salary: p.salaryRange, experience: p.minExperience })),
      }, `${candidates.length} new YC postings match a target archetype`);
    }

    // Each description is one more request; whatever the budget cannot cover waits for the
    // next run, which skips everything already ingested.
    const room = Math.max(0, FETCH_BUDGET - list.fetches);
    const now = candidates.slice(0, room);
    const deferred = candidates.length - now.length;
    const jobs: RawJob[] = [];
    const jdErrors: string[] = [];
    for (const p of now) {
      try {
        jobs.push(await fetchYcJob(p));
      } catch (e) {
        jdErrors.push(`${p.title.trim()} @ ${p.companyName}: ${String(e)}`);
        jobs.push(toRawJob(p, null));
      }
    }
    const res = await ingestJobs(env.DB, cfg, 'yc', jobs);
    return ok({
      pages: list.pages, postings_seen: list.postings.length, dropped,
      found: res.found, kept: res.kept, auto_generate: res.auto_generate,
      duplicates: res.duplicates, discarded: res.discarded, deferred_to_next_run: deferred,
      kept_roles: res.inserted.map((i) => `${i.score}  ${i.status}  ${i.title} @ ${i.company}`),
      page_errors: list.errors, jd_errors: jdErrors,
    }, `${list.postings.length} YC postings read; ${candidates.length} new matches `
      + `(${dropped.title} off-target titles, ${dropped.not_full_time} not full-time, ${dropped.outside_us} outside the US, `
      + `${dropped.experience} above ${max_years} years, ${dropped.known} already known). `
      + `${res.kept} kept (${res.auto_generate} queued for documents), ${res.discarded} discarded`
      + (deferred ? `, ${deferred} left for the next run.` : '.'));
  });

  // Both Apify sources ingest on the server, like the boards and YC: a run returns ~30 full
  // JDs (~170k characters), which is too large to relay through a chat turn to ingest_jobs,
  // and relaying them without JDs left every role scored on its title alone.
  const apifySearch = async (
    source: 'linkedin' | 'indeed' | 'builtin', label: string,
    run: () => Promise<{ jobs: RawJob[]; error?: string; warnings?: string[] }>, query: string, ingest: boolean,
  ) => {
    if (!env.APIFY_TOKEN) {
      return fail(`APIFY_TOKEN is not set, so ${label} cannot be searched. Record ${source} in `
        + 'sources_unavailable. Fix: wrangler secret put APIFY_TOKEN');
    }
    const r = await run();
    if (r.error) return fail(`${label} search failed: ${r.error}. Record ${source} in sources_unavailable.`);
    // Part of a run can fail while the rest returns jobs (Built In runs two levels); the jobs
    // are kept and the failure is said out loud rather than dropped.
    const warn = r.warnings?.length ? ` Part of the search failed: ${r.warnings.join('; ')}.` : '';
    if (!ingest) {
      return ok(r.jobs.map((j) => ({ title: j.title, company: j.company, location: j.location, salary: j.salary, url: j.url })),
        `${r.jobs.length} ${label} postings for "${query}" (preview, not ingested).${warn}`);
    }
    const cfg = await loadConfig(env.DB);
    const res = await ingestJobs(env.DB, cfg, source, r.jobs);
    return ok({
      found: res.found, kept: res.kept, auto_generate: res.auto_generate,
      duplicates: res.duplicates, discarded: res.discarded,
      kept_roles: res.inserted.map((i) => `${i.score}  ${i.status}  ${i.title} @ ${i.company}`),
      warnings: r.warnings ?? [],
    }, `${label} "${query}": ${res.found} found, ${res.kept} kept (${res.auto_generate} queued for `
      + `documents), ${res.discarded} discarded, ${res.duplicates} already known.${warn}`);
  };

  // Where to search when the call names no place: the first target city, so the connector
  // follows the person's settings instead of a hard-coded city.
  const homeCity = async () => (await loadConfig(env.DB)).preferences.target_cities?.[0]?.search ?? 'Boston, MA';
  const LOCATION = z.string().optional()
    .describe('"City, ST", or "remote" for US-remote roles. Default: the first target city.');
  const ACTOR = z.string().optional()
    .describe('an Apify actor id to use instead of the default one, as "username~actor-name". '
      + 'Leave it out unless the default has stopped working.');

  server.registerTool('search_linkedin', {
    description: 'Search LinkedIn jobs through the user\'s Apify account and ingest them with '
      + 'full job descriptions on the server. Returns a summary; do NOT pass these to '
      + 'ingest_jobs again. Costs about $0.0004 per result, roughly a cent a call. `days` 1 '
      + '(default, for a daily run) or 7. Use location "remote" for US-remote roles. Set '
      + 'ingest false to preview.',
    inputSchema: {
      query: z.string(),
      location: LOCATION,
      limit: z.number().int().min(1).max(100).default(50),
      days: z.union([z.literal(1), z.literal(7)]).default(1),
      actor: ACTOR,
      ingest: z.boolean().default(true),
    },
  }, async ({ query, location, limit, days, actor, ingest }) => {
    const where = location ?? await homeCity();
    return apifySearch('linkedin', 'LinkedIn',
      () => searchLinkedIn({ token: env.APIFY_TOKEN!, query, location: where, limit, days, actor }), `${query} (${where})`, ingest);
  });

  server.registerTool('search_builtin', {
    description: 'Search Built In (builtin.com, e.g. Built In Boston) through the user\'s Apify '
      + 'account for entry-level and junior roles, and ingest them with full job descriptions '
      + 'on the server. Pass several queries in one call; it runs them together. Returns a '
      + 'summary; do NOT pass these to ingest_jobs again. About $0.001 per result. Slow '
      + '(one to three minutes).',
    inputSchema: {
      queries: z.array(z.string()).min(1).max(12),
      location: LOCATION,
      per_query: z.number().int().min(1).max(50).default(15),
      days: z.union([z.literal(1), z.literal(3), z.literal(7)]).default(3),
      ingest: z.boolean().default(true),
    },
  }, async ({ queries, location, per_query, days, ingest }) => {
    const where = location ?? await homeCity();
    return apifySearch('builtin', 'Built In',
      () => searchBuiltIn({ token: env.APIFY_TOKEN!, queries, location: where, perQuery: per_query, days }),
      `${queries.join(', ')} (${where})`, ingest);
  });

  server.registerTool('search_indeed', {
    description: 'Search Indeed through the user\'s Apify account and ingest the results with '
      + 'full job descriptions on the server. Replaces Claude\'s Indeed connector. Returns a '
      + 'summary; do NOT pass these to ingest_jobs again. Costs about $0.0001 per result, so a '
      + 'call is well under a cent. `days` is how far back to look (default 1, for a daily run). '
      + 'Use location "remote" for remote roles. Set ingest false to preview.',
    inputSchema: {
      query: z.string(),
      location: LOCATION,
      limit: z.number().int().min(1).max(100).default(50),
      days: z.union([z.literal(1), z.literal(3), z.literal(7), z.literal(14)]).default(1),
      actor: ACTOR,
      ingest: z.boolean().default(true),
    },
  }, async ({ query, location, limit, days, actor, ingest }) => {
    const where = location ?? await homeCity();
    return apifySearch('indeed', 'Indeed',
      () => searchIndeed({ token: env.APIFY_TOKEN!, query, location: where, limit, days, actor }), `${query} (${where})`, ingest);
  });

  server.registerTool('get_application_profile', {
    description: 'The stored answers used to fill application forms: contact details, work '
      + 'history, education and screening answers. Reading these keeps every application '
      + 'consistent instead of retyped slightly differently each time. Demographic and EEO '
      + 'questions are deliberately not stored here and must be left for the user to answer.',
    inputSchema: { category: z.enum(['contact', 'work_history', 'education', 'screening', 'preference']).optional() },
  }, async ({ category }) => {
    const sql = category
      ? 'SELECT field, value, category FROM profile WHERE category = ? ORDER BY field'
      : 'SELECT field, value, category FROM profile ORDER BY category, field';
    const { results } = category
      ? await env.DB.prepare(sql).bind(category).all()
      : await env.DB.prepare(sql).bind().all();
    return ok(results, `${results.length} stored answers`);
  });

  server.registerTool('put_application_profile', {
    description: 'Store or update answers used for auto-filling application forms. Refuses '
      + 'demographic, EEO and identity-document fields.',
    inputSchema: {
      entries: z.array(z.object({
        field: z.string(),
        value: z.string(),
        category: z.enum(['contact', 'work_history', 'education', 'screening', 'preference']),
      })),
    },
  }, async ({ entries }) => {
    const refused: string[] = [];
    let saved = 0;
    for (const e of entries) {
      const bad = forbiddenProfileField(e.field);
      if (bad) { refused.push(`${e.field} (matches "${bad}")`); continue; }
      await env.DB.prepare(
        `INSERT INTO profile (field, value, category, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(field) DO UPDATE SET value = excluded.value,
           category = excluded.category, updated_at = datetime('now')`,
      ).bind(e.field, e.value, e.category).run();
      saved++;
    }
    return ok({ saved, refused }, refused.length
      ? `Saved ${saved}. Refused ${refused.length}: these must be answered by you directly, `
        + `not stored and auto-filled: ${refused.join(', ')}`
      : `Saved ${saved} answers.`);
  });
}
