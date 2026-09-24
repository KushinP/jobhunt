import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  HumanOnlyStatusError, attachJd, ingestJobs, listQueue, loadConfig, logRun, putConfig,
  addManualJob, getDocument, recordSubmission, refreshFollowUps, rescoreJob, saveDocument,
  setRating, setStatus, resolvePosting, boardNames, statusSetBy, fetchMissingJds,
  startUpload, addChunk, uploadInstructions, UploadError, CHUNK_CHARS, docLink,
} from '@jobhunt/core';
import type { JobStatus } from '@jobhunt/core';
import { type Env, fail, ok } from './env.ts';

const STATUS = z.enum([
  'New', 'Generate', 'Complete', 'Applied', 'Interviewing', 'Offer', 'Rejected',
  'Skip', 'Unverified', 'Dead link', 'Discarded',
]);
/** What set_status may write: Applied, Interviewing, Offer and Rejected are the person's. */
const AUTO_STATUS = z.enum(['New', 'Generate', 'Complete', 'Skip', 'Unverified', 'Dead link', 'Discarded']);
const CLOSES = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
  .describe('the application deadline, only when the posting states one ("Apply by", Handshake\'s '
    + '"Apply by"), YYYY-MM-DD. Never guess one.');

const RAW_JOB = z.object({
  title: z.string(),
  company: z.string(),
  location: z.string().nullish(),
  salary: z.string().nullish(),
  url: z.string().nullish(),
  source: z.string().nullish(),
  source_job_id: z.string().nullish(),
  posted_at: z.string().nullish().describe('YYYY-MM-DD'),
  jd_text: z.string().nullish(),
  closes_at: CLOSES.nullish(),
});

