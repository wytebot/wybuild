import React from 'react';
import { useApp } from '../context/AppContext';
import { Play, Plus, Zap, ShieldCheck, FolderArchive, Download, Menu } from 'lucide-react';

interface HeaderProps {
  onOpenNewProject: () => void;
  onOpenQuickBuild: () => void;
  onOpenExportZip: () => void;
  onToggleMenu: () => void;
  menuOpen: boolean;
}

export const Header: React.FC<HeaderProps> = ({ onOpenNewProject, onOpenQuickBuild, onOpenExportZip, onToggleMenu, menuOpen }) => {
  const { currentTab, subscription, rateLimits, openFlutterwaveCheckout } = useApp();
  const isPro = subscription.plan === 'pro';

  const tabLabels: Record<string, string> = {
    twa: 'Web → Android (TWA) Builder',
    dashboard: 'Executive Dashboard & Overview',
    projects: 'Projects & Repositories',
    builds: 'Cloud CI/CD Pipeline & Terminal',
    testing: 'Automated Testing Suite',
    errors: 'Real-Time Error Reporting & Telemetry',
    tools: 'Free Developer Tools & Utilities',
    team: 'Team Collaboration & Access Control',
    billing: 'Billing & Flutterwave v4 Subscription',
    settings: 'Keystores & Environment Settings',
  };

  return (
    <header className="px-3 sm:px-6 py-2.5 border-b border-slate-800 bg-slate-900/95 backdrop-blur z-30 sticky top-0 shrink-0 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
      {/* Menu toggle + title */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={onToggleMenu}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="app-sidebar"
          className="shrink-0 -ml-1 w-11 h-11 flex items-center justify-center rounded-md text-slate-300 hover:text-white hover:bg-slate-800 active:bg-slate-700 touch-manipulation"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="min-w-0">
          <span className="hidden sm:block text-[10px] font-mono uppercase tracking-wider text-slate-400">Workspace</span>
          <span className="block text-sm font-semibold text-white leading-snug break-words">{tabLabels[currentTab] || 'Dashboard'}</span>
        </div>

        {isPro ? (
          <div className="hidden xl:flex items-center gap-1.5 ml-3 px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium shrink-0">
            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span>Priority Runner Active</span>
          </div>
        ) : (
          <div className="hidden xl:flex items-center gap-2 ml-3 px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700/60 text-slate-300 text-xs shrink-0">
            <span className="font-mono text-cyan-400 font-medium">{rateLimits.monthlyBuildsUsed}/{rateLimits.monthlyLimit} builds this month</span>
            <span className="text-slate-500">·</span>
            <button onClick={() => openFlutterwaveCheckout('monthly')} className="text-cyan-400 hover:text-cyan-300 font-medium underline underline-offset-2 cursor-pointer">Get Unlimited</button>
          </div>
        )}
      </div>

      {/* Primary actions: wrap instead of overflowing on small screens */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
        {!isPro && (
          <button
            onClick={() => openFlutterwaveCheckout('monthly')}
            className="hidden lg:inline-flex items-center justify-center gap-1.5 px-3 min-h-10 text-xs font-semibold rounded-md bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 hover:brightness-110 shadow-sm transition cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Upgrade to Pro ($10/mo)
          </button>
        )}

        <a
          href="/wybuild-source-code.zip"
          download="wybuild-source-code.zip"
          className="hidden md:inline-flex items-center justify-center gap-1.5 px-3 min-h-10 text-xs font-semibold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 rounded-md transition shadow-sm cursor-pointer"
          title="Download complete application source code archive"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span>Source .zip</span>
        </a>

        <button
          onClick={onOpenExportZip}
          className="inline-flex items-center justify-center gap-1.5 px-3 min-h-10 text-xs font-semibold text-cyan-300 bg-cyan-950/80 hover:bg-cyan-900/80 border border-cyan-700/60 rounded-md transition shadow-sm cursor-pointer touch-manipulation"
          title="Download Flutter starter project zip with environment variables and build scripts"
        >
          <FolderArchive className="w-3.5 h-3.5 text-cyan-400" />
          <span>Export .zip</span>
        </button>

        <button
          onClick={onOpenQuickBuild}
          className="inline-flex items-center justify-center gap-1.5 px-3 min-h-10 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition cursor-pointer touch-manipulation"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
          <span>Trigger Build</span>
        </button>

        <button
          onClick={onOpenNewProject}
          className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 px-3.5 min-h-10 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 rounded-md shadow-sm transition cursor-pointer touch-manipulation"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>
    </header>
  );
};
