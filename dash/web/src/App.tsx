import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';
import { Login } from './components/Login.tsx';
import { Board } from './components/Board.tsx';
import { AllRoles } from './components/AllRoles.tsx';
import { Companies } from './components/Companies.tsx';
import { AddRole } from './components/AddRole.tsx';
import { JobDrawer } from './components/JobDrawer.tsx';
import { Metrics } from './components/Metrics.tsx';
import { FollowUps } from './components/FollowUps.tsx';
import { Runs } from './components/Runs.tsx';
import { Setup } from './components/Setup.tsx';
import { Evidence } from './components/Evidence.tsx';
import { Trash } from './components/Trash.tsx';
import { Documents } from './components/Documents.tsx';
import { CompanyPanel } from './components/CompanyPanel.tsx';
import { NavContext } from './components/nav.tsx';
import { UpdateBanner } from './components/UpdateBanner.tsx';

type Tab = 'board' | 'list' | 'companies' | 'documents' | 'trash' | 'followups' | 'metrics' | 'runs' | 'evidence' | 'setup';

/** Tabs the header search filters directly; anywhere else, Enter takes the search to All roles. */
const SEARCHABLE: Tab[] = ['board', 'list', 'companies', 'documents'];

export default function App() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('board');
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [only, setOnly] = useState<{ ids: string[]; label: string } | null>(null);
  const [company, setCompany] = useState<string | null>(null);

  const session = useQuery({ queryKey: ['session'], queryFn: api.session });
  const boot = useQuery({
    queryKey: ['bootstrap'],
    queryFn: api.bootstrap,
    enabled: session.data?.authed === true,
  });

  if (session.isLoading) return null;
  if (!session.data?.authed) {
    return <Login />;
  }

  const ready = boot.data?.counts.find((c) => c.status === 'Complete')?.n ?? 0;
  const setupTodo = (boot.data?.onboarding_outstanding ?? 0) || undefined;
  const due = boot.data?.followups_due ?? 0;

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: 'board', label: 'Pipeline' },
    { key: 'list', label: 'All roles' },
    { key: 'companies', label: 'Companies' },
    { key: 'documents', label: 'Documents' },
    { key: 'trash', label: 'Trash' },
    { key: 'followups', label: 'Follow-ups', badge: due },
    { key: 'metrics', label: 'Metrics' },
    { key: 'runs', label: 'Runs' },
    { key: 'evidence', label: 'Experience' },
    { key: 'setup', label: 'Setup', badge: setupTodo },
  ];

  // A role opens over whatever is showing; a company replaces an open role, since the
  // company panel is where you go next from a role.
  const nav = {
    openJob: (id: string) => setOpenId(id),
    openCompany: (name: string) => { setOpenId(null); setCompany(name); },
  };

  return (
    <NavContext.Provider value={nav}>
    <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">JobHunt</h1>
          <p className="text-xs text-muted">
            {ready > 0
              ? `${ready} ${ready === 1 ? 'application is' : 'applications are'} built and waiting for you to submit`
              : 'Nothing waiting on you right now'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !SEARCHABLE.includes(tab)) { setOnly(null); setTab('list'); }
            }}
            placeholder={SEARCHABLE.includes(tab) ? 'Search role, company, city' : 'Search roles (Enter)'}
            className="w-44 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm
                       outline-none focus:border-accent sm:w-56"
          />
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white"
          >
            Add role
          </button>
          <button
            type="button"
            onClick={async () => { await api.logout(); void qc.invalidateQueries(); }}
            className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted
                       hover:border-accent hover:text-fg"
          >
            Sign out
          </button>
        </div>
      </header>

      <UpdateBanner />

      <nav className="-mx-4 mb-5 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] sm:mx-0 sm:px-0 [&::-webkit-scrollbar]:hidden">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => { setTab(t.key); if (t.key !== 'list') setOnly(null); }}
            className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm
              ${tab === t.key
                ? 'border-accent font-semibold text-fg'
                : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t.label}
            {t.badge ? (
              <span className="rounded-full bg-warn/20 px-1.5 text-[11px] font-semibold text-warn">
                {t.badge}
              </span>
            ) : null}
          </button>
        ))}
      </nav>

      {tab === 'board' && <Board onOpen={setOpenId} search={search} />}
      {tab === 'list' && (
        <AllRoles search={search} only={only} onClearOnly={() => setOnly(null)} />
      )}
      {tab === 'companies' && <Companies search={search} />}
      {tab === 'documents' && <Documents search={search} />}
      {tab === 'trash' && <Trash onOpen={setOpenId} />}
      {tab === 'followups' && <FollowUps />}
      {tab === 'metrics' && (
        <Metrics onSelect={(sel) => { setOnly(sel); setTab('list'); }} />
      )}
      {tab === 'runs' && <Runs />}
      {tab === 'setup' && <Setup />}
      {tab === 'evidence' && <Evidence />}

      {company && (
        <CompanyPanel name={company} covered={openId !== null} onClose={() => setCompany(null)} />
      )}
      {openId && <JobDrawer id={openId} onClose={() => setOpenId(null)} />}
      {adding && <AddRole onClose={() => setAdding(false)} />}
    </div>
    </NavContext.Provider>
  );
}
