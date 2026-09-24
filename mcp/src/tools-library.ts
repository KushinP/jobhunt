import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  INDUSTRIES, PRIORITIES, STAGES, deleteDocument, docLink, getCompany, uncategorizedCompanies, upsertCompany,
} from '@jobhunt/core';
import { type Env, fail, ok } from './env.ts';

/** Documents, run history and company profiles: what the dashboard shows, for Claude too. */
export function registerLibraryTools(server: McpServer, env: Env): void {
  server.registerTool('list_documents', {
    description: 'Every built resume and cover letter, newest first, with the role it was built '
      + 'for, whether it went out with an application, and its dashboard link. Pass job_id for '
      + 'one role.',
    inputSchema: { job_id: z.string().optional(), limit: z.number().int().min(1).max(200).default(50) },
  }, async ({ job_id, limit }) => {
    const { results } = await env.DB.prepare(
      `SELECT d.id AS document_id, d.job_id, d.kind, d.filename, d.page_count, d.page_count_verified,
              d.generated_at, j.title, j.company, j.status,
              EXISTS (SELECT 1 FROM submissions s WHERE s.resume_document_id = d.id
                        OR s.cover_letter_document_id = d.id) AS submitted
       FROM documents d JOIN jobs j ON j.id = d.job_id
       ${job_id ? 'WHERE d.job_id = ?' : ''}
       ORDER BY d.generated_at DESC LIMIT ?`,
    ).bind(...(job_id ? [job_id, limit] : [limit])).all<{ document_id: string }>();
    return ok(results.map((r) => ({ ...r, link: docLink(env.PUBLIC_DASH_URL, r.document_id) })),
      `${results.length} documents`);
  });

  server.registerTool('delete_document', {
    description: 'Delete a built resume or cover letter, only when the person asks (for example '
      + 'a bad build they want redone). A file that went out with an application is refused: '
      + 'interview prep reads it. A Ready role left without a resume goes back to New.',
    inputSchema: { document_id: z.string() },
  }, async ({ document_id }) => {
    try {
      const r = await deleteDocument(env.DB, document_id);
      return ok(r, `Deleted. The role is now ${r.status}.`);
    } catch (e) {
      return fail(String(e).replace(/^Error:\s*/, ''));
    }
  });

  server.registerTool('list_runs', {
    description: 'Recent automated runs (search, document builds, weekly reviews) with their '
      + 'counts, the sources that failed or were unavailable, and errors. Use it to see whether '
      + 'a source has been quietly broken.',
    inputSchema: {
      kind: z.enum(['search', 'build_docs', 'weekly', 'followups', 'autofill', 'manual']).optional(),
      limit: z.number().int().min(1).max(60).default(14),
    },
  }, async ({ kind, limit }) => {
    const { results } = await env.DB.prepare(
      `SELECT id, kind, started_at, found, kept, duplicates, dropped, sources_used,
              sources_unavailable, errors, summary FROM runs
       ${kind ? 'WHERE kind = ?' : ''} ORDER BY started_at DESC LIMIT ?`,
    ).bind(...(kind ? [kind, limit] : [limit])).all();
    return ok(results, `${results.length} runs`);
  });

  server.registerTool('list_companies', {
    description: 'Companies with their profile (industry, stage, the person\'s priority: target, '
      + 'neutral or avoid) and role counts. With `uncategorized` true it returns only companies '
      + 'with no industry yet, each with a few role titles and the opening of a JD, which is '
      + 'what set_companies needs.',
    inputSchema: {
      uncategorized: z.boolean().default(false),
      active_only: z.boolean().default(true).describe('only companies with roles still in play'),
      industry: z.enum(INDUSTRIES).optional(),
      priority: z.enum(PRIORITIES).optional(),
      limit: z.number().int().min(1).max(100).default(40),
    },
  }, async ({ uncategorized, active_only, industry, priority, limit }) => {
    if (uncategorized) {
      const rows = await uncategorizedCompanies(env.DB, { activeOnly: active_only, limit });
      return ok(rows, `${rows.length} companies to categorize`);
    }
    const where: string[] = [];
    const binds: unknown[] = [];
    if (industry) { where.push('c.industry = ?'); binds.push(industry); }
    if (priority) { where.push("COALESCE(c.priority, 'neutral') = ?"); binds.push(priority); }
    const { results } = await env.DB.prepare(
      `SELECT agg.name, agg.roles, agg.active, c.industry, c.stage,
              COALESCE(c.priority, 'neutral') AS priority, c.tags, c.notes, c.categorized_by
       FROM (SELECT company AS name, COUNT(*) AS roles,
                SUM(status IN ('New','Generate','Complete','Applied','Interviewing','Offer')) AS active
             FROM jobs GROUP BY company) agg
       LEFT JOIN companies c ON c.name = agg.name
       WHERE ${active_only ? 'agg.active > 0' : '1 = 1'} ${where.length ? `AND ${where.join(' AND ')}` : ''}
       ORDER BY agg.active DESC, agg.roles DESC LIMIT ?`,
    ).bind(...binds, limit).all();
    return ok(results, `${results.length} companies`);
  });

  server.registerTool('set_companies', {
    description: 'Categorize companies: industry and stage from the fixed lists, plus optional '
      + 'tags and website. Judge from the job descriptions and what you know; leave a field out '
      + 'rather than guess. A company the person has edited in the dashboard is left alone and '
      + 'reported as skipped. Never set priority unless the person told you to target or avoid '
      + 'the company.',
    inputSchema: {
      companies: z.array(z.object({
        name: z.string().describe('exactly as list_companies returned it'),
        industry: z.enum(INDUSTRIES).optional(),
        stage: z.enum(STAGES).optional(),
        tags: z.array(z.string()).max(8).optional(),
        website: z.string().optional(),
        priority: z.enum(PRIORITIES).optional().describe("only on the person's explicit word"),
      })).min(1).max(60),
    },
  }, async ({ companies }) => {
    let saved = 0;
    const skipped: string[] = [];
    const failed: string[] = [];
    for (const c of companies) {
      try {
        const { name, ...patch } = c;
        const exists = await env.DB.prepare('SELECT 1 AS x FROM jobs WHERE company = ? LIMIT 1').bind(name).first();
        if (!exists && !(await getCompany(env.DB, name))) { failed.push(`${name}: no roles under that name`); continue; }
        const r = await upsertCompany(env.DB, name, patch, 'claude');
        if (r.saved) saved++; else skipped.push(`${name} (${r.reason})`);
      } catch (e) {
        failed.push(`${c.name}: ${String(e).replace(/^Error:\s*/, '')}`);
      }
    }
    return ok({ saved, skipped, failed },
      `${saved} saved${skipped.length ? `, ${skipped.length} left alone (set by the person)` : ''}${failed.length ? `, ${failed.length} failed` : ''}.`);
  });
}
