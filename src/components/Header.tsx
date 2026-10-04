import React, { useMemo, useState } from 'react';
import { Menu, Plus, Search, X, Zap } from 'lucide-react';
import { useApp } from '../context/AppContext';

interface Props { onOpenNewProject:()=>void; onOpenQuickBuild:()=>void; onToggleMenu:()=>void; menuOpen:boolean; }

const PAGES = [
  ['dashboard', 'Build', 'repo build dashboard'],
  ['twa', 'Web → Android', 'website twa pwa web app android apk'],
  ['builds', 'Logs', 'build logs errors artifacts'],
  ['tools', 'Free tools', 'free developer tools'],
  ['settings', 'Keystore', 'release signing keystore'],
  ['billing', 'Pro', 'payment subscription automation'],
] as const;

export const Header: React.FC<Props> = ({onOpenNewProject,onOpenQuickBuild,onToggleMenu}) => {
 const { projects, setCurrentTab } = useApp();
 const [search, setSearch] = useState('');
 const [open, setOpen] = useState(false);
 const matches = useMemo(() => { const q=search.trim().toLowerCase(); return q ? PAGES.filter(([,label,words]) => `${label} ${words}`.includes(q)) : []; }, [search]);
 const go = (tab:string) => { setCurrentTab(tab); setSearch(''); setOpen(false); };
 return <>
  <header className="h-16 shrink-0 px-3 sm:px-5 border-b border-emerald-950/70 bg-[#050707]/95 backdrop-blur flex items-center gap-3 relative z-30">
   <button onClick={onToggleMenu} aria-label="Menu" className="w-10 h-10 rounded-lg border border-white/[.06] flex items-center justify-center text-slate-300"><Menu className="w-5 h-5"/></button>
   <div className="hidden md:block min-w-0"><div className="text-sm font-semibold text-white truncate">WyBuild</div><div className="text-[11px] text-slate-500 truncate">Repo in. Android out.</div></div>
   <div className="flex-1 max-w-xl mx-auto relative">
    <div className="h-10 rounded-lg border border-white/[.07] bg-black/20 flex items-center gap-2 px-3"><Search className="w-4 h-4 text-slate-500"/><input value={search} onFocus={()=>setOpen(true)} onChange={e=>{setSearch(e.target.value);setOpen(true)}} placeholder="Search pages…" className="bg-transparent outline-none text-sm text-white w-full placeholder:text-slate-600"/><kbd className="hidden sm:block text-[9px] text-slate-600 border border-white/[.06] rounded px-1.5">/</kbd></div>
    {open && search.trim() && <div className="absolute left-0 right-0 top-12 rounded-xl border border-white/[.08] bg-[#070a09] shadow-2xl overflow-hidden">{matches.length ? matches.map(([id,label,words])=><button key={id} onClick={()=>go(id)} className="w-full text-left px-4 py-3 hover:bg-white/[.03] border-b border-white/[.04]"><div className="text-sm text-white">{label}</div><div className="text-[11px] text-slate-600">{words}</div></button>) : <div className="px-4 py-4 text-sm text-slate-500">No page matches that keyword.</div>}</div>}
   </div>
   <div className="flex gap-2 shrink-0"><button onClick={onOpenNewProject} className="h-10 px-3 rounded-lg bg-emerald-400 text-black text-xs font-bold flex items-center gap-1.5"><Plus className="w-4 h-4"/><span className="hidden sm:inline">Connect</span></button>{projects.length>0&&<button onClick={onOpenQuickBuild} className="h-10 px-3 rounded-lg border border-emerald-400/20 text-emerald-200 text-xs font-semibold flex items-center gap-1.5"><Zap className="w-4 h-4"/><span className="hidden sm:inline">Build</span></button>}<button onClick={()=>setOpen(false)} className="hidden" aria-label="Close search"><X/></button></div>
  </header>
 </>;
};
