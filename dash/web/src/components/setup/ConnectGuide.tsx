import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, prefsApi, setupApi, type Run } from '../../api.ts';
import { Panel } from '../Setup.tsx';

/** What "Let Claude set it up" sends: the connector's own onboarding does the rest, including
 * creating the scheduled tasks when the session can. */
const SETUP_PROMPT = [
  'Continue my JobHunt setup using the JobHunt connector.',
  '1. Call onboarding_status and tell me what is left.',
  '2. Call get_scheduled_task_prompts. Create my four scheduled tasks from it now, or update them if tasks with those titles already exist: exactly those titles, schedules and prompts, with an approval mode that runs tools without asking. If you cannot create scheduled tasks here, give me each one as a copy-paste block instead.',
  '3. Give me the four skill download links from it, and remind me where to upload them.',
  '4. Run the daily search once now, then tell me what it found.',
].join('\n');

const RUN_KIND: Record<string, string> = {
  'jobhunt-search': 'search', 'jobhunt-build-docs': 'build_docs', 'jobhunt-weekly': 'weekly',
  'jobhunt-sweep': 'manual',
};
/** The sweep logs as a manual run; its summary is how its runs are told apart. */
const RUN_PREFIX: Record<string, string> = { 'jobhunt-sweep': 'Daily sweep' };

/**
 * Everything that makes JobHunt run without the person, in the order it has to happen, with
 * the current versions of what they paste (task prompts are generated from their settings on
 * every load, so a stale copy is always one click from fixed).
 */
