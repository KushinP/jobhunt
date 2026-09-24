import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  FEATURE_CONNECTORS, SOURCES, deleteEvidence, evidenceSummary, listEvidence, loadConfig,
  savePreferences, scheduledTaskPrompts, setEvidenceStatus, upsertEvidence, SETUP_FILE_URL, TASK_SETUP_NOTES,
} from '@jobhunt/core';
import { type Env, fail, ok } from './env.ts';

const KIND = z.enum(['accomplishment', 'project', 'skill', 'metric', 'story', 'credential', 'boundary']);
const OWNERSHIP = z.enum(['built_myself', 'led', 'contributed', 'team']);
const MMYYYY = z.string().regex(/^((0[1-9]|1[0-2])\/\d{4}|Present)$/i, 'MM/YYYY or Present');

const ITEM = z.object({
  kind: KIND,
  title: z.string().describe('one line, e.g. "Built the computer-use agent that runs a hotel PMS"'),
  detail: z.string().optional().describe('the full fact in plain words, including what is NOT true if that matters'),
  context: z.string().optional().describe('employer, project or school the item belongs to'),
  ownership: OWNERSHIP.optional().describe('who actually did the work'),
  level: z.enum(['familiar', 'working', 'strong', 'expert']).optional().describe('skills only'),
  start_date: MMYYYY.optional(),
  end_date: MMYYYY.optional(),
  metrics: z.string().optional(),
  tools: z.array(z.string()).optional(),
  archetypes: z.array(z.number().int()).optional()
    .describe('archetype ids this supports; omit if it supports all of them'),
  proof_url: z.string().optional(),
  source: z.enum(['resume', 'user', 'document', 'repo']),
  source_ref: z.string().optional().describe('where it came from: the filename, URL or repo. Required '
    + 'before an item from a resume, document or repo can be confirmed; "chat YYYY-MM-DD" for '
    + 'something the person said.'),
});

