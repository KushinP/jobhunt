import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  CHANNELS, CONTACT_TYPES, HOOK_TYPES, OUTREACH_STATUSES, OutreachRuleError, TOUCH_KINDS,
  listOutreach, logOutreach, outreachDue, updateOutreach,
} from '@jobhunt/core';
import { type Env, fail, ok } from './env.ts';

const NEVER_SENDS = 'This never sends, connects or posts anything: it only records what you sent yourself.';

/** Outreach: the messages the person sends to a human about a role, and what came back. */
export function registerOutreachTools(server: McpServer, env: Env): void {
  const rule = (e: unknown) => fail(e instanceof OutreachRuleError || e instanceof Error ? e.message : String(e));

  server.registerTool('log_outreach', {
    description: 'Record a message drafted for a person at a company about a role. It is saved as '
      + `Drafted; the person sends it themselves and then says so, which is update_outreach. ${NEVER_SENDS} `
      + 'A role must be attached unless touch_kind is "create_role" (work that has not been posted). '
      + 'The cadence rules are checked here too: a contact gets one approach and one nudge, and a '
      + 'follow_up is only for someone who already accepted or replied.',
    inputSchema: {
      company: z.string(),
      contact_name: z.string(),
      channel: z.enum(CHANNELS as [string, ...string[]]),
      touch_kind: z.enum(TOUCH_KINDS as [string, ...string[]])
        .describe('connect_note: the first approach. follow_up: after they accepted or replied. '
          + 'backup: a second person at the same company. nudge: the one chase. create_role: no posting exists.'),
      body: z.string().describe('the message exactly as it will be sent'),
      job_id: z.string().optional().describe('the role in the pipeline; required unless create_role'),
      contact_role: z.string().optional(),
      contact_type: z.enum(CONTACT_TYPES as [string, ...string[]]).optional(),
      contact_url: z.string().optional(),
      contact_email: z.string().optional(),
      hook_type: z.enum(HOOK_TYPES as [string, ...string[]]).optional()
        .describe('what the opening line is built on; the metrics break reply rate down by this'),
      hook: z.string().optional().describe('the specific thing referred to, e.g. the post or the launch'),
      parent_id: z.string().optional().describe('the touch this nudges or backs up'),
      notes: z.string().optional(),
    },
  }, async (a) => {
    try {
      const r = await logOutreach(env.DB, a as never);
      return ok(r, `Drafted. Send it yourself, then call update_outreach with status "Sent" and the `
        + `person's own words saying they sent it. Nothing has gone out.`);
    } catch (e) { return rule(e); }
  });

  server.registerTool('update_outreach', {
    description: 'Record what happened to a touch: you sent it, they accepted, they replied, it '
      + `became a meeting, or it is closed. ${NEVER_SENDS} Sent, Accepted, Replied and Meeting are `
      + "the person's to report, so `user_statement` is required: their own words in this chat. The "
      + 'server refuses a send before the application, a second message to the same company on the '
      + 'same day, and a third touch to one contact, naming the rule each time.',
    inputSchema: {
      id: z.string(),
      status: z.enum(OUTREACH_STATUSES as [string, ...string[]]).optional(),
      user_statement: z.string().min(4).optional()
        .describe("required to set Sent, Accepted, Replied or Meeting: the person's own words, quoted"),
      notes: z.string().optional(),
      body: z.string().optional().describe('only useful while it is still Drafted'),
      follow_up_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD'),
    },
  }, async ({ id, status, user_statement, notes, body, follow_up_due }) => {
    const human = ['Sent', 'Accepted', 'Replied', 'Meeting'];
    if (status && human.includes(status) && !(user_statement ?? '').trim()) {
      return fail(`"${status}" is something only the person can report. Pass their own words as `
        + 'user_statement, or leave the touch as it is.');
    }
    try {
      const note = user_statement ? [`They said: "${user_statement}"`, notes].filter(Boolean).join('\n') : notes;
      const r = await updateOutreach(env.DB, id, {
        status: status as never, notes: note, body, follow_up_due,
      }, 'you');
      return ok(r, `${r.contact_name} at ${r.company}: ${r.status}.`
        + (r.follow_up_due ? ` Follow-up due ${r.follow_up_due}.` : ''));
    } catch (e) { return rule(e); }
  });

  server.registerTool('list_outreach', {
    description: `Every message logged, newest first, with the role each one is about. ${NEVER_SENDS} `
      + 'Read it before drafting anything for a company: it shows who has already been approached, '
      + 'when, and what came back.',
    inputSchema: {
      status: z.enum(OUTREACH_STATUSES as [string, ...string[]]).optional(),
      job_id: z.string().optional(),
      company: z.string().optional().describe('matches part of the name'),
      since_days: z.number().int().min(1).optional(),
      limit: z.number().int().min(1).max(200).default(50),
    },
  }, async (f) => {
    const rows = await listOutreach(env.DB, f as never);
    return ok(rows, `${rows.length} touches`);
  });

  server.registerTool('get_outreach_due', {
    description: 'What outreach needs from the person today, each row saying why: a backup at a '
      + 'company that went quiet, a nudge that is due, a connection that was accepted with nothing '
      + 'sent into it, or a nudge old enough to call No reply. Settles timed-out nudges first, which '
      + `is the only status automation may set. ${NEVER_SENDS}`,
    inputSchema: {},
  }, async () => {
    const r = await outreachDue(env.DB);
    return ok(r, `${r.due.length} to handle`
      + (r.swept.length ? `, ${r.swept.length} nudge${r.swept.length === 1 ? '' : 's'} marked No reply` : '')
      + '. Draft what is needed, send it yourself, then log it.');
  });
}
