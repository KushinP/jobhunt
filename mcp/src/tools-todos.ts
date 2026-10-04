import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TODO_KINDS, addTodo, completeTodo, loadConfig, todoList } from '@jobhunt/core';
import { type Env, fail, ok } from './env.ts';

/** The to-do list: what the person owes today, and the few things only they can write down. */
export function registerTodoTools(server: McpServer, env: Env): void {
  const link = () => `${env.PUBLIC_DASH_URL.replace(/\/+$/, '')}/?tab=todos`;

  server.registerTool('get_todos', {
    description: 'Everything the person owes, bucketed overdue / today / upcoming (14 days) / '
      + 'anytime: their own to-dos (HireVues, assessments), interviews to prep, debriefs owed, '
      + 'application follow-ups, outreach due, drafted messages not yet sent, roles closing within '
      + 'a week, and built documents waiting to be submitted. Settles timed-out outreach first.',
    inputSchema: {},
  }, async () => {
    const r = await todoList(env.DB, await loadConfig(env.DB));
    return ok(r, `${r.due_count} due today or overdue, ${r.upcoming.length} upcoming, `
      + `${r.anytime.length} anytime. The list: ${link()}`);
  });

  server.registerTool('add_todo', {
    description: 'Write down something the person has to do that JobHunt cannot work out itself, '
      + 'usually a HireVue, online assessment or take-home with a deadline from an email. Only on '
      + "the person's word or from a message they showed you; quote it in user_statement. "
      + 'Interviews with a time go in record_interview instead, and outreach in log_outreach.',
    inputSchema: {
      title: z.string().describe('what to do, e.g. "HireVue for Ramp Solutions Consultant"'),
      kind: z.enum(TODO_KINDS as [string, ...string[]]).optional()
        .describe('assessment: HireVue, OA, take-home. interview: prep or scheduling. '
          + 'application: something for an application. outreach. other.'),
      job_id: z.string().optional().describe('the role it is for, when there is one'),
      due_at: z.string().optional().describe('the deadline, YYYY-MM-DD'),
      url: z.string().optional().describe('the invite or portal link'),
      notes: z.string().optional(),
      user_statement: z.string().min(4).describe("the person's words, or the message, it came from"),
    },
  }, async ({ user_statement, ...a }) => {
    try {
      const r = await addTodo(env.DB, { ...a, notes: a.notes ?? null }, 'claude');
      return ok(r, `Added. It is on the list: ${link()} (from: "${user_statement.slice(0, 120)}")`);
    } catch (e) { return fail(e instanceof Error ? e.message : String(e)); }
  });

  server.registerTool('complete_todo', {
    description: "Tick off one of the person's own to-dos (a `task` item from get_todos; pass its "
      + "ref_id) once they say it is done. Other items clear themselves when the underlying work is "
      + 'recorded: complete_followup, update_outreach, debrief_interview, mark_applied.',
    inputSchema: {
      id: z.string(),
      done: z.boolean().optional().describe('false reopens it'),
    },
  }, async ({ id, done }) => (await completeTodo(env.DB, id, done !== false)
    ? ok({ id, done: done !== false })
    : fail(`No to-do with id ${id}. Only task items can be ticked off here.`)));
}
