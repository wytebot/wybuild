import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { ChevronRight, Github, Loader2, Lock, RefreshCw, Search } from 'lucide-react';

interface Props {
  onPick: (repo: string) => void;
  /** repo currently being opened (shows a spinner on that row) */
  busyRepo?: string;
  maxHeightClass?: string;
}

/** Every repo the signed-in GitHub account can see, loaded automatically. Tap one: that is the whole "connect" step. */
export const RepoPicker: React.FC<Props> = ({ onPick, busyRepo, maxHeightClass = 'max-h-[52dvh]' }) => {
  const { repos, reposLoading, refreshRepos, selectedRepo } = useApp();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return repos
      .filter((r) => !needle || r.fullName.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.canPush) - Number(a.canPush));
  }, [repos, q]);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="h-11 flex-1 min-w-0 rounded-lg border border-white/10 bg-black/30 flex items-center gap-2 px-3">
          <Search className="w-4 h-4 text-slate-500 shrink-0" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${repos.length || ''} repositories`} className="bg-transparent outline-none text-sm text-white w-full placeholder:text-slate-600" />
        </div>
        <button onClick={() => void refreshRepos()} aria-label="Reload repositories" className="h-11 w-11 rounded-lg border border-white/10 text-slate-400 flex items-center justify-center shrink-0">
          <RefreshCw className={`w-4 h-4 ${reposLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className={`${maxHeightClass} overflow-y-auto rounded-xl border border-white/[.06] divide-y divide-white/[.05]`}>
        {reposLoading && !repos.length && <div className="p-5 text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading your repositories…</div>}
        {!reposLoading && !repos.length && <div className="p-5 text-sm text-slate-500">No repositories found for this GitHub account. Tap reload, or sign in with the account that owns your code.</div>}
        {repos.length > 0 && !list.length && <div className="p-5 text-sm text-slate-500">No repository matches “{q}”.</div>}
        {list.map((r) => (
          <button key={r.fullName} onClick={() => onPick(r.fullName)} disabled={!!busyRepo} className={`w-full min-h-14 px-3 py-2 flex items-center gap-3 text-left hover:bg-white/[.03] disabled:opacity-60 ${selectedRepo === r.fullName ? 'bg-emerald-400/[.06]' : ''}`}>
            <Github className="w-4 h-4 text-slate-500 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-white font-mono break-all">{r.fullName}</span>
              <span className="block text-[11px] text-slate-500">{r.private ? 'Private' : 'Public'} · {r.defaultBranch}{!r.canPush ? ' · read-only (cannot install workflow)' : ''}</span>
            </span>
            {r.private && <Lock className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
            {busyRepo === r.fullName ? <Loader2 className="w-4 h-4 animate-spin text-emerald-300 shrink-0" /> : <ChevronRight className="w-4 h-4 text-slate-600 shrink-0" />}
          </button>
        ))}
      </div>
    </div>
  );
};