export function registerPipelineTools(server: McpServer, env: Env): void {
  server.registerTool('get_config', {
    description: 'Read the job-hunt configuration: target archetypes, scoring weights and '
      + 'thresholds, exclusion and override terms, query set, base resume map, identity and '
      + 'document formatting rules. Read this before scoring, searching or writing documents.',
    inputSchema: {},
  }, async () => ok(await loadConfig(env.DB)));

  server.registerTool('put_config', {
    description: 'Replace one configuration key (for example thresholds, target_boards, '
      + 'archetypes or query_set). `value` is the COMPLETE new value for the key, not a patch: '
      + 'read get_config first and send the whole object or list back with your change. Takes '
      + 'effect immediately. Preferences go through set_preferences and the plan through put_plan, '
      + 'which validate them; this tool refuses those keys.',
    inputSchema: {
      key: z.string().describe('an existing key from get_config'),
      value: z.unknown().describe('the complete JSON value for the key'),
      note: z.string().optional(),
    },
  }, async ({ key, value, note }) => {
    const cfg = await loadConfig(env.DB);
    if (key === 'preferences') return fail('Use set_preferences: it validates and records what was answered.');
    if (key === 'plan') return fail('Use put_plan for the plan.');
    if (!(key in cfg)) return fail(`"${key}" is not a configuration key. Known keys: ${Object.keys(cfg).sort().join(', ')}`);
    let v = value;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { /* a plain string value */ } }
    const current = (cfg as unknown as Record<string, unknown>)[key];
    if (Array.isArray(current) !== Array.isArray(v) || typeof current !== typeof v) {
      return fail(`"${key}" holds ${Array.isArray(current) ? 'a list' : typeof current}; send the complete value in the same shape.`);
    }
    await putConfig(env.DB, key, v, note);
    return ok({ key, value: v }, `Config key "${key}" updated.`);
  });

  server.registerTool('ingest_jobs', {
    description: 'The only write path for new roles. Scores every job, applies the exclusion '
      + 'and override lists, and dedupes on title+company. A role already in the pipeline is '
      + 'enriched (JD, salary, posted date) and never re-statused, so a human decision is '
      + 'never undone by a later sighting. Returns per-job outcomes.',
    inputSchema: {
      source: z.string().describe('the site the roles came from, as a catalog id: "ziprecruiter", '
        + '"dice", "handshake", "wellfound", or "browser" for any other site'),
      jobs: z.array(RAW_JOB),
    },
  }, async ({ source, jobs }) => {
    const cfg = await loadConfig(env.DB);
    const r = await ingestJobs(env.DB, cfg, source, jobs);
    return ok(r, `${r.found} found | ${r.kept} kept | ${r.auto_generate} flagged to generate `
      + `| ${r.duplicates} duplicates | ${r.discarded} discarded | ${r.errors.length} errors`);
  });

  server.registerTool('list_queue', {
    description: 'Roles in Queued (API status Generate) still needing documents, in build order: '
      + 'the person\'s star rating first (5 high, unrated last), then score. Each row has `rating`, '
      + '`score`, `queued_by` ("you" or "automation"), `has_jd`, and `has_resume` / '
      + '`has_cover_letter`: a half-built role needs only the missing file.',
    inputSchema: { limit: z.number().int().min(1).max(100).default(25) },
  }, async ({ limit }) => ok(await listQueue(env.DB, limit)));

  server.registerTool('list_pipeline', {
    description: 'Browse the pipeline with optional filters. Use for questions like "what is '
      + 'waiting on me" or "what did we find today". `status_set_by` says who put each role in its '
      + 'current status: "you" (the person, whose call automation must not undo), "automation", or '
      + 'null when the scorer set it on arrival.',
    inputSchema: {
      status: STATUS.optional(),
      min_score: z.number().int().optional(),
      since_days: z.number().int().optional(),
      missing_jd: z.boolean().optional()
        .describe('only roles still waiting for their job description'),
      company: z.string().optional().describe('exact company name'),
      q: z.string().optional().describe('text to find in the title, company or location'),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0).describe('skip this many rows, to page past the first 200'),
    },
  }, async ({ status, min_score, since_days, missing_jd, company, q, limit, offset }) => {
    const where: string[] = [];
    const binds: unknown[] = [];
    if (status) { where.push('status = ?'); binds.push(status); }
    if (min_score != null) { where.push('score >= ?'); binds.push(min_score); }
    if (since_days != null) {
      where.push("created_at >= datetime('now', '-' || ? || ' days')"); binds.push(since_days);
    }
    if (missing_jd) where.push("(jd_text IS NULL OR length(jd_text) < 800)");
    if (company) { where.push('company = ?'); binds.push(company); }
    if (q) { where.push('(title LIKE ? OR company LIKE ? OR location LIKE ?)'); binds.push(`%${q}%`, `%${q}%`, `%${q}%`); }
    const sql = `SELECT id, title, company, location, salary, url, source, source_job_id, score, rating,
                        archetype, status, status_changed_at, created_at, applied_at, next_interview_at,
                        closes_at, closes_source, resume_count, cl_count,
                        (SELECT CASE WHEN h.actor = 'automation' THEN 'automation' ELSE 'you' END
                           FROM status_history h WHERE h.job_id = v_pipeline.id AND h.to_status = v_pipeline.status
                           ORDER BY h.id DESC LIMIT 1) AS status_set_by
                 FROM v_pipeline
                 ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                 ORDER BY score DESC, created_at DESC LIMIT ? OFFSET ?`;
    const { results } = await env.DB.prepare(sql).bind(...binds, limit, offset).all();
    return ok(results, `${results.length} rows`);
  });

  server.registerTool('get_job', {
    description: 'Full detail for one role including the job description text, score '
      + 'breakdown, documents built and status history. `job.status_set_by` says who put it in its '
      + 'current status: "you" (the person, whose call automation must not undo), "automation", or '
      + 'null when the scorer set it on arrival. In `history`, actor "human" is a dashboard click, '
      + '"human-via-chat" is Claude acting on the person\'s words in a chat, "automation" is a run.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    const job = await env.DB.prepare('SELECT * FROM v_pipeline WHERE id = ?').bind(id).first();
    if (!job) return fail(`No job with id ${id}`);
    const docs = await env.DB.prepare(
      'SELECT id, kind, filename, byte_size, page_count, page_count_verified, base_resume, generated_at '
      + 'FROM documents WHERE job_id = ? ORDER BY generated_at DESC').bind(id).all();
    const history = await env.DB.prepare(
      'SELECT from_status, to_status, actor, at FROM status_history WHERE job_id = ? ORDER BY id')
      .bind(id).all();
    const interviews = await env.DB.prepare(
      `SELECT id, round, interviewer, interviewer_title, scheduled_at, outcome, hit_rate, debrief_at
       FROM interviews WHERE job_id = ? ORDER BY scheduled_at`).bind(id).all();
    // what actually went out: interview prep and debriefs read these exact files
    const submission = await env.DB.prepare(
      `SELECT applied_at, portal_url, method, resume_document_id, cover_letter_document_id,
              resume_sha256, cover_letter_sha256 FROM submissions WHERE job_id = ?`).bind(id).first();
    return ok({
      job: { ...job, status_set_by: await statusSetBy(env.DB, id) },
      documents: docs.results, history: history.results, interviews: interviews.results, submission,
    });
  });

  server.registerTool('set_status', {
    description: 'Move a role through the pipeline. Applied, Interviewing, Offer and Rejected '
      + 'are human-only and not offered here: they mean a human made a judgement, and a '
      + 'tracker that can fake them is not worth keeping. Use mark_applied when the user '
      + 'explicitly says they submitted an application. Complete (Ready) is refused until the '
      + 'role has a resume saved with save_document. When the person asks for the move in this '
      + 'chat, pass their words as user_statement: the move is then recorded as theirs, and '
      + 'scheduled runs will not undo it. Never pass it from a scheduled run.',
    inputSchema: {
      id: z.string(), status: AUTO_STATUS, note: z.string().optional(),
      user_statement: z.string().min(4).optional()
        .describe("the person's own words in this chat asking for this move, quoted exactly"),
    },
  }, async ({ id, status, note, user_statement }) => {
    try {
      const r = await setStatus(env.DB, id, status as JobStatus,
        user_statement ? 'human-via-chat' : 'automation',
        user_statement ? [`They said: "${user_statement}"`, note].filter(Boolean).join('\n') : note);
      return ok(r, `${r.from} -> ${r.to}`);
    } catch (e) {
      if (e instanceof HumanOnlyStatusError) {
        return fail(`${e.message}. If the user said they applied, call mark_applied instead.`);
      }
      return fail(String(e));
    }
  });

  server.registerTool('mark_applied', {
    description: 'Record that the user submitted this application. Call this ONLY when the '
      + 'user has said so in conversation; never from a scheduled run. It snapshots which '
      + 'exact documents went out, then sets the status to Applied. The status history records '
      + 'that it came from chat rather than from the dashboard.',
    inputSchema: {
      id: z.string(),
      user_statement: z.string().min(8)
        .describe("the person's own words in this chat saying they submitted it, quoted exactly"),
      portal_url: z.string().optional(),
      method: z.string().optional(),
      notes: z.string().optional(),
    },
  }, async ({ id, user_statement, portal_url, method, notes }) => {
    try {
      await recordSubmission(env.DB, {
        job_id: id, portal_url, method,
        notes: [`They said: "${user_statement}"`, notes].filter(Boolean).join('\n'),
      });
      const r = await setStatus(env.DB, id, 'Applied', 'human-via-chat', notes);
      return ok(r, 'Submission snapshot saved and status set to Applied.');
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool('add_role', {
    description: 'Enter one role by hand: a referral, something the user found while '
      + 'browsing, or a posting link they pasted. Pass just `url` and the title, company, '
      + 'location, salary and full JD are read from the posting (Greenhouse, Lever, Ashby, YC, '
      + 'LinkedIn and most career sites; Indeed blocks this, so ask the user to paste the JD). '
      + 'Scored and deduped by the same rules as an automated find. If the role already exists '
      + 'it returns the existing row. Set `queue` true ONLY when the user asked for a resume or '
      + 'documents for this role: it moves the role to Generate as their own decision, which the '
      + 'build run honours even over its fit check.',
    inputSchema: {
      url: z.string().optional(),
      title: z.string().optional(),
      company: z.string().optional(),
      location: z.string().optional(),
      salary: z.string().optional(),
      jd_text: z.string().optional(),
      closes_at: CLOSES.optional(),
      rating: z.number().int().min(1).max(5).optional()
        .describe("the user's own 1-5 rating, only if they gave one"),
      queue: z.boolean().default(false),
      user_statement: z.string().optional()
        .describe('required with queue: the person\'s own words asking for documents for this role'),
    },
  }, async (a) => {
    if (a.queue && (a.user_statement ?? '').trim().length < 8) {
      return fail('queue is the person\'s own decision: pass their words asking for documents as user_statement, or leave queue false.');
    }
    const cfg = await loadConfig(env.DB);
    let role: typeof a & { posted_at?: string | null; closes_source?: 'stated' | 'listing' | null } = { ...a };
    let via = 'typed';
    const warnings: string[] = [];
    if (a.url && (!a.title || !a.company || !a.jd_text)) {
      const r = await resolvePosting(a.url, fetch, boardNames(cfg.target_boards));
      if (!r.ok && (!a.title || !a.company)) {
        return fail(`Could not read that posting: ${r.reason ?? 'no posting found'}`);
      }
      via = r.via;
      // Page text is a guess: the title is split from the browser tab title and the "JD" is
      // everything on the page. Ask rather than store a guess as the role.
      const guessed = r.via === 'page';
      if (guessed && (!a.title || !a.company)) {
        return fail(`That page has no structured posting, so the title and company would be guesses `
          + `(the page title reads "${r.title ?? 'nothing'}"). Ask the person for the title and company, `
          + 'then call add_role again with url, title and company.');
      }
      const pageJd = guessed ? ((r.jd_text ?? '').length >= 800 ? r.jd_text : null) : r.jd_text;
      if (guessed && !a.jd_text) {
        warnings.push(pageJd
          ? 'The JD is the page\'s raw text: check it, and attach_jd the real description if it reads wrong.'
          : 'The page had too little text to use as the JD: attach_jd the description when you have it.');
      }
      role = {
        ...role,
        title: a.title ?? r.title ?? undefined, company: a.company ?? r.company ?? undefined,
        location: a.location ?? r.location ?? undefined, salary: a.salary ?? r.salary ?? undefined,
        jd_text: a.jd_text ?? pageJd ?? undefined, url: r.url,
        posted_at: r.posted_at ?? null,
        closes_at: a.closes_at ?? r.closes_at ?? undefined,
        closes_source: a.closes_at ? 'stated' : r.closes_source ?? null,
      };
    }
    if (!role.title || !role.company) return fail('A title and a company are needed (or a readable posting url).');
    try {
      const r = await addManualJob(env.DB, cfg, {
        title: role.title, company: role.company, location: role.location ?? null, url: role.url ?? null,
        salary: role.salary ?? null, jd_text: role.jd_text ?? null, rating: role.rating ?? null, source: 'manual',
        posted_at: role.posted_at ?? null, closes_at: role.closes_at ?? null,
        closes_source: role.closes_source ?? (role.closes_at ? 'stated' : null),
      });
      let status = r.status;
      if (a.queue && ['New', 'Discarded', 'Skip', 'Unverified'].includes(r.status)) {
        await setStatus(env.DB, r.id, 'Generate', 'human', `Queued by you in chat: "${a.user_statement}"`);
        status = 'Generate';
      }
      const line = `${role.title} at ${role.company} (read via ${via})`;
      return ok({ ...r, status, warnings }, (r.duplicate
        ? `${line} is already in the pipeline as ${status} (score ${r.score}).`
        : `Added ${line} at score ${r.score}, status ${status}.`
          + (status === 'Generate' ? ' It builds on the next document run, or build it now.' : ''))
        + (warnings.length ? ` ${warnings.join(' ')}` : ''));
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool('rate_job', {
    description: "Record the user's own 1-5 rating of a role. A rating of 1 or 2 means they do not want it built: a queued role goes back to New and cannot be queued again until rated 3 or more. This is deliberately separate "
      + 'from the computed score: comparing the two is what shows whether the scoring '
      + 'rubric is actually predicting anything. Pass null to clear a rating. Only ever '
      + 'set this from what the user said, never from your own judgement of the role.',
    inputSchema: {
      id: z.string(),
      rating: z.number().int().min(1).max(5).nullable(),
    },
  }, async ({ id, rating }) => {
    try {
      const r = await setRating(env.DB, id, rating, 'human-via-chat');
      if (r.moved_to) return ok({ id, rating, moved_to: r.moved_to }, `Rated ${rating}/5. That is too low to build, so it left Queued for New.`);
      return ok({ id, rating }, rating === null ? 'Rating cleared.' : `Rated ${rating}/5.`);
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool('rescore_job', {
    description: 'Re-run scoring on the stored title and JD. Use it after changing archetypes, '
      + 'terms or thresholds with put_config (attach_jd already re-scores). Updates the score, '
      + 'breakdown and archetype; deliberately leaves the status alone.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    const cfg = await loadConfig(env.DB);
    try {
      return ok(await rescoreJob(env.DB, cfg, id));
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool('attach_jd', {
    description: 'Store the fetched job description for a role and re-score it. Roles found '
      + 'without a JD are held in New provisionally; once the JD is attached, the real score '
      + 'moves them to Generate, Discarded, or leaves them in New. A status the person has set '
      + 'is never changed. Pass the full posting text, not a search snippet. Pass `url` when '
      + 'the posting sends applicants to the employer\'s own site (Handshake "apply externally"): '
      + 'that is where the application is filled, so it replaces the stored link.',
    inputSchema: {
      id: z.string(), jd_text: z.string(), verified: z.boolean().default(true),
      url: z.string().url().optional(),
      closes_at: CLOSES.optional(),
    },
  }, async ({ id, jd_text, verified, url, closes_at }) => {
    try {
      if (url) {
        await env.DB.prepare("UPDATE jobs SET url = ?, updated_at = datetime('now') WHERE id = ?").bind(url, id).run();
      }
      if (closes_at) {
        // A deadline read off the posting page; one the person set in the dashboard stays.
        await env.DB.prepare(
          `UPDATE jobs SET closes_at = ?, closes_source = 'stated', updated_at = datetime('now')
           WHERE id = ? AND COALESCE(closes_source, '') <> 'you'`,
        ).bind(closes_at, id).run();
      }
      const r = await attachJd(env.DB, await loadConfig(env.DB), id, jd_text, verified);
      return ok(r, r.moved
        ? `Scored ${r.score.score} on the full JD: ${r.from} -> ${r.to}.`
        : `Scored ${r.score.score}; status left as ${r.from}.`);
    } catch (e) { return fail(String(e)); }
  });

  server.registerTool('fetch_jds', {
    description: 'Fill missing job descriptions on the server, which can read postings Claude\'s '
      + 'fetcher cannot (LinkedIn, including alert-email links; Greenhouse, Lever, Ashby, YC and '
      + 'most career pages). Each description found is attached and re-scored exactly like '
      + 'attach_jd. With no ids it takes the best-scoring Queued and New roles still missing one, '
      + '`limit` per call (call again while `remaining` is above 0). Indeed and ZipRecruiter refuse '
      + 'servers: those come back in `needs_connector` for the Indeed connector or the person\'s '
      + 'browser. A role the server could not read is skipped for three days, and stays in New. If '
      + 'LinkedIn throttles (`rate_limited`), the untouched roles wait for the next call or run.',
    inputSchema: {
      ids: z.array(z.string()).max(25).optional().describe('specific roles; omit to take the best-scoring ones'),
      limit: z.number().int().min(1).max(25).default(10)
        .describe('roles to read this call; LinkedIn is read about one every three seconds, so keep it near 10'),
      dry_run: z.boolean().default(false).describe('read the postings but attach nothing'),
    },
  }, async ({ ids, limit, dry_run }) => {
    const r = await fetchMissingJds(env.DB, await loadConfig(env.DB), { ids, limit, dryRun: dry_run });
    const moved = r.attached.filter((a) => a.from !== a.to);
    return ok(r, `${dry_run ? '[dry run] ' : ''}${r.attached.length} JDs ${dry_run ? 'readable' : 'attached'}`
      + (moved.length ? ` (${moved.map((a) => `${a.title} @ ${a.company}: ${a.from} -> ${a.to}`).join('; ')})` : '')
      + `, ${r.failed.length} unreadable, ${r.needs_connector.length} need a connector, ${r.remaining} left for another call.`);
  });

  server.registerTool('start_document_upload', {
    description: 'Save a built resume or cover letter WITHOUT retyping the file. Call it with the '
      + 'role, kind, filename, your local file\'s sha256 and the details (content spec, page '
      + 'count); it returns a single-use upload link (30 minutes) and the exact shell commands. '
      + 'Then run its `curl` command from the shell: the file goes straight from your sandbox and '
      + 'the reply confirms the saved document and its link. If curl cannot reach the server, use '
      + 'its `chunks` command and send each piece with upload_document_chunk. Use this instead of '
      + 'save_document for any file over a few KB: long base64 copied into a tool call drifts.',
    inputSchema: {
      job_id: z.string(),
      kind: z.enum(['resume', 'cover_letter']),
      filename: z.string(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/i).describe('sha256 of your local .docx (sha256sum FILE)'),
      base_resume: z.string().optional(),
      word_count: z.number().int().optional(),
      page_count: z.number().int().optional(),
      page_count_verified: z.boolean().default(false),
      spec: z.unknown().optional().describe('the content spec, including the evidence ids used'),
    },
  }, async (a) => {
    try {
      const { upload_id, expires_at } = await startUpload(env.DB, a);
      const upload_url = `${env.PUBLIC_MCP_URL.replace(/\/+$/, '')}/upload/${upload_id}`;
      const how = uploadInstructions(upload_url, upload_id);
      return ok({ upload_id, upload_url, expires_at_utc: expires_at, ...how, chunk_chars: CHUNK_CHARS },
        `Upload ready for ${a.filename}. Run, replacing FILE with the path to the .docx:\n${how.curl}\n`
        + 'The reply is JSON: ok true with the document id and link means it is saved. If curl cannot '
        + `connect, run the chunks command and call upload_document_chunk with upload_id ${upload_id} for each line.`);
    } catch (e) {
      return fail(e instanceof UploadError ? e.message : String(e));
    }
  });

  server.registerTool('upload_document_chunk', {
    description: 'One piece of a file started with start_document_upload, for when curl cannot reach '
      + 'the server. Pieces are about 4,000 characters of the file\'s base64, each with the sha256 of '
      + 'that piece\'s text (the chunks command prints index, total, sha256 and the piece on each '
      + 'line). A piece that arrives different is refused alone: resend just that one. When the last '
      + 'piece arrives the file is checked against its declared sha256 and saved.',
    inputSchema: {
      upload_id: z.string(),
      index: z.number().int().min(0),
      total: z.number().int().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/i).describe("sha256 of this piece's text"),
      data: z.string().max(CHUNK_CHARS + 200),
    },
  }, async ({ upload_id, index, total, sha256, data }) => {
    try {
      const r = await addChunk(env.DB, upload_id, { index, total, data, sha256 }, env.PUBLIC_DASH_URL);
      return r.saved
        ? ok(r, `All ${total} pieces in; saved (${r.bytes} bytes). Link: ${r.link}`)
        : ok(r, `Piece ${index} saved; ${r.received} of ${r.total} in. Still missing: ${r.missing.join(', ')}.`);
    } catch (e) {
      return fail(e instanceof UploadError ? e.message : String(e));
    }
  });

  server.registerTool('save_document', {
    description: 'Store a small generated resume or cover letter by passing the whole .docx as '
      + 'base64. For anything over a few KB use start_document_upload instead: a long base64 '
      + 'string copied into a tool call drifts and is refused. Include the content spec you used, '
      + 'and page_count_verified=false if the page count is an estimate.',
    inputSchema: {
      job_id: z.string(),
      kind: z.enum(['resume', 'cover_letter']),
      filename: z.string(),
      content_base64: z.string(),
      base_resume: z.string().optional(),
      word_count: z.number().int().optional(),
      page_count: z.number().int().optional(),
      page_count_verified: z.boolean().default(false),
      spec: z.unknown().optional(),
      sha256: z.string().regex(/^[0-9a-f]{64}$/i).optional()
        .describe('the sha256 of your local file: pass it, and a copy that arrives different is refused instead of stored'),
    },
  }, async (a) => {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(a.content_base64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    } catch {
      return fail('content_base64 is not valid base64. Re-encode the .docx and save again.');
    }
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
      return fail('That is not a .docx (a .docx is a zip file starting with "PK"). Nothing was saved.');
    }
    const job = await env.DB.prepare('SELECT id FROM jobs WHERE id = ?').bind(a.job_id).first();
    if (!job) return fail(`No role with id ${a.job_id}`);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // A long base64 string copied into a tool call can change a character; storing that copy
    // leaves a broken file on the role. Refuse it, so the run retries instead.
    if (a.sha256 && a.sha256.toLowerCase() !== sha256) {
      return fail(`The file arrived different from yours (sha256 ${sha256.slice(0, 12)}…, yours `
        + `${a.sha256.slice(0, 12).toLowerCase()}…): a character changed in the copy. Nothing was saved. Send it again; `
        + 'if it differs twice, re-zip the .docx at a different compression level (same content, '
        + 'new bytes) and send that.');
    }
    const id = await saveDocument(env.DB, { ...a, content: bytes, sha256 });
    const link = docLink(env.PUBLIC_DASH_URL, id);
    return ok({ document_id: id, sha256, bytes: bytes.length, link },
      `Stored ${a.filename} (${bytes.length} bytes). Compare this sha256 with your local file's to confirm it arrived intact. The person opens it at ${link} or in the dashboard's Documents tab.`);
  });

  server.registerTool('get_document', {
    description: 'Fetch a stored document back as base64, for verification or to attach to '
      + 'an application portal. Take the document_id from get_job.',
    inputSchema: { document_id: z.string() },
  }, async ({ document_id }) => {
    const doc = await getDocument(env.DB, document_id);
    if (!doc) return fail(`No document with id ${document_id}`);
    let bin = '';
    for (const b of doc.bytes) bin += String.fromCharCode(b);
    return ok({
      document_id, filename: doc.filename, kind: doc.kind, sha256: doc.sha256,
      bytes: doc.bytes.length, content_base64: btoa(bin),
    });
  });

  server.registerTool('record_interview', {
    description: 'Log a scheduled interview and the predictions made for it, so the debrief '
      + 'can score prediction accuracy later.',
    inputSchema: {
      job_id: z.string(),
      round: z.enum(['recruiter_screen', 'hiring_manager', 'case', 'superday', 'panel', 'final']),
      interviewer: z.string().optional(),
      interviewer_title: z.string().optional(),
      interviewer_linkedin: z.string().optional(),
      scheduled_at: z.string().optional()
        .describe('ISO date and time with its offset, e.g. "2026-10-02T14:00:00-04:00"'),
      format: z.string().optional(),
      prep_ref: z.string().optional(),
      predictions: z.unknown().optional(),
    },
  }, async (a) => {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO interviews (id, job_id, round, interviewer, interviewer_title,
         interviewer_linkedin, scheduled_at, format, prep_ref, predictions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, a.job_id, a.round, a.interviewer ?? null, a.interviewer_title ?? null,
      a.interviewer_linkedin ?? null, a.scheduled_at ?? null, a.format ?? null,
      a.prep_ref ?? null, a.predictions ? JSON.stringify(a.predictions) : null,
    ).run();
    return ok({ interview_id: id });
  });

  server.registerTool('debrief_interview', {
    description: 'Record what actually happened after an interview: the outcome, the '
      + 'prediction hit rates, and the one concrete rule to carry forward. Skipping this is '
      + 'what makes an interview-prep system stay exactly as good as the day it was built.',
    inputSchema: {
      interview_id: z.string(),
      outcome: z.enum(['pending', 'advanced', 'rejected', 'withdrew', 'offer']),
      hit_rate: z.number().min(0).max(100).optional()
        .describe('percent of the predicted questions that came up, 0-100'),
      decisive_hit_rate: z.number().min(0).max(100).optional()
        .describe('percent of the questions that decided the outcome that were predicted, 0-100'),
      what_worked: z.string().optional(),
      what_missed: z.string().optional(),
      handled_badly: z.string().optional(),
      rule: z.string().describe('Concrete and generalizable. Not "research the manager more".'),
    },
  }, async (a) => {
    await env.DB.prepare(
      `UPDATE interviews SET outcome = ?, hit_rate = ?, decisive_hit_rate = ?,
         debrief_at = datetime('now') WHERE id = ?`,
    ).bind(a.outcome, a.hit_rate ?? null, a.decisive_hit_rate ?? null, a.interview_id).run();

    const ctx = await env.DB.prepare(
      `SELECT j.company, j.title FROM interviews i JOIN jobs j ON j.id = i.job_id
       WHERE i.id = ?`).bind(a.interview_id).first<{ company: string; title: string }>();

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO lessons (id, interview_id, company, role, outcome, what_worked,
         what_missed, handled_badly, rule) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, a.interview_id, ctx?.company ?? null, ctx?.title ?? null, a.outcome,
      a.what_worked ?? null, a.what_missed ?? null, a.handled_badly ?? null, a.rule,
    ).run();
    return ok({ lesson_id: id }, 'Debrief recorded and lesson logged.');
  });

  server.registerTool('list_lessons', {
    description: 'Every rule learned from past interview debriefs. Read this before building '
      + 'any new interview brief; any rule that applies must be reflected in it.',
    inputSchema: {},
  }, async () => {
    const { results } = await env.DB.prepare(
      'SELECT created_at, company, role, outcome, rule, promoted FROM lessons ORDER BY created_at DESC',
    ).all();
    return ok(results, `${results.length} lessons`);
  });

  server.registerTool('get_metrics', {
    description: 'Funnel health: weekly activity, performance by source, and whether the score '
      + 'actually predicts interviews. If the calibration table is flat, the weights are '
      + 'decoration and should be retuned.',
    inputSchema: {},
  }, async () => {
    const [weekly, sources, calib, counts] = await Promise.all([
      env.DB.prepare('SELECT * FROM v_weekly_activity LIMIT 12').all(),
      env.DB.prepare('SELECT * FROM v_source_performance').all(),
      env.DB.prepare('SELECT * FROM v_score_calibration').all(),
      env.DB.prepare('SELECT status, COUNT(*) AS n FROM jobs GROUP BY status').all(),
    ]);
    return ok({
      by_status: counts.results, weekly: weekly.results,
      by_source: sources.results, score_calibration: calib.results,
    });
  });

  server.registerTool('get_followups', {
    description: 'Follow-ups that are due: applications with no movement past the '
      + 'no-response window. Refreshes the list before returning it.',
    inputSchema: {},
  }, async () => {
    const cfg = await loadConfig(env.DB);
    const created = await refreshFollowUps(env.DB, cfg);
    const { results } = await env.DB.prepare(
      `SELECT f.id, f.kind, f.due_at, j.id AS job_id, j.title, j.company, s.applied_at
       FROM follow_ups f JOIN jobs j ON j.id = f.job_id
       LEFT JOIN submissions s ON s.job_id = j.id
       WHERE f.done = 0 AND f.due_at <= date('now') ORDER BY f.due_at`).all();
    return ok({ newly_created: created, due: results });
  });

  server.registerTool('complete_followup', {
    description: 'Mark a follow-up as handled. Pass the Gmail draft id you created, or, if no '
      + 'draft was made, notes saying why (for example "no thread with the company found"). '
      + 'Never close one without either: it would disappear with nothing done.',
    inputSchema: { id: z.string(), draft_id: z.string().optional(), notes: z.string().optional() },
  }, async ({ id, draft_id, notes }) => {
    if (!draft_id && !(notes ?? '').trim()) return fail('Pass the draft_id, or notes saying why no draft was made.');
    const exists = await env.DB.prepare('SELECT id FROM follow_ups WHERE id = ?').bind(id).first();
    if (!exists) return fail(`No follow-up with id ${id}`);
    await env.DB.prepare(
      `UPDATE follow_ups SET done = 1, done_at = datetime('now'),
         draft_id = COALESCE(?, draft_id), notes = COALESCE(?, notes) WHERE id = ?`,
    ).bind(draft_id ?? null, notes ?? null, id).run();
    return ok({ id }, 'Follow-up closed.');
  });

  server.registerTool('log_run', {
    description: 'Record what an automated run did, including sources that were unavailable, '
      + 'so a silently broken source shows up in the dashboard instead of looking like a quiet day.',
    inputSchema: {
      kind: z.enum(['search', 'build_docs', 'weekly', 'followups', 'autofill', 'manual']),
      found: z.number().int().optional(),
      kept: z.number().int().optional(),
      duplicates: z.number().int().optional(),
      dropped: z.number().int().optional(),
      sources_used: z.array(z.string()).optional(),
      sources_unavailable: z.array(z.string()).optional(),
      errors: z.array(z.unknown()).optional(),
      summary: z.string().optional(),
    },
  }, async (a) => ok({ run_id: await logRun(env.DB, a) }));
}
