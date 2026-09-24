import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  baseResumeForArchetype, deleteBaseResume, deleteGoal, extractDocxText, getBaseResume,
  listBaseResumes, listGoals, loadConfig, onboardingStatus, putConfig, saveBaseResume, upsertGoal,
  CONFIRMABLE_STEPS, confirmSetupStep,
} from '@jobhunt/core';
import { type Env, fail, ok } from './env.ts';

const GOAL_KIND = z.enum([
  'weekly_applications', 'weekly_outreach', 'total_applications',
  'interviews', 'offer_by', 'target_comp', 'custom',
]);

export function registerSetupTools(server: McpServer, env: Env): void {
  server.registerTool('onboarding_status', {
    description: 'What still has to be set up before the pipeline can run, as a checklist '
      + 'with a reason for each item. Call this FIRST in any session that is helping with '
      + 'setup, and whenever something behaves as though a piece is missing. It lets you '
      + 'pick up where a previous session stopped instead of asking the user to remember.',
    inputSchema: {},
  }, async () => {
    const cfg = await loadConfig(env.DB);
    const s = await onboardingStatus(env.DB, cfg);
    return ok(s, s.complete
      ? 'Setup is complete.'
      : `${s.done} of ${s.total} done. Next: "${s.next!.what}". Ask:\n- `
        + s.next!.ask.join('\n- '));
  });

  server.registerTool('save_base_resume', {
    description: 'Store a base resume (a master, one per role archetype) as .docx bytes in '
      + 'base64, with its plain text extracted. Every tailored resume is built from one of '
      + 'these, which is what keeps dates, titles and credentials identical across '
      + 'applications. Re-uploading the same label replaces it in place. '
      + 'Pass extracted_text if you have it; otherwise the server extracts it from the .docx.',
    inputSchema: {
      label: z.string().describe('a short stable name, e.g. "AI Implementation"'),
      filename: z.string(),
      content_base64: z.string(),
      archetype: z.number().int().min(1).max(20).nullable().optional()
        .describe('the archetype id from get_config that this master serves'),
      extracted_text: z.string().optional(),
    },
  }, async (a) => {
    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(atob(a.content_base64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    } catch {
      return fail('content_base64 is not valid base64.');
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const sha256 = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    // the tailoring step and the claim audit read the text, so it is never left empty
    const text = a.extracted_text ?? (await extractDocxText(bytes)).text ?? null;
    const r = await saveBaseResume(env.DB, {
      label: a.label, filename: a.filename, archetype: a.archetype ?? null,
      content: bytes, sha256, extracted_text: text || null,
    });
    return ok({ ...r, sha256, bytes: bytes.length },
      r.replaced ? `Replaced the "${a.label}" master.` : `Stored "${a.label}" as a base resume.`);
  });

  server.registerTool('list_base_resumes', {
    description: 'The stored base resumes with their archetype mapping, so you can see '
      + 'which archetypes have a master and which fall back to a less relevant one.',
    inputSchema: {},
  }, async () => {
    const rows = await listBaseResumes(env.DB);
    const cfg = await loadConfig(env.DB);
    const missing = cfg.archetypes
      .filter((a) => !rows.some((r) => r.active && r.archetype === a.id))
      .map((a) => `${a.id}: ${a.name}`);
    return ok({ base_resumes: rows, archetypes_without_a_master: missing });
  });

  server.registerTool('get_base_resume', {
    description: 'Fetch the base resume to tailor from: its extracted text, plus the raw .docx '
      + 'as base64 with include_file. For a role, pass `archetype` (the role\'s archetype id): '
      + 'the server picks that archetype\'s master, falling back to the base_resume_map and then '
      + 'to any active master, so there is always one to build from. Or pass `id_or_label` for a '
      + 'specific one.',
    inputSchema: {
      archetype: z.number().int().nullable().optional(),
      id_or_label: z.string().optional(),
      include_file: z.boolean().default(false),
    },
  }, async ({ archetype, id_or_label, include_file }) => {
    let key = id_or_label;
    if (!key) {
      const meta = await baseResumeForArchetype(env.DB, await loadConfig(env.DB), archetype ?? null);
      if (!meta) return fail('No base resume is stored yet. Upload one in the dashboard (Setup, Base resumes) first.');
      key = meta.id;
    }
    const r = await getBaseResume(env.DB, key);
    if (!r) return fail(`No base resume matching "${key}"`);
    let content_base64: string | undefined;
    if (include_file) {
      let bin = '';
      for (const b of r.bytes) bin += String.fromCharCode(b);
      content_base64 = btoa(bin);
    }
    return ok({
      id: r.id, label: r.label, archetype: r.archetype, filename: r.filename,
      bytes: r.bytes.length, extracted_text: r.extracted_text, content_base64,
    });
  });

  server.registerTool('delete_base_resume', {
    description: 'Remove a stored base resume. Only when the user asks.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    await deleteBaseResume(env.DB, id);
    return ok({ id }, 'Deleted.');
  });

  server.registerTool('confirm_setup_step', {
    description: 'Mark a setup step done that cannot be checked from here, only on the person\'s '
      + 'word: "claude_skills" once they say the four JobHunt skills are uploaded to Claude. '
      + 'Pass done false to undo it.',
    inputSchema: {
      step: z.enum(CONFIRMABLE_STEPS),
      user_statement: z.string().min(2).describe("the person's own words saying it is done"),
      done: z.boolean().default(true),
    },
  }, async ({ step, done }) => {
    await confirmSetupStep(env.DB, step, done);
    return ok({ step, done }, done ? `Marked "${step}" done.` : `Marked "${step}" not done.`);
  });

  server.registerTool('set_goal', {
    description: 'Create or update a goal for the search. Countable kinds '
      + '(weekly_applications, total_applications, interviews) get real progress computed '
      + 'from what actually happened; "custom" is tracked but never scored, so do not '
      + 'dress a custom goal up as measurable. Pass an id to edit, and set status to '
      + '"met", "missed", "paused" or "abandoned" to close one out honestly.',
    inputSchema: {
      id: z.string().optional().describe('to edit a goal; then pass only the fields that change'),
      kind: GOAL_KIND.optional().describe('required for a new goal'),
      title: z.string().optional().describe('required for a new goal'),
      target_value: z.number().nullable().optional(),
      unit: z.string().optional(),
      due_at: z.string().optional().describe('YYYY-MM-DD'),
      status: z.enum(['active', 'met', 'missed', 'paused', 'abandoned']).optional(),
      notes: z.string().nullable().optional(),
    },
  }, async (a) => {
    if (!a.id && (!a.kind || !a.title)) return fail('A new goal needs a kind and a title.');
    const id = await upsertGoal(env.DB, a);
    return ok({ id }, a.id ? 'Goal updated.' : 'Goal set.');
  });

  server.registerTool('list_goals', {
    description: 'Active goals with computed progress. Use this before saying whether the '
      + 'search is on track: activity without a target is not progress.',
    inputSchema: { include_closed: z.boolean().default(false) },
  }, async ({ include_closed }) => ok(await listGoals(env.DB, include_closed)));

  server.registerTool('delete_goal', {
    description: 'Remove a goal entirely. Prefer closing it with a status so the history '
      + 'survives; delete only when the user asks.',
    inputSchema: { id: z.string() },
  }, async ({ id }) => {
    await deleteGoal(env.DB, id);
    return ok({ id }, 'Deleted.');
  });

  server.registerTool('get_plan', {
    description: 'The written job-search plan: positioning, the narrative for each '
      + 'archetype, weekly cadence, and what the user decided NOT to chase. Read it before '
      + 'writing documents or advising on strategy, so the advice matches the plan already '
      + 'agreed rather than restarting the argument.',
    inputSchema: {},
  }, async () => {
    const cfg = await loadConfig(env.DB);
    return ok({ plan: cfg.plan ?? '' },
      cfg.plan ? undefined : 'No plan written yet. Build one with the user, then put_plan.');
  });

  server.registerTool('put_plan', {
    description: 'Save the written plan as markdown. Write it with the user rather than '
      + 'for them, keep it specific enough to act on, and include what they have decided '
      + 'not to pursue. Overwrites the previous version.',
    inputSchema: { plan: z.string() },
  }, async ({ plan }) => {
    await putConfig(env.DB, 'plan', plan, 'the written job-search plan');
    return ok({ length: plan.length }, 'Plan saved.');
  });
}
