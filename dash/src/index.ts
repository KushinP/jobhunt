import {
  addManualJob, checkClaims, deleteBaseResume, deleteGoal, exchangeGoogleCode,
  extractDocxText, getBaseResume, getDocument, googleAuthUrl, listBaseResumes,
  listGoals, loadConfig, onboardingStatus, pipelineFlow, putConfig, recordSubmission, refreshFollowUps,
  saveBaseResume, setRating, setStatus, signState, updateJobDetails, upsertGoal, verifyState,
  deleteEvidence, evidenceSummary, listEvidence, savePreferences, setEvidenceStatus,
  upsertEvidence, SOURCES, FEATURE_CONNECTORS, resolvePosting, boardNames, buildOnePrompt, normalizeKey, deleteDocument,
  getCompany, upsertCompany, INDUSTRIES, STAGES, forbiddenProfileField, scheduledTaskPrompts, toIsoDate, CONFIRMABLE_STEPS, confirmSetupStep,
  type EvidenceInput, type GoalKind, type JobStatus,
} from '@jobhunt/core';
import {
  clearCookie, mintSession, readCookie, sessionCookie, verifySession,
} from './auth.ts';

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  /** wrangler secret put SESSION_SECRET  (any long random string) */
  SESSION_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  /** wrangler secret put GOOGLE_CLIENT_SECRET */
  GOOGLE_CLIENT_SECRET: string;
  /** the single address allowed to sign in */
  ALLOWED_EMAIL: string;
  /** this instance's connector origin, shown in Setup, e.g. https://mcp.example.workers.dev */
  PUBLIC_MCP_URL?: string;
}

const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });

const bad = (message: string, status = 400) => json({ error: message }, { status });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // An unhandled throw otherwise surfaces as Cloudflare's opaque "error code: 1101",
    // which tells you nothing. Report the actual message instead.
    try {
      return await route(request, env);
    } catch (e) {
      return new Response(`JobHunt error: ${String(e)}`,
        { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // Sign-in is Google, restricted to one address. No password is stored anywhere.
    if (pathname.startsWith('/api/auth/')) {
      try {
        return await authRoutes(request, env, url);
      } catch (e) {
        return signInPage(String(e).replace(/^Error:\s*/, ''));
      }
    }

    if (pathname === '/api/logout' && request.method === 'POST') {
      return json({ ok: true }, { headers: { 'set-cookie': clearCookie() } });
    }

    const authed = await verifySession(readCookie(request), env.SESSION_SECRET);

    if (pathname === '/api/session') return json({ authed });

    if (pathname.startsWith('/api/') || pathname.startsWith('/doc/')) {
      if (!authed) return json({ error: 'Not signed in' }, { status: 401 });
      try {
        return await api(request, env, url);
      } catch (e) {
        return json({ error: String(e) }, { status: 500 });
      }
    }

    return env.ASSETS.fetch(request);
}

async function authRoutes(request: Request, env: Env, url: URL): Promise<Response> {
    const { pathname } = url;
    if (pathname === '/api/auth/start') {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
        return new Response(
          'Google sign-in is not configured yet: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET '
          + 'are missing on this Worker.', { status: 503 });
      }
      const state = await signState(env.SESSION_SECRET, { r: url.searchParams.get('r') ?? '/' });
      return Response.redirect(googleAuthUrl({
        clientId: env.GOOGLE_CLIENT_ID,
        redirectUri: `${url.origin}/api/auth/callback`,
        state,
        loginHint: env.ALLOWED_EMAIL,
      }), 302);
    }

    if (pathname === '/api/auth/callback') {
      const err = url.searchParams.get('error');
      if (err) return signInPage(`Google returned an error: ${err}`);

      const state = await verifyState<{ r?: string }>(
        env.SESSION_SECRET, url.searchParams.get('state'));
      if (!state) return signInPage('That sign-in link expired. Try again.');

      const code = url.searchParams.get('code');
      if (!code) return signInPage('Google did not return an authorization code.');

      const exchanged = await exchangeGoogleCode({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        code,
        redirectUri: `${url.origin}/api/auth/callback`,
      });
      if ('error' in exchanged) return signInPage(exchanged.error);

      const verdict = checkClaims(exchanged.claims, env.GOOGLE_CLIENT_ID, env.ALLOWED_EMAIL);
      if (!verdict.ok) return signInPage(verdict.reason);

      const token = await mintSession(env.SESSION_SECRET);
      // Secure only over https: a Secure cookie is never sent back over plain http,
      // which breaks `wrangler dev` on 127.0.0.1. Production is always https.
      const secure = url.protocol === 'https:';
      const back = typeof state.r === 'string' && state.r.startsWith('/') ? state.r : '/';
      return new Response(null, {
        status: 302,
        headers: { location: back, 'set-cookie': sessionCookie(token, secure) },
      });
    }

    return bad('Unknown auth route', 404);
}

/** Server-rendered page for sign-in failures, so a rejected account gets a real reason
 * instead of a blank redirect loop. */
function signInPage(message: string): Response {
  const safe = message.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>JobHunt</title><style>
:root{color-scheme:light dark;--bg:#fbfaf9;--fg:#1c1b19;--mut:#6b6864;--line:#e4e1dc;--accent:#1f4e79;--risk:#b3261e}
@media(prefers-color-scheme:dark){:root{--bg:#191817;--fg:#eceae7;--mut:#9a958f;--line:#312f2c;--accent:#7fb2e5;--risk:#e8837c}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--fg);
font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;padding:16px}
.card{width:100%;max-width:24rem;border:1px solid var(--line);border-radius:14px;padding:1.75rem;text-align:center}
h1{margin:0 0 .5rem;font-size:1.2rem}
p{margin:0 0 1.25rem;color:var(--risk);font-size:.9rem}
a{display:block;padding:.7rem;border-radius:9px;background:var(--accent);color:#fff;
text-decoration:none;font-weight:600}
</style></head><body><div class="card">
<h1>Could not sign you in</h1><p>${safe}</p>
<a href="/api/auth/start">Try again with Google</a>
</div></body></html>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

async function api(request: Request, env: Env, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = request.method;
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]

  if (pathname === '/api/bootstrap') {
    const cfg = await loadConfig(env.DB);
    const counts = await env.DB.prepare(
      'SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all();
    const due = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM follow_ups WHERE done = 0 AND due_at <= date('now')").first<{ n: number }>();
    const onboarding = await onboardingStatus(env.DB, cfg);
    return json({
      identity: cfg.identity,
      thresholds: cfg.thresholds,
      archetypes: cfg.archetypes.map((a) => ({ id: a.id, name: a.name })),
      counts: counts.results,
      followups_due: due?.n ?? 0,
      onboarding_outstanding: onboarding.total - onboarding.done,
      industries: INDUSTRIES,
      stages: STAGES,
      connector_url: env.PUBLIC_MCP_URL ? `${env.PUBLIC_MCP_URL.replace(/\/+$/, '')}/mcp` : null,
    });
  }

  // Trash: every role turned away (on arrival, by the daily sweep, or by hand), newest
  // first, with the reason. Rows are never deleted, so anything here can be restored.
  if (pathname === '/api/trash' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT id, title, company, location, source, score, status, created_at, status_changed_at,
              COALESCE(NULLIF(notes, ''), drop_reason) AS reason
       FROM jobs WHERE status IN ('Skip', 'Discarded', 'Dead link')
       ORDER BY COALESCE(status_changed_at, created_at) DESC LIMIT 1000`,
    ).bind().all();
    return json(results);
  }

  // Every list of roles reads through here. There is no fixed cap: the board asks only for
  // active statuses and the Roles table pages. A LIMIT 400 used to hide half the pipeline
  // once it passed 400 roles, lowest scores first, with nothing on screen to say so.
  if (pathname === '/api/jobs' && method === 'GET') {
    const p = url.searchParams;
    const where: string[] = [];
    const binds: unknown[] = [];
    const statuses = (p.get('status') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    if (statuses.length) {
      where.push(`status IN (${statuses.map(() => '?').join(', ')})`);
      binds.push(...statuses);
    }
    const q = p.get('q')?.trim();
    if (q) {
      where.push('(title LIKE ? OR company LIKE ? OR location LIKE ?)');
      binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    const company = p.get('company');
    if (company) { where.push('company = ?'); binds.push(company); }
    const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(Math.max(Number(p.get('limit')) || 3000, 1), 5000);
    const offset = Math.max(Number(p.get('offset')) || 0, 0);
    const [rows, total] = await Promise.all([
      env.DB.prepare(
        `SELECT id, title, company, location, salary, url, source, score, score_breakdown,
                archetype, status, created_at, applied_at, next_interview_at, interview_count,
                status_changed_at, posted_at, closes_at, closes_source,
                resume_count, cl_count, followups_due, drop_reason, rating, rating_gap,
                c.industry AS company_industry, c.stage AS company_stage,
                COALESCE(c.priority, 'neutral') AS company_priority
         FROM v_pipeline LEFT JOIN companies c ON c.name = v_pipeline.company ${w}
         ORDER BY score DESC, created_at DESC LIMIT ? OFFSET ?`,
      ).bind(...binds, limit, offset).all(),
      env.DB.prepare(`SELECT COUNT(*) AS n FROM jobs ${w}`).bind(...binds).first<{ n: number }>(),
    ]);
    return json({ rows: rows.results, total: total?.n ?? 0 });
  }

  // One row per company across every role ever seen there, trashed ones included, so a
  // company that keeps posting off-target roles is as visible as one worth watching.
  if (pathname === '/api/companies' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT agg.*, c.industry, c.stage, COALESCE(c.priority, 'neutral') AS priority,
              COALESCE(c.tags, '[]') AS tags, c.categorized_by
       FROM (SELECT company AS name, COUNT(*) AS total,
                SUM(status IN ('New','Generate','Complete','Applied','Interviewing','Offer')) AS active,
                SUM(status = 'Generate') AS queued,
                SUM(status IN ('Applied','Interviewing','Offer','Rejected')) AS applied,
                MAX(CASE WHEN status NOT IN ('Discarded','Skip','Dead link') THEN score END) AS best_score,
                MAX(created_at) AS last_seen,
                GROUP_CONCAT(DISTINCT source) AS sources
             FROM jobs GROUP BY company) agg
       LEFT JOIN companies c ON c.name = agg.name
       ORDER BY agg.active DESC, agg.best_score DESC, agg.total DESC`,
    ).bind().all();
    const watched = watchedBoards(await loadConfig(env.DB));
    return json(results.map((r) => {
      let tags: string[] = [];
      try { tags = JSON.parse(String(r.tags ?? '[]')); } catch { /* none */ }
      return { ...r, tags, watched: watched.get(String(r.name).toLowerCase()) ?? null };
    }));
  }

  // Editing a company's profile from the dashboard. What the person sets here is theirs:
  // Claude's categorizing never overwrites it.
  if (seg[1] === 'companies' && seg[2] && method === 'PUT') {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const r = await upsertCompany(env.DB, decodeURIComponent(seg[2]), body, 'you');
      return json(r.profile);
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''));
    }
  }

  if (seg[1] === 'companies' && seg[2] && method === 'GET') {
    const name = decodeURIComponent(seg[2]);
    const { results } = await env.DB.prepare(
      `SELECT id, title, company, location, salary, url, source, score, score_breakdown,
              archetype, status, created_at, applied_at, next_interview_at, interview_count,
              resume_count, cl_count, followups_due, drop_reason, rating, rating_gap
       FROM v_pipeline WHERE company = ? ORDER BY score DESC, created_at DESC`,
    ).bind(name).all();
    const watched = watchedBoards(await loadConfig(env.DB));
    return json({
      name, watched: watched.get(name.toLowerCase()) ?? null, roles: results,
      profile: await getCompany(env.DB, name),
    });
  }

  // Every file Claude has built, newest first, with the role it was built for and whether it
  // is the copy that actually went out in a submission.
  if (pathname === '/api/documents' && method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT d.id, d.job_id, d.kind, d.filename, d.byte_size, d.page_count,
              d.page_count_verified, d.base_resume, d.generated_at,
              j.title, j.company, j.status,
              EXISTS (SELECT 1 FROM submissions s WHERE s.resume_document_id = d.id
                        OR s.cover_letter_document_id = d.id) AS submitted
       FROM documents d JOIN jobs j ON j.id = d.job_id
       ORDER BY d.generated_at DESC`,
    ).bind().all();
    return json(results);
  }

  // Deleting a file you do not want, such as a bad build. The file that went out with an
  // application is refused (409): it is the record interview prep reads.
  if (seg[1] === 'documents' && seg[2] && method === 'DELETE') {
    try {
      return json(await deleteDocument(env.DB, seg[2]));
    } catch (e) {
      const msg = String(e).replace(/^Error:\s*/, '');
      return bad(msg, /no such document/.test(msg) ? 404 : 409);
    }
  }

  // Enter a role by hand: a referral, something found while browsing, a target company.
  // Scored and deduped by the same code path as an automated find.
  if (pathname === '/api/jobs' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as {
      title?: string; company?: string; location?: string; url?: string;
      salary?: string; jd_text?: string; rating?: number | null; queue?: boolean;
      posted_at?: string | null; closes_at?: string | null; closes_source?: 'stated' | 'listing' | null;
    };
    if (!body.title?.trim() || !body.company?.trim()) {
      return bad('A title and a company are required.');
    }
    const cfg = await loadConfig(env.DB);
    try {
      const r = await addManualJob(env.DB, cfg, {
        title: body.title.trim(), company: body.company.trim(),
        location: body.location ?? null, url: body.url ?? null, salary: body.salary ?? null,
        jd_text: body.jd_text ?? null, source: 'manual', rating: body.rating ?? null,
        posted_at: body.posted_at ?? null, closes_at: body.closes_at ?? null,
        closes_source: body.closes_at ? (body.closes_source === 'listing' ? 'listing' : 'stated') : null,
      });
      // "Queue documents now" is the person's own call, so it wins over the score and over
      // the build run's fit check. A role already applied to or further along is left alone.
      let status = r.status;
      if (body.queue && ['New', 'Discarded', 'Skip', 'Unverified'].includes(r.status)) {
        await setStatus(env.DB, r.id, 'Generate', 'human', 'Queued by you when added');
        status = 'Generate';
      }
      const why = await env.DB.prepare('SELECT drop_reason FROM jobs WHERE id = ?').bind(r.id)
        .first<{ drop_reason: string | null }>();
      return json({ ...r, status, drop_reason: why?.drop_reason ?? null }, { status: r.duplicate ? 200 : 201 });
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''));
    }
  }

  // A pasted link becomes a filled-in role: the ATS API where there is one (Greenhouse,
  // Lever), YC's page data, or the schema.org JobPosting most career pages embed. Whatever
  // it cannot read, the form shows empty for the person to fill.
  if (pathname === '/api/fetch-jd' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { url?: string };
    const cfg = await loadConfig(env.DB);
    const r = await resolvePosting(body.url ?? '', fetch, boardNames(cfg.target_boards));
    let existing: unknown = null;
    if (r.title && r.company) {
      existing = await env.DB.prepare('SELECT id, status, score FROM jobs WHERE normalized_key = ?')
        .bind(normalizeKey(r.title, r.company)).first();
    }
    return json({ ...r, existing });
  }

  if (seg[1] === 'jobs' && seg[3] === 'rating' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { rating?: number | null };
    try {
      const r = await setRating(env.DB, seg[2], body.rating ?? null);
      return json({ ok: true, rating: body.rating ?? null, moved_to: r.moved_to });
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''));
    }
  }

  if (seg[1] === 'jobs' && seg[2] && seg.length === 3 && method === 'GET') {
    const id = seg[2];
    const job = await env.DB.prepare('SELECT * FROM v_pipeline WHERE id = ?').bind(id).first();
    if (!job) return bad('No such job', 404);
    const [docs, history, ivs] = await Promise.all([
      env.DB.prepare(
        `SELECT id, kind, filename, byte_size, page_count, page_count_verified, base_resume,
                sha256, generated_at FROM documents WHERE job_id = ? ORDER BY generated_at DESC`).bind(id).all(),
      env.DB.prepare(
        'SELECT from_status, to_status, actor, at FROM status_history WHERE job_id = ? ORDER BY id DESC')
        .bind(id).all(),
      env.DB.prepare(
        `SELECT id, round, interviewer, interviewer_title, scheduled_at, outcome, hit_rate,
                debrief_at FROM interviews WHERE job_id = ? ORDER BY scheduled_at`).bind(id).all(),
    ]);
    const j = job as { id: string; title: string; company: string };
    return json({
      job, documents: docs.results, history: history.results, interviews: ivs.results,
      build_prompt: buildOnePrompt({ id: j.id, title: j.title, company: j.company }),
    });
  }

  if (seg[1] === 'jobs' && seg[3] === 'status' && method === 'POST') {
    const body = await request.json() as { status: JobStatus; note?: string };
    try {
      // 'human': this endpoint is only reachable from a signed-in browser session
      const r = await setStatus(env.DB, seg[2], body.status, 'human', body.note);
      return json(r);
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''), 409);
    }
  }

  // Marking applied snapshots which exact documents went out, then flips the status.
  // The snapshot is what interview prep reads weeks later, when the tailored folders
  // have drifted.
  if (seg[1] === 'jobs' && seg[3] === 'apply' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as
      { portal_url?: string; method?: string; notes?: string };
    await recordSubmission(env.DB, {
      job_id: seg[2], portal_url: body.portal_url, method: body.method, notes: body.notes,
    });
    const r = await setStatus(env.DB, seg[2], 'Applied', 'human', body.notes);
    return json(r);
  }

  // A closing date the person sets outranks anything a source or a JD says, and is never
  // replaced by one. Clearing it lets the next source fill it again.
  if (seg[1] === 'jobs' && seg[3] === 'closes' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { closes_at?: string | null };
    const at = body.closes_at ? toIsoDate(body.closes_at) : null;
    if (body.closes_at && !at) return bad('Use a date like 2026-10-02.');
    const res = await env.DB.prepare(
      `UPDATE jobs SET closes_at = ?, closes_source = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(at, at ? 'you' : null, seg[2]).run();
    if (!res.meta.changes) return bad('No such job', 404);
    return json({ closes_at: at, closes_source: at ? 'you' : null });
  }

  // Correcting what a source got wrong or never gave: salary, location, the posting link.
  if (seg[1] === 'jobs' && seg[3] === 'details' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as {
      salary?: string | null; location?: string | null; url?: string | null;
    };
    try {
      return json(await updateJobDetails(env.DB, seg[2], body));
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''), /no such job/.test(String(e)) ? 404 : 400);
    }
  }

  if (seg[1] === 'jobs' && seg[3] === 'notes' && method === 'POST') {
    const body = await request.json() as { notes: string };
    await env.DB.prepare("UPDATE jobs SET notes = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(body.notes, seg[2]).run();
    return json({ ok: true });
  }

  if (pathname === '/api/flow') {
    const { results } = await env.DB.prepare(
      'SELECT id, status, drop_reason, resume_count, interview_count FROM v_pipeline',
    ).all<{ id: string; status: string; drop_reason: string | null;
            resume_count: number; interview_count: number }>();
    return json(pipelineFlow(results));
  }

  if (pathname === '/api/metrics') {
    const [weekly, sources, calib, ratingCalib, agreement] = await Promise.all([
      env.DB.prepare('SELECT * FROM v_weekly_activity LIMIT 12').all(),
      env.DB.prepare('SELECT * FROM v_source_performance ORDER BY found DESC').all(),
      env.DB.prepare('SELECT * FROM v_score_calibration').all(),
      env.DB.prepare('SELECT * FROM v_rating_calibration').all(),
      env.DB.prepare(
        `SELECT COUNT(*) AS rated, ROUND(AVG(rating_gap), 2) AS avg_gap,
                SUM(CASE WHEN rating_gap <= 1 THEN 1 ELSE 0 END) AS agree
         FROM v_pipeline WHERE rating_gap IS NOT NULL`).first(),
    ]);
    return json({
      weekly: weekly.results.reverse(),
      sources: sources.results,
      calibration: calib.results,
      rating_calibration: ratingCalib.results,
      agreement,
    });
  }

  if (pathname === '/api/followups' && method === 'GET') {
    const cfg = await loadConfig(env.DB);
    await refreshFollowUps(env.DB, cfg);
    const { results } = await env.DB.prepare(
      `SELECT f.id, f.kind, f.due_at, j.id AS job_id, j.title, j.company, j.url,
              s.applied_at, s.portal_url
       FROM follow_ups f JOIN jobs j ON j.id = f.job_id
       LEFT JOIN submissions s ON s.job_id = j.id
       WHERE f.done = 0 ORDER BY f.due_at`).all();
    return json(results);
  }

  if (seg[1] === 'followups' && seg[3] === 'done' && method === 'POST') {
    await env.DB.prepare(
      "UPDATE follow_ups SET done = 1, done_at = datetime('now') WHERE id = ?").bind(seg[2]).run();
    return json({ ok: true });
  }

  if (pathname === '/api/runs') {
    const { results } = await env.DB.prepare(
      `SELECT id, kind, started_at, finished_at, found, kept, duplicates, dropped,
              sources_used, sources_unavailable, errors, summary
       FROM runs ORDER BY started_at DESC LIMIT 100`).all();
    return json(results);
  }

  // ---- setup: onboarding, base resumes, ideal roles, goals, plan ----

  // ---- evidence bank ----

  if (pathname === '/api/evidence' && method === 'GET') {
    const kind = url.searchParams.get('kind') ?? undefined;
    const status = url.searchParams.get('status') ?? undefined;
    const items = await listEvidence(env.DB, { kind: kind as never, status: status as never });
    return json({ items, summary: await evidenceSummary(env.DB) });
  }

  if (pathname === '/api/evidence' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as EvidenceInput;
    try {
      // anything typed into the dashboard is the person's own statement
      const id = await upsertEvidence(env.DB, { ...body, source: body.source ?? 'user' });
      return json({ id }, { status: body.id ? 200 : 201 });
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''));
    }
  }

  if (seg[1] === 'evidence' && seg[2] && seg[3] === 'status' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { status?: string; note?: string };
    if (!['confirmed', 'rejected', 'unconfirmed'].includes(body.status ?? '')) {
      return bad('status must be confirmed, rejected or unconfirmed');
    }
    try {
      await setEvidenceStatus(env.DB, seg[2], body.status as never, body.note);
      return json({ ok: true });
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''), 409);
    }
  }

  if (seg[1] === 'evidence' && seg[2] && method === 'DELETE') {
    try {
      await deleteEvidence(env.DB, seg[2]);
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''), 404);
    }
    return json({ ok: true });
  }

  // ---- preferences and platforms ----

  if (pathname === '/api/preferences' && method === 'GET') {
    const cfg = await loadConfig(env.DB);
    return json({
      preferences: cfg.preferences,
      sources: SOURCES,
      feature_connectors: FEATURE_CONNECTORS,
      query_count: cfg.query_set.length,
    });
  }

  if (pathname === '/api/preferences' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    try {
      const r = await savePreferences(env.DB, await loadConfig(env.DB), body as never);
      return json(r);
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''));
    }
  }

  // Setup, "Connect Claude": the scheduled task prompts generated from the current settings,
  // so what the person pastes into Cowork is never a stale copy.
  if (pathname === '/api/setup/tasks' && method === 'GET') {
    return json(scheduledTaskPrompts(await loadConfig(env.DB)));
  }

  // A setup step only the person can vouch for, such as the skills uploaded to Claude.
  if (pathname === '/api/setup/confirm' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { step?: string; done?: boolean };
    if (!CONFIRMABLE_STEPS.includes(body.step as never)) return bad('That step is not confirmed by hand.');
    const list = await confirmSetupStep(env.DB, body.step as typeof CONFIRMABLE_STEPS[number], body.done !== false);
    return json({ confirmed: list });
  }

  if (pathname === '/api/setup/files' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT name, description, length(content_b64) * 3 / 4 AS bytes, updated_at FROM setup_files ORDER BY name',
    ).bind().all();
    return json(results);
  }

  if (seg[1] === 'setup' && seg[2] === 'files' && seg[3] && method === 'GET') {
    const f = await env.DB.prepare('SELECT name, content_b64 FROM setup_files WHERE name = ?')
      .bind(decodeURIComponent(seg[3])).first<{ name: string; content_b64: string }>();
    if (!f) return bad('No such file', 404);
    const bytes = Uint8Array.from(atob(f.content_b64), (c) => c.charCodeAt(0));
    return new Response(bytes, {
      headers: {
        'content-type': f.name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream',
        'content-disposition': `attachment; filename="${f.name.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
      },
    });
  }

  if (pathname === '/api/setup') {
    const cfg = await loadConfig(env.DB);
    const [onboarding, resumes, goals, profile] = await Promise.all([
      onboardingStatus(env.DB, cfg),
      listBaseResumes(env.DB),
      listGoals(env.DB, true),
      env.DB.prepare('SELECT field, value, category FROM profile ORDER BY category, field').all(),
    ]);
    return json({
      onboarding,
      base_resumes: resumes,
      goals,
      plan: cfg.plan ?? '',
      profile: profile.results,
      config: {
        identity: cfg.identity,
        thresholds: cfg.thresholds,
        archetypes: cfg.archetypes,
        target_boards: cfg.target_boards,
        locations_local: cfg.locations_local,
        query_set: cfg.query_set,
        exclude_terms_title: cfg.exclude_terms_title,
        override_terms: cfg.override_terms,
        base_resume_map: cfg.base_resume_map,
      },
    });
  }

  if (pathname === '/api/base-resumes' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as {
      label?: string; filename?: string; content_base64?: string; archetype?: number | null;
    };
    if (!body.label?.trim() || !body.filename || !body.content_base64) {
      return bad('A label, filename and file are required.');
    }
    const bytes = Uint8Array.from(atob(body.content_base64), (c) => c.charCodeAt(0));
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // Extract the text now: tailoring and the interview claim audit both read it, and a
    // master stored as opaque bytes would be useless to them.
    const extracted = await extractDocxText(bytes);
    const r = await saveBaseResume(env.DB, {
      label: body.label.trim(), filename: body.filename,
      archetype: body.archetype ?? null, content: bytes, sha256,
      extracted_text: extracted.ok ? extracted.text : null,
    });
    return json({
      ...r, bytes: bytes.length, sha256,
      text_extracted: extracted.ok,
      text_reason: extracted.ok ? undefined : extracted.reason,
    }, { status: 201 });
  }

  if (seg[1] === 'base-resumes' && seg[2] && method === 'DELETE') {
    try {
      await deleteBaseResume(env.DB, seg[2]);
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''), 404);
    }
    return json({ ok: true });
  }

  if (seg[1] === 'base-resumes' && seg[2] && seg[3] === 'file') {
    const r = await getBaseResume(env.DB, seg[2]);
    if (!r) return bad('No such base resume', 404);
    return new Response(r.bytes, {
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="${r.filename.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
      },
    });
  }

  if (pathname === '/api/goals' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as {
      id?: string; kind?: GoalKind; title?: string; target_value?: number | null;
      unit?: string; due_at?: string; status?: string; notes?: string;
    };
    if (!body.id && (!body.kind || !body.title?.trim())) return bad('A kind and a title are required.');
    try {
      // An edit is partial: fields left out of the body keep their value.
      const id = await upsertGoal(env.DB, { ...body, title: body.title?.trim() });
      return json({ id });
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''));
    }
  }

  if (seg[1] === 'goals' && seg[2] && method === 'DELETE') {
    try {
      await deleteGoal(env.DB, seg[2]);
    } catch (e) {
      return bad(String(e).replace(/^Error:\s*/, ''), 404);
    }
    return json({ ok: true });
  }

  if (pathname === '/api/plan' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { plan?: string };
    await putConfig(env.DB, 'plan', body.plan ?? '', 'the written job-search plan');
    return json({ ok: true });
  }

  if (pathname === '/api/config' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as { key?: string; value?: unknown };
    if (!body.key) return bad('A config key is required.');
    const cfg = await loadConfig(env.DB);
    if (!(body.key in cfg)) {
      return bad(`"${body.key}" is not a configuration key. Known keys: `
        + Object.keys(cfg).sort().join(', '));
    }
    await putConfig(env.DB, body.key, body.value);
    return json({ ok: true, key: body.key });
  }

  if (pathname === '/api/profile' && method === 'POST') {
    const body = await request.json().catch(() => ({})) as {
      entries?: { field: string; value: string; category: string }[];
    };
    const entries = body.entries ?? [];
    // The same refusal as the MCP tool: these get typed into real application forms, and
    // a stored demographic answer would be submitted silently on every one.
    const refused: string[] = [];
    let saved = 0;
    for (const e of entries) {
      if (forbiddenProfileField(e.field)) { refused.push(e.field); continue; }
      await env.DB.prepare(
        `INSERT INTO profile (field, value, category, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(field) DO UPDATE SET value = excluded.value,
           category = excluded.category, updated_at = datetime('now')`,
      ).bind(e.field, e.value, e.category).run();
      saved++;
    }
    return json({ saved, refused });
  }

  if (pathname === '/api/profile' && method === 'GET') {
    const { results } = await env.DB.prepare(
      'SELECT field, value, category FROM profile ORDER BY category, field').all();
    return json(results);
  }

  // Documents come out of the database, so nothing is publicly addressable.
  if (seg[0] === 'doc' && seg[1]) {
    const doc = await getDocument(env.DB, seg[1]);
    if (!doc) return bad('No such document', 404);
    return new Response(doc.bytes, {
      headers: {
        'content-type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'content-disposition': `attachment; filename="${doc.filename.replace(/"/g, '')}"`,
        'cache-control': 'private, no-store',
      },
    });
  }

  return bad('Unknown endpoint', 404);
}

/** Companies whose own job board is watched, keyed by lower-cased display name. Board entries
 * are "slug" or "slug:Display Name", and ingested roles carry the display name. */
function watchedBoards(cfg: Awaited<ReturnType<typeof loadConfig>>): Map<string, { ats: string; slug: string }> {
  const out = new Map<string, { ats: string; slug: string }>();
  for (const ats of ['greenhouse', 'lever', 'ashby'] as const) {
    for (const entry of cfg.target_boards?.[ats] ?? []) {
      const i = entry.indexOf(':');
      const slug = (i < 0 ? entry : entry.slice(0, i)).trim();
      const name = (i < 0 ? entry : entry.slice(i + 1)).trim() || slug;
      out.set(name.toLowerCase(), { ats, slug });
    }
  }
  return out;
}
