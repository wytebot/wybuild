import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  LayoutDashboard,
  FolderGit2,
  Terminal,
  TestTube2,
  AlertTriangle,
  Wrench,
  Users2,
  CreditCard,
  Settings,
  Sparkles,
  Server,
  ExternalLink,
  Smartphone,
  ChevronDown,
  ChevronRight,
  Image as ImageIcon,
  FileCode,
  ShieldCheck,
  Key,
  Layers,
  Github,
} from 'lucide-react';

export const Sidebar: React.FC = () => {
  const { currentTab, setCurrentTab, projects, builds, subscription, rateLimits, openFlutterwaveCheckout } = useApp();
  const isPro = subscription.plan === 'pro';
  const [toolsOpen, setToolsOpen] = useState(false);

  const runningBuildsCount = builds.filter((b) => b.status === 'running' || b.status === 'queued').length;
  const failedBuildsCount = builds.filter((b) => b.status === 'failed').length;

  const navItems = [
    {
      id: 'dashboard',
      label: 'Executive Dashboard',
      icon: LayoutDashboard,
    },
    {
      id: 'projects',
      label: 'Projects & Repos',
      icon: FolderGit2,
      badge: `${projects.length}/${isPro ? '∞' : '10'}`,
    },
    {
      id: 'twa',
      label: 'Web → Android (TWA)',
      icon: Smartphone,
      highlight: 'new',
    },
    {
      id: 'builds',
      label: 'Cloud CI/CD & Logs',
      icon: Terminal,
      badge: runningBuildsCount > 0 ? `${runningBuildsCount} running` : undefined,
      badgeColor: runningBuildsCount > 0 ? 'text-amber-400' : undefined,
    },
    {
      id: 'testing',
      label: 'Automated Tests',
      icon: TestTube2,
    },
    {
      id: 'errors',
      label: 'Error Telemetry',
      icon: AlertTriangle,
      badge: failedBuildsCount > 0 ? `${failedBuildsCount} alert` : undefined,
      badgeColor: 'text-rose-400',
    },
    {
      id: 'tools',
      label: 'Free Dev Utilities',
      icon: Wrench,
      highlight: '0 cost',
    },
    {
      id: 'team',
      label: 'Team & RBAC',
      icon: Users2,
    },
    {
      id: 'billing',
      label: 'Billing & Flutterwave',
      icon: CreditCard,
    },
    {
      id: 'settings',
      label: 'Keystores & Config',
      icon: Settings,
    },
  ];

  return (
    <aside className="w-64 bg-slate-950 border-r border-slate-800 flex flex-col shrink-0">
      {/* Brand Zone */}
      <div className="h-16 px-5 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold">
            <Server className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <span className="font-bold tracking-tight text-white text-base">WyBuild</span>
            <span className="block text-[10px] font-mono uppercase text-slate-400 tracking-wider">Flutter + Web-to-Android Cloud</span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;
          if (item.id === 'tools') {
            const toolItems = [
              ['icon', 'App Icon Generator', ImageIcon],
              ['pubspec', 'Pubspec Linter', FileCode],
              ['manifest', 'Manifest Inspector', ShieldCheck],
              ['keystore', 'Keystore Helper', Key],
              ['proguard', 'ProGuard/R8 Rules', Layers],
              ['github_actions', 'GitHub Actions Export', Github],
            ] as const;
            return (
              <div key={item.id}>
                <button
                  onClick={() => setToolsOpen((v) => !v)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition cursor-pointer ${isActive ? 'bg-cyan-500/10 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">Free Dev Tools</span>
                    <span className="text-[9px] text-emerald-400 font-mono">FREE</span>
                  </div>
                  {toolsOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
                {toolsOpen && (
                  <div className="ml-4 mt-1 mb-1 border-l border-slate-800 pl-2 space-y-0.5">
                    {toolItems.map(([tool, label, ToolIcon]) => (
                      <button
                        key={tool}
                        onClick={() => { setCurrentTab('tools'); window.dispatchEvent(new CustomEvent('wybuild:tool-open', { detail: { tool } })); }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] text-slate-500 hover:text-slate-200 hover:bg-slate-900 text-left"
                      >
                        <ToolIcon className="w-3.5 h-3.5" />
                        <span className="truncate">{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <button key={item.id} onClick={() => setCurrentTab(item.id)} className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition cursor-pointer ${isActive ? 'bg-cyan-500/10 text-cyan-300 font-semibold border-l-2 border-cyan-400 pl-2.5' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'}`}>
              <div className="flex items-center gap-2.5 min-w-0"><Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} /><span className="truncate">{item.label}</span></div>
              {item.badge && <span className={`text-[11px] font-mono tabular-nums shrink-0 ml-1 ${item.badgeColor || 'text-slate-400'}`}>{item.badge}</span>}
              {item.highlight && <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0 ml-1">{item.highlight}</span>}
            </button>
          );
        })}
      </nav>

      {/* Free Tier Rate Limiting & Resource Safeguard Box */}
      <div className="p-3.5 m-3 rounded-lg bg-slate-900 border border-slate-800 text-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
            {isPro ? 'Pro Active' : 'Free Quota'}
          </span>
          <span className={`text-[11px] font-mono tabular-nums ${isPro ? 'text-amber-400' : 'text-cyan-400'}`}>
            {isPro ? 'Unlimited' : `${rateLimits.monthlyBuildsUsed}/${rateLimits.monthlyLimit}`}
          </span>
        </div>

        {!isPro ? (
          <>
            <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden mb-2">
              <div
                className="bg-cyan-500 h-full rounded-full transition-all duration-300"
                style={{ width: `${(rateLimits.monthlyBuildsUsed / rateLimits.monthlyLimit) * 100}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-2.5">
              5 successful builds/month. Failed or cancelled builds do not consume the allowance. 1 concurrent build, 10 projects.
            </p>
            <button
              onClick={() => openFlutterwaveCheckout('monthly')}
              className="w-full py-1.5 text-center text-[11px] font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Sparkles className="w-3 h-3 text-cyan-200" />
              Upgrade to Pro ($10/mo)
            </button>
          </>
        ) : (
          <div className="space-y-1 text-[11px] text-slate-400">
            <div className="flex justify-between">
              <span>Concurrent slots:</span>
              <span className="font-mono text-slate-200">5 / 5 max</span>
            </div>
            <div className="flex justify-between">
              <span>Runner queue:</span>
              <span className="font-mono text-emerald-400">Zero queue</span>
            </div>
          </div>
        )}
      </div>

      {/* User profile / session */}
      <div className="p-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
            IT
          </div>
          <div className="min-w-0">
            <p className="text-white font-medium truncate text-xs">Ilemobayo Tolulope</p>
            <p className="text-slate-400 truncate text-[11px]">ilemobayo@finflow.io</p>
          </div>
        </div>
      </div>
    </aside>
  );
};
