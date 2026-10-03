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
  X,
} from 'lucide-react';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ open, onClose }) => {
  const { currentTab, setCurrentTab: setTab, projects, builds, subscription, rateLimits, openFlutterwaveCheckout, user } = useApp();
  // On phones/tablets the menu is a drawer: close it after choosing a destination.
  const closeIfMobile = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) onClose();
  };
  const setCurrentTab = (id: string) => {
    setTab(id as any);
    closeIfMobile();
  };
  // Swipe left on the drawer to close it.
  const touchX = React.useRef<number | null>(null);
  const initials = (user?.name || user?.login || 'U').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
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
    <>
    {/* Backdrop (touch outside to close) – mobile/tablet only */}
    <div
      onClick={onClose}
      aria-hidden="true"
      className={`fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-200 lg:hidden ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    />
    <aside
      id="app-sidebar"
      aria-label="Main menu"
      onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={(e) => {
        if (touchX.current !== null && touchX.current - e.changedTouches[0].clientX > 60) onClose();
        touchX.current = null;
      }}
      className={`fixed inset-y-0 left-0 z-50 w-[85vw] max-w-72 bg-slate-950 border-r border-slate-800 flex flex-col overflow-hidden transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-64 lg:max-w-none lg:shrink-0 lg:transition-[margin] ${open ? 'translate-x-0 lg:ml-0' : '-translate-x-full lg:translate-x-0 lg:-ml-64'}`}
    >
      {/* Brand Zone */}
      <div className="h-16 px-5 shrink-0 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 font-bold">
            <Server className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <span className="font-bold tracking-tight text-white text-base">WyBuild</span>
            <span className="block text-[10px] font-mono uppercase text-slate-400 tracking-wider">Flutter + Web-to-Android Cloud</span>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close menu" className="lg:hidden -mr-2 w-11 h-11 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-slate-900 active:bg-slate-800">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto overscroll-contain">
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
                  className={`w-full flex items-center justify-between px-3 py-2.5 min-h-11 rounded-md text-sm lg:text-xs font-medium transition cursor-pointer active:bg-slate-800 touch-manipulation ${isActive ? 'bg-cyan-500/10 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'}`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="break-words text-left leading-tight">Free Dev Tools</span>
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
                        className="w-full flex items-center gap-2 px-2.5 py-2.5 min-h-10 rounded text-xs text-slate-400 active:bg-slate-800 touch-manipulation hover:text-slate-200 hover:bg-slate-900 text-left"
                      >
                        <ToolIcon className="w-3.5 h-3.5" />
                        <span className="break-words text-left leading-tight">{label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          }
          return (
            <button key={item.id} onClick={() => setCurrentTab(item.id)} className={`w-full flex items-center justify-between px-3 py-2.5 min-h-11 rounded-md text-sm lg:text-xs font-medium transition cursor-pointer active:bg-slate-800 touch-manipulation ${isActive ? 'bg-cyan-500/10 text-cyan-300 font-semibold border-l-2 border-cyan-400 pl-2.5' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'}`}>
              <div className="flex items-center gap-2.5 min-w-0 flex-1"><Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} /><span className="break-words text-left leading-tight">{item.label}</span></div>
              {item.badge && <span className={`text-[11px] font-mono tabular-nums shrink-0 ml-1 ${item.badgeColor || 'text-slate-400'}`}>{item.badge}</span>}
              {item.highlight && <span className="text-[10px] text-emerald-400 font-mono font-medium shrink-0 ml-1">{item.highlight}</span>}
            </button>
          );
        })}
      </nav>

      {/* Free Tier Rate Limiting & Resource Safeguard Box */}
      <div className="p-3.5 m-3 shrink-0 rounded-lg bg-slate-900 border border-slate-800 text-xs">
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
              className="w-full py-2.5 lg:py-1.5 text-center text-xs lg:text-[11px] font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center justify-center gap-1.5 cursor-pointer"
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
      <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shrink-0 border-t border-slate-800/80 flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white font-bold text-xs shrink-0">
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-white font-medium break-words text-xs">{user?.name || user?.login}</p>
            <p className="text-slate-400 break-all text-[11px]">{user?.email || (user?.login ? `@${user.login}` : '')}</p>
          </div>
        </div>
      </div>
    </aside>
    </>
  );
};
