import React from 'react';
import { useApp } from '../context/AppContext';
import { Home, Terminal, Wrench, KeyRound, CreditCard, Sparkles, Server, X, Smartphone } from 'lucide-react';

interface SidebarProps { open: boolean; onClose: () => void; }

export const Sidebar: React.FC<SidebarProps> = ({ open, onClose }) => {
  const { currentTab, setCurrentTab, subscription, rateLimits } = useApp();
  const isPro = subscription.plan === 'pro';
  const go = (id: string, tool?: string) => {
    setCurrentTab(id as any);
    if (tool) setTimeout(() => window.dispatchEvent(new CustomEvent('wybuild:tool-open', { detail: { tool } })), 0);
    if (window.matchMedia('(max-width: 1023px)').matches) onClose();
  };
  const items = [
    ['dashboard', 'Build', Home],
    ['twa', 'Web → Android', Smartphone],
    ['builds', 'Logs', Terminal],
    ['tools', 'Free tools', Wrench],
    ['settings', 'Keystore', KeyRound],
    ['billing', isPro ? 'Pro active' : 'Upgrade', CreditCard],
  ] as const;
  return <>
    <div onClick={onClose} className={`fixed inset-0 z-40 bg-black/65 lg:hidden ${open ? '' : 'hidden'}`} />
    <aside className={`fixed inset-y-0 left-0 z-50 w-64 bg-[#050707] border-r border-emerald-950/70 flex flex-col transition-transform lg:static ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:-ml-64'}`}>
      <div className="h-16 px-4 flex items-center justify-between border-b border-emerald-950/70">
        <div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-lg bg-emerald-400/10 border border-emerald-400/20 flex items-center justify-center"><Server className="w-4 h-4 text-emerald-300"/></div><div><div className="font-bold text-white">WyBuild</div><div className="text-[10px] text-slate-500">build Android, simply</div></div></div>
        <button onClick={onClose} className="lg:hidden p-2 text-slate-400"><X className="w-5 h-5"/></button>
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {items.map(([id,label,Icon]) => <button key={id} onClick={() => go(id, id === 'settings' ? 'keystore' : undefined)} className={`w-full min-h-11 px-3 rounded-lg flex items-center gap-3 text-sm ${currentTab===id ? 'bg-emerald-400/10 text-emerald-200 border border-emerald-400/15' : 'text-slate-400 hover:bg-white/[.03] hover:text-white'}`}><Icon className="w-4 h-4"/><span>{label}</span></button>)}
        {!isPro && <button onClick={() => go('billing')} className="w-full mt-3 px-3 py-3 rounded-lg border border-emerald-400/15 bg-emerald-400/[.04] text-left"><div className="flex gap-2 items-center text-emerald-300 text-xs font-semibold"><Sparkles className="w-4 h-4"/>Pro automation</div><div className="text-[11px] text-slate-500 mt-1">Automate repetitive build work.</div></button>}
      </nav>
      <div className="m-3 p-3 rounded-lg bg-white/[.02] border border-white/[.05] text-[11px] text-slate-500"><div className="flex justify-between"><span>{isPro ? 'Pro' : 'Free builds'}</span><span className="text-slate-300 font-mono">{isPro ? 'Active' : `${rateLimits.monthlyBuildsUsed}/${rateLimits.monthlyLimit}`}</span></div></div>
    </aside>
  </>;
};
