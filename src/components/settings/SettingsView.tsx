import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { KeystoreForm } from '../KeystoreForm';
import { CheckCircle2, Plus, Trash2, LogOut } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { keystores, deleteKeystore, repos, selectedRepo, defaultKeystore, user, logout } = useApp();
  const [showAdd, setShowAdd] = useState(false);
  // any repo you can push to, whether or not it has been "connected"
  const pushable = repos.filter((r) => r.canPush).map((r) => r.fullName);
  return <div className="max-w-3xl mx-auto p-4 sm:p-7 space-y-5">
    <div className="flex items-start justify-between gap-4"><div><h1 className="text-xl font-bold text-white">Keystore</h1><p className="text-sm text-slate-500 mt-1">Release signing keys are stored as encrypted GitHub Actions secrets.</p></div><button onClick={() => setShowAdd(true)} disabled={!pushable.length} className="h-10 px-3 rounded-lg bg-emerald-400 text-black font-bold text-xs flex items-center gap-1.5 disabled:opacity-40"><Plus className="w-4 h-4" />Add</button></div>
    {defaultKeystore
      ? <div className="p-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[.05] text-sm text-emerald-100 flex gap-3"><CheckCircle2 className="w-5 h-5 text-emerald-300 shrink-0" /><div><div className="font-semibold">Default signing key is active</div><p className="text-xs text-emerald-200/70 mt-1">WyBuild copies it into any repo on its first build, so no repo asks for a keystore. A repo with its own key below keeps using that one.</p></div></div>
      : <div className="p-4 rounded-xl border border-white/[.06] bg-white/[.015] text-xs text-slate-500">Tip: set WB_KEYSTORE_BASE64, WB_KEYSTORE_PASSWORD, WB_KEY_ALIAS and WB_KEY_PASSWORD in the WyBuild Vercel environment to sign every repo automatically. GitHub secrets saved on the WyBuild repo itself cannot be read by other repos' builds.</div>}
    <div className="space-y-2">{keystores.length === 0 && <div className="p-4 rounded-xl border border-white/[.06] bg-white/[.015] text-sm text-slate-500">No per-repo keys yet{defaultKeystore ? ' (the default key covers every repo).' : '.'}</div>}{keystores.map((k) => <div key={k.id} className="p-4 rounded-xl border border-white/[.06] bg-white/[.015] flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-sm font-semibold text-white break-words">{k.name}</div><div className="text-[11px] text-slate-500 font-mono mt-1">{k.repo} · Alias: {k.alias}</div><div className="text-[10px] text-slate-600 font-mono break-all mt-1">{k.fingerprintSha256}</div></div><button onClick={() => deleteKeystore(k.id)} className="p-2 text-slate-500 hover:text-rose-400" aria-label="Remove key"><Trash2 className="w-4 h-4" /></button></div>)}</div>
    {user && <button onClick={logout} className="text-xs text-slate-500 flex items-center gap-2 hover:text-white"><LogOut className="w-4 h-4" />Sign out {user.login}</button>}
    {showAdd && <div className="fixed inset-0 z-50 bg-black/80 flex items-end sm:items-center justify-center"><div className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#07100d] border border-emerald-400/15 p-5 space-y-4"><div><h2 className="font-bold text-white">Add release keystore</h2><p className="text-xs text-slate-500 mt-1">Uploaded to GitHub Actions secrets for the chosen repo.</p></div><KeystoreForm repos={pushable} defaultRepo={selectedRepo} onDone={() => setShowAdd(false)} onCancel={() => setShowAdd(false)} /></div></div>}
  </div>;
};