export function ConnectGuide() {
  const tasks = useQuery({ queryKey: ['setup-tasks'], queryFn: setupApi.tasks });
  const files = useQuery({ queryKey: ['setup-files'], queryFn: setupApi.files });
  const prefs = useQuery({ queryKey: ['prefs'], queryFn: prefsApi.get });
  const runs = useQuery({ queryKey: ['runs'], queryFn: api.runs });
  const setup = useQuery({ queryKey: ['setup'], queryFn: setupApi.get });
  const boot = useQuery({ queryKey: ['bootstrap'], queryFn: api.bootstrap });
  const connectorUrl = boot.data?.connector_url ?? '';
  const qc = useQueryClient();
  const skillsDone = setup.data?.onboarding.steps.find((st) => st.key === 'claude_skills')?.done ?? false;
  const confirmSkills = useMutation({
    mutationFn: (done: boolean) => setupApi.confirmStep('claude_skills', done),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['setup'] });
      void qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });

  const chosen = new Set(prefs.data?.preferences.sources ?? []);
  const catalog = prefs.data?.sources ?? [];
  const connectors = catalog.filter((s) => chosen.has(s.id) && s.status === 'connector');
  const browser = catalog.filter((s) => chosen.has(s.id) && s.status === 'browser');
  const lastRun = (taskId: string) => (runs.data ?? []).find((r) => r.kind === RUN_KIND[taskId]
    && (!RUN_PREFIX[taskId] || (r.summary ?? '').startsWith(RUN_PREFIX[taskId])));

  return (
    <Panel title="Connect Claude"
      note="What makes JobHunt run by itself. Add the connector, then let Claude do the rest, or follow steps 3 to 6 by hand. Everything here is always the current version, so after changing platforms or cities, have Claude update the tasks again (or re-copy the prompts).">
      <ol className="space-y-4 text-sm">
        <Step n={1} title="Add the JobHunt connector">
          <p>In claude.ai: <b>Settings, Connectors, Add custom connector</b>. Name it JobHunt and use this address, then sign in with the Google account you use for this dashboard.</p>
          {connectorUrl
            ? <CopyField value={connectorUrl} />
            : <p className="text-xs text-warn">Set PUBLIC_MCP_URL on the dashboard Worker to show the address here.</p>}
          <p className="text-xs text-muted">After JobHunt is updated, refresh its tool list there so Claude sees the new tools. Reconnect only if refreshing does not show them.</p>
        </Step>

        <Step n={2} title="Let Claude set up the rest">
          <p>Open this in <b>Cowork</b> (the Claude desktop app) and send it. Claude creates or updates the four scheduled tasks itself, gives you the skill downloads, and runs the first search. Where it cannot create tasks, it hands you the prompts to paste, the same ones as below.</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <a href={`claude://cowork/new?q=${encodeURIComponent(SETUP_PROMPT)}`}
              className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white">Open in the Claude app</a>
            <a href={`https://claude.ai/new?q=${encodeURIComponent(SETUP_PROMPT)}`} target="_blank" rel="noreferrer"
              className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent">in a browser</a>
            <CopyButton text={SETUP_PROMPT} label="Copy the request" />
          </div>
        </Step>

        <Step n={3} title="Upload the skills">
          <p>In claude.ai: <b>Settings, Capabilities, Skills, Upload skill</b>, once per file (Cowork uses the same skills). Uploading again replaces the old copy. Claude Code on your Mac already has them.</p>
          <ul className="mt-2 space-y-1.5">
            {(files.data ?? []).map((f) => (
              <li key={f.name} className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{f.name}</span>
                  <span className="block text-xs text-muted">{f.description}</span>
                </span>
                <a href={`/api/setup/files/${encodeURIComponent(f.name)}`}
                  className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent">Download</a>
              </li>
            ))}
            {files.data && files.data.length === 0 && (
              <li className="text-xs text-muted">No skill files uploaded yet. Ask Claude Code to run tools/upload-setup-files.ts.</li>
            )}
          </ul>
          <label className="mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" checked={skillsDone} disabled={confirmSkills.isPending || !setup.data}
              onChange={(e) => confirmSkills.mutate(e.target.checked)} />
            <span className={skillsDone ? 'text-good' : ''}>
              {skillsDone ? 'All four uploaded' : 'I have uploaded all four'}
            </span>
          </label>
        </Step>

        <Step n={4} title="Connect the platforms you search">
          <ul className="list-disc space-y-1 pl-5">
            {connectors.map((s) => (
              <li key={s.id}><b>{s.name}</b>: in claude.ai, Settings, Connectors, browse the directory and add it. No account needed.</li>
            ))}
            <li><b>Gmail</b>, on the account you apply from: the weekly review writes follow-up drafts there. It never sends.</li>
            {browser.length > 0 && (
              <li><b>Claude in Chrome</b>, for {browser.map((s) => s.name).join(', ')}: those run in your own browser when you ask, with the job-extract skill. It also fills in applications.</li>
            )}
          </ul>
          <p className="mt-1 text-xs text-muted">LinkedIn, Indeed, Built In, YC and company boards need nothing here: the JobHunt connector searches them itself.</p>
        </Step>

        <Step n={5} title="The four scheduled tasks">
          <p>Step 2 creates these for you. To do it by hand: in Cowork, <b>Scheduled, New task, Set up manually</b>. Paste the prompt, set the frequency, and choose the approval mode that lets tools run <b>without asking</b>, or every run stops at the first tool. If a task already exists, replace its prompt instead of adding a second.</p>
          <div className="mt-2 space-y-2">
            {(tasks.data ?? []).map((t) => (
              <TaskCard key={t.task_id} id={t.task_id} title={t.title} cadence={t.cadence} prompt={t.prompt}
                last={lastRun(t.task_id)} />
            ))}
          </div>
        </Step>

        <Step n={6} title="Run the search once by hand">
          <p>In Cowork, open the daily search task and press Run now. Within a few minutes it shows under <b>Runs</b>, and the task above shows when it last ran. That run also proves the connectors work.</p>
        </Step>
      </ol>
    </Panel>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent">{n}</span>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1 font-semibold">{title}</h3>
        <div className="space-y-1.5 text-muted [&_b]:text-fg">{children}</div>
      </div>
    </li>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button type="button" className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
      }}>
      {copied ? 'Copied' : label}
    </button>
  );
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex max-w-xl items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-md border border-line bg-bg px-2.5 py-1.5 text-xs text-fg">{value}</code>
      <button type="button" className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs hover:border-accent"
        onClick={async () => {
          try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
        }}>
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

function TaskCard({ id, title, cadence, prompt, last }: { id: string; title: string; cadence: string; prompt: string; last?: Run }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const when = last ? new Date(`${last.started_at.replace(' ', 'T')}Z`) : null;
  const days = when ? Math.floor((Date.now() - when.getTime()) / 86_400_000) : null;
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="font-medium text-fg">{title}</span>
          <span className="block text-xs">{cadence}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent">{open ? 'Hide' : 'Show'} prompt</button>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(prompt)}`} download={`${id}.prompt.txt`}
            className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent">Download</a>
          <button type="button" className="rounded-md bg-accent px-2.5 py-1 text-xs font-semibold text-white"
            onClick={async () => {
              try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
            }}>
            {copied ? 'Copied' : 'Copy prompt'}
          </button>
        </span>
      </div>
      <p className={`mt-1 text-xs ${!last ? 'text-warn' : days != null && days > 7 ? 'text-warn' : ''}`}>
        {!last ? 'Has not run yet.'
          : `Last ran ${days === 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}${last.summary ? `: ${last.summary.slice(0, 140)}${last.summary.length > 140 ? '…' : ''}` : ''}`}
      </p>
      {open && (
        <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel p-2 text-[11px] leading-relaxed text-fg">{prompt}</pre>
      )}
    </div>
  );
}
