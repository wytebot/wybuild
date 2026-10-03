import React from 'react';
import { useApp } from '../context/AppContext';
import { Play, Plus, Zap, ShieldCheck, FolderArchive, Download } from 'lucide-react';

interface HeaderProps {
  onOpenNewProject: () => void;
  onOpenQuickBuild: () => void;
  onOpenExportZip: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenNewProject, onOpenQuickBuild, onOpenExportZip }) => {
  const { currentTab, subscription, rateLimits, openFlutterwaveCheckout } = useApp();
  const isPro = subscription.plan === 'pro';

  const tabLabels: Record<string, string> = {
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
    <header className="h-16 px-6 border-b border-slate-800 bg-slate-900/90 backdrop-blur flex items-center justify-between z-10 sticky top-0">
      {/* Zone 1 & 2: Breadcrumbs and context */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-mono uppercase tracking-wider text-slate-400">Workspace</span>
        <span className="text-slate-600">/</span>
        <span className="text-sm font-semibold text-white">
          {tabLabels[currentTab] || 'Dashboard'}
        </span>

        {/* Priority Server Access Indicator */}
        {isPro ? (
          <div className="hidden sm:flex items-center gap-1.5 ml-4 px-2.5 py-1 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
            <Zap className="w-3.5 h-3.5 text-amber-400 fill-amber-400" />
            <span>Priority Dedicated Runner Active</span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-2 ml-4 px-2.5 py-1 rounded bg-slate-800/80 border border-slate-700/60 text-slate-300 text-xs">
            <span className="text-slate-400">Free Tier:</span>
            <span className="font-mono text-cyan-400 font-medium">
              {rateLimits.monthlyBuildsUsed}/{rateLimits.monthlyLimit} successful builds this month
            </span>
            <span className="text-slate-500">·</span>
            <button
              onClick={() => openFlutterwaveCheckout('monthly')}
              className="text-cyan-400 hover:text-cyan-300 font-medium underline underline-offset-2 transition-colors cursor-pointer"
            >
              Get Unlimited
            </button>
          </div>
        )}
      </div>

      {/* Zone 3: Primary Actions */}
      <div className="flex items-center gap-3">
        {!isPro && (
          <button
            onClick={() => openFlutterwaveCheckout('monthly')}
            className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-semibold hover:brightness-110 shadow-sm transition cursor-pointer"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Upgrade to Pro ($10/mo)
          </button>
        )}

        <a
          href="/wybuild-source-code.zip"
          download="wybuild-source-code.zip"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 rounded-md transition shadow-sm cursor-pointer"
          title="Download complete application source code archive with all files and folders intact"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span>Source .zip</span>
        </a>

        <button
          onClick={onOpenExportZip}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-cyan-300 bg-cyan-950/80 hover:bg-cyan-900/80 border border-cyan-700/60 rounded-md transition shadow-sm cursor-pointer"
          title="Download Flutter starter project zip with environment variables and build scripts"
        >
          <FolderArchive className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">Export</span> .zip
        </button>

        <button
          onClick={onOpenQuickBuild}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition cursor-pointer"
        >
          <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
          <span>Trigger Build</span>
        </button>

        <button
          onClick={onOpenNewProject}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 rounded-md shadow-sm transition cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>New Project</span>
        </button>
      </div>
    </header>
  );
};
