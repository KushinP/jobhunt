import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { McpAgent } from 'agents/mcp';
import type { AuthProps, Env } from './env.ts';
import { registerPipelineTools } from './tools-pipeline.ts';
import { registerSourceTools } from './tools-sources.ts';
import { registerSetupTools } from './tools-setup.ts';
import { registerEvidenceTools } from './tools-evidence.ts';
import { registerLibraryTools } from './tools-library.ts';
import { fail } from './env.ts';

export class JobHuntMCP extends McpAgent<Env, never, AuthProps> {
  server = new McpServer({ name: 'jobhunt', version: '2.1.0' }, {
    instructions: [
      "JobHunt runs one person's job search: it finds roles, scores them, builds tailored "
        + 'documents from a verified evidence bank, and prepares interviews. The person sees and '
        + 'edits everything in the JobHunt dashboard; tools that return a link give its address.',
      '',
      'IN A CHAT, START WITH `onboarding_status`. Follow its `next` step one at a time and save '
        + 'each answer as you go, so nothing lives only in this chat. Scheduled runs follow their '
        + 'own prompt (get_scheduled_task_prompts) instead.',
      '',
      'THE EVIDENCE RULE. Documents use only CONFIRMED items from `list_evidence`. Read the '
        + '"boundary" items first: claims never to make. Reword and reorder freely, but never add a '
        + 'tool, metric, project, scope or outcome, and never upgrade ownership ("contributed" is '
        + 'not "led"). Save anything new the person tells you with `add_evidence` before using it.',
      '',
      'ROLES. search_company_boards, search_yc_jobs, search_linkedin, search_indeed and '
        + 'search_builtin score and ingest on the server: never pass their results to ingest_jobs. '
        + 'ingest_jobs is for results from claude.ai connectors (ZipRecruiter, Dice) and from the '
        + "person's browser (the job-extract skill). A pasted posting link: add_role with just "
        + '`url`. Set `queue` on add_role only when the person asks for documents, with their words '
        + 'as user_statement. Companies: list_companies and set_companies (industry and stage; '
        + 'priority only on their word). Built files: list_documents, delete_document.',
      '',
      'HUMAN-ONLY. Applied, Interviewing, Offer and Rejected are decisions the person makes; '
        + 'set_status refuses them and refuses to change a role they set. mark_applied only when '
        + "the person says in this chat that they submitted, quoting them. rate_job records their "
        + 'rating, never yours. Never submit an application and never send an email: Gmail is for '
        + 'drafts only.',
      '',
      'DOCUMENTS. No em dashes; date ranges MM/YYYY - MM/YYYY.',
    ].join('\n'),
  });

  async init(): Promise<void> {
    // Every tool answers with a readable failure instead of a raw exception, so a bad input
    // or a missing row tells the model what to fix rather than ending the run.
    const register = this.server.registerTool.bind(this.server) as (...args: unknown[]) => unknown;
    (this.server as unknown as { registerTool: unknown }).registerTool = (
      name: string, def: unknown, cb: (...a: unknown[]) => Promise<unknown>,
    ) => register(name, def, async (...args: unknown[]) => {
      try {
        return await cb(...args);
      } catch (e) {
        return fail(`${name} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    });
    registerPipelineTools(this.server, this.env);
    registerSourceTools(this.server, this.env);
    registerSetupTools(this.server, this.env);
    registerEvidenceTools(this.server, this.env);
    registerLibraryTools(this.server, this.env);
  }
}