export function registerEvidenceTools(server: McpServer, env: Env): void {
  server.registerTool('add_evidence', {
    description: 'Add items to the evidence bank: the only material generated documents may '
      + 'use. Items from a resume, document or repo start UNCONFIRMED and must be reviewed '
      + 'with the person; things the person tells you directly are confirmed on entry. Record '
      + 'ownership honestly: "contributed" must never be turned into "led". Use kind "boundary" '
      + 'for claims that must never be made, with what is true instead in detail. Never add '
      + 'something the person did not tell you or that is not in a document they provided. '
      + 'Always pass source_ref for items from a resume, document or repo: without it they '
      + 'cannot be confirmed later.',
    inputSchema: { items: z.array(ITEM).min(1) },
  }, async ({ items }) => {
    const ids: string[] = [];
    try {
      for (const it of items) ids.push(await upsertEvidence(env.DB, it));
    } catch (e) {
      return fail(`Stopped after ${ids.length}: ${String(e)}`);
    }
    const unconfirmed = items.filter((i) => i.source !== 'user').length;
    const noRef = items.filter((i) => i.source !== 'user' && !i.source_ref?.trim()).length;
    return ok({ ids }, `Added ${ids.length}.`
      + (unconfirmed ? ` ${unconfirmed} need the person to confirm them before any document can use them.` : '')
      + (noRef ? ` ${noRef} have no source_ref, so confirming them will need one (review_evidence with verdict "correct").` : ''));
  });

  server.registerTool('review_evidence', {
    description: 'Record the person\'s verdict on evidence items: confirm (accurate as written), '
      + 'reject (not true, with a note saying what is), or correct (pass the fixed fields, '
      + 'which also confirms it). Only call this with the person\'s own answer. An item from a '
      + 'resume, document or repo can only be confirmed with a source_ref; if it has none, use '
      + '"correct" with correction.source_ref.',
    inputSchema: {
      reviews: z.array(z.object({
        id: z.string(),
        verdict: z.enum(['confirm', 'reject', 'correct']),
        note: z.string().optional(),
        correction: ITEM.partial().optional(),
      })).min(1),
    },
  }, async ({ reviews }) => {
    const done: string[] = [];
    try {
      for (const r of reviews) {
        if (r.verdict === 'correct') {
          const [current] = (await listEvidence(env.DB)).filter((e) => e.id === r.id);
          if (!current) return fail(`No evidence with id ${r.id}`);
          await upsertEvidence(env.DB, {
            ...current, ...r.correction, id: r.id, status: 'confirmed',
            notes: r.note ?? current.notes ?? null,
            source: r.correction?.source ?? current.source,
          } as never);
        } else {
          if (r.verdict === 'confirm') {
            const row = await env.DB.prepare('SELECT source, source_ref FROM evidence WHERE id = ?')
              .bind(r.id).first<{ source: string; source_ref: string | null }>();
            if (!row) return fail(`No evidence with id ${r.id}. Stopped after ${done.length}.`);
            if (row.source !== 'user' && !row.source_ref?.trim()) {
              return fail(`${r.id} came from a ${row.source} and says nowhere which one, so it cannot be `
                + 'confirmed as is. Call again with verdict "correct" and correction.source_ref (the file '
                + `name, URL or repo). Stopped after ${done.length}.`);
            }
          }
          await setEvidenceStatus(env.DB, r.id, r.verdict === 'confirm' ? 'confirmed' : 'rejected', r.note);
        }
        done.push(`${r.id}: ${r.verdict}`);
      }
    } catch (e) {
      return fail(`Stopped after ${done.length}: ${String(e)}`);
    }
    return ok({ reviewed: done }, `Recorded ${done.length} verdicts.`);
  });

  server.registerTool('list_evidence', {
    description: 'Read the evidence bank. Before writing ANY resume, cover letter, short answer '
      + 'or interview brief, list status "confirmed" for the role\'s archetype: that is the only '
      + 'material you may use, and every claim must trace to an item. Boundaries sort first; '
      + 'read them before anything else.',
    inputSchema: {
      kind: KIND.optional(),
      status: z.enum(['unconfirmed', 'confirmed', 'rejected']).optional(),
      archetype: z.number().int().optional(),
      context: z.string().optional(),
    },
  }, async (f) => {
    const rows = await listEvidence(env.DB, f);
    return ok({ items: rows, summary: await evidenceSummary(env.DB) }, `${rows.length} items`);
  });

  server.registerTool('delete_evidence', {
    description: 'Remove an evidence item entirely. Prefer rejecting it so the record of what '
      + 'not to claim survives; delete only on request or for a true duplicate.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    await deleteEvidence(env.DB, id);
    return ok({ id }, 'Deleted.');
  });

  server.registerTool('get_preferences', {
    description: 'What makes a role acceptable: work modes, comp floor and target, target '
      + 'cities, company stages, industries to prefer and avoid, dealbreakers, relocation, '
      + 'sponsorship, start date, and which platforms to search.',
    inputSchema: {},
  }, async () => ok((await loadConfig(env.DB)).preferences));

  server.registerTool('set_preferences', {
    description: 'Update preferences. Partial: only pass what changed. The comp floor filters '
      + 'postings that state a lower maximum; ruled-out industries are filtered however well '
      + 'the role matches; target cities are each searched and count as local. Relocation, '
      + 'comp target, start date and sponsorship also fill the matching application answers. '
      + 'Relay any warnings to the person.',
    inputSchema: {
      work_modes: z.array(z.enum(['remote', 'hybrid', 'onsite'])).optional(),
      comp_floor: z.number().nullable().optional(),
      comp_target: z.number().nullable().optional(),
      company_stages: z.array(z.string()).optional(),
      industries_prefer: z.array(z.string()).optional(),
      industries_avoid: z.array(z.string()).optional(),
      relocation: z.enum(['no', 'yes', 'for_the_right_role']).nullable().optional(),
      sponsorship_needed: z.boolean().nullable().optional(),
      earliest_start: z.string().nullable().optional().describe('YYYY-MM-DD'),
      dealbreakers: z.array(z.string()).optional(),
      sources: z.array(z.string()).optional().describe('platform ids from get_source_catalog'),
      target_cities: z.array(z.object({
        name: z.string(), search: z.string(), match: z.array(z.string()).min(1),
      })).optional(),
      notes: z.string().optional(),
    },
  }, async (patch) => {
    try {
      const cfg = await loadConfig(env.DB);
      const r = await savePreferences(env.DB, cfg, patch as never);
      return ok(r, r.warnings.length ? `Saved, with warnings:\n- ${r.warnings.join('\n- ')}` : 'Saved.');
    } catch (e) {
      return fail(String(e));
    }
  });

  server.registerTool('get_source_catalog', {
    description: 'Every job platform, how it is reached (built in, connector, paid key, not '
      + 'supported), setup steps and cost, plus the connectors that power features. Use it '
      + 'to help the person choose platforms and then to walk them through setup.',
    inputSchema: {},
  }, async () => {
    const chosen = new Set((await loadConfig(env.DB)).preferences.sources);
    return ok({
      sources: SOURCES.map((s) => ({ ...s, chosen: chosen.has(s.id) })),
      feature_connectors: FEATURE_CONNECTORS,
      server_secrets: {
        APIFY_TOKEN: Boolean(env.APIFY_TOKEN),
      },
    });
  });

  server.registerTool('get_scheduled_task_prompts', {
    description: 'The four scheduled runs (daily search, daily sweep, document build, weekly review), generated '
      + 'from the person\'s own platforms and cities, with how to set them up and the download '
      + 'links for the four JobHunt skills. They run as scheduled tasks in the cloud (Claude '
      + 'Cowork). If this session can create scheduled tasks, create or update them yourself; '
      + 'otherwise hand the person the prompts to paste. Re-save after platforms or cities change. '
      + 'The dashboard\'s Build now uses the build-docs prompt for one role.',
    inputSchema: {},
  }, async () => {
    const tasks = scheduledTaskPrompts(await loadConfig(env.DB));
    const { results: files } = await env.DB.prepare(
      'SELECT name, description FROM setup_files ORDER BY name',
    ).bind().all<{ name: string; description: string | null }>();
    return ok({
      how: TASK_SETUP_NOTES,
      tasks: tasks.map((t) => ({
        title: t.title, schedule: t.cadence, cron: t.cron, timezone: 'America/New_York',
        task_id: t.task_id, description: t.description, prompt: t.prompt,
      })),
      skills: files.map((f) => ({
        name: f.name.replace(/\.zip$/, ''), description: f.description,
        download: SETUP_FILE_URL(env.PUBLIC_DASH_URL, f.name),
      })),
    }, 'Create or update these four tasks now if you can (see `how`), else give them to the person to paste. '
      + 'Then run the search once by hand.');
  });
}
