import { apiUrl, authHeaders, isNative, API_BASE } from './services/apiBase';
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { LoginScreen } from './components/LoginScreen';
import { CheckCircle2, AlertCircle, BookOpen, X } from 'lucide-react';

// Screens load on demand (smaller first download), then are preloaded while the browser is idle.
const loaders = {
  TwaView: () => import('./components/twa/TwaView'),
  ProjectsView: () => import('./components/projects/ProjectsView'),
  BuildsView: () => import('./components/builds/BuildsView'),
  ReleasesView: () => import('./components/releases/ReleasesView'),
  ErrorTelemetryView: () => import('./components/errors/ErrorTelemetryView'),
  DevToolsView: () => import('./components/tools/DevToolsView'),
  DevStudioView: () => import('./components/DevStudioView'),
  BillingView: () => import('./components/billing/BillingView'),
  SettingsView: () => import('./components/settings/SettingsView'),
  HowItWorksView: () => import('./components/help/HowItWorksView'),
  NewProjectModal: () => import('./components/modals/NewProjectModal'),
  QuickBuildModal: () => import('./components/modals/QuickBuildModal'),
  CreditsCheckoutModal: () => import('./components/billing/CreditsCheckoutModal'),
};
const TwaView = lazy(() => loaders.TwaView().then((m) => ({ default: m.TwaView })));
const ProjectsView = lazy(() => loaders.ProjectsView().then((m) => ({ default: m.ProjectsView })));
const BuildsView = lazy(() => loaders.BuildsView().then((m) => ({ default: m.BuildsView })));
const ReleasesView = lazy(() => loaders.ReleasesView().then((m) => ({ default: m.ReleasesView })));
const ErrorTelemetryView = lazy(() => loaders.ErrorTelemetryView().then((m) => ({ default: m.ErrorTelemetryView })));
const DevToolsView = lazy(() => loaders.DevToolsView().then((m) => ({ default: m.DevToolsView })));
const DevStudioView = lazy(() => loaders.DevStudioView().then((m) => ({ default: m.DevStudioView })));
const BillingView = lazy(() => loaders.BillingView().then((m) => ({ default: m.BillingView })));
const SettingsView = lazy(() => loaders.SettingsView().then((m) => ({ default: m.SettingsView })));
const HowItWorksView = lazy(() => loaders.HowItWorksView().then((m) => ({ default: m.HowItWorksView })));
const NewProjectModal = lazy(() => loaders.NewProjectModal().then((m) => ({ default: m.NewProjectModal })));
const QuickBuildModal = lazy(() => loaders.QuickBuildModal().then((m) => ({ default: m.QuickBuildModal })));
const CreditsCheckoutModal = lazy(() => loaders.CreditsCheckoutModal().then((m) => ({ default: m.CreditsCheckoutModal })));
const ViewFallback: React.FC = () => <div className="p-6 text-sm text-slate-400" role="status" aria-live="polite">Loading…</div>;
const preloadViews = () => { Object.values(loaders).forEach((load) => { void load().catch(() => {}); }); };

const MainLayout: React.FC = () => {
  const { currentTab, toastMessage, builds, setActiveBuildId, setCurrentTab, authState, user, repos, retryAuth } = useApp();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showQuickBuildModal, setShowQuickBuildModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [showHelpReminder, setShowHelpReminder] = useState<boolean>(() => { try { return typeof window !== 'undefined' && localStorage.getItem('wybuild_help_reminder_dismissed_v1') !== '1'; } catch { return true; } });
  const [creditPack, setCreditPack] = useState<string>('starter');
  const [showCreditsSuccess, setShowCreditsSuccess] = useState<boolean>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('credits') === 'success');
  // Menu starts open on desktop, closed (drawer) on phones/tablets.
  const [navOpen, setNavOpen] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);

  // Warm every screen once the app is interactive so tab switches are instant.
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) { const id = w.requestIdleCallback(preloadViews, { timeout: 4000 }); return () => w.cancelIdleCallback?.(id); }
    const t = window.setTimeout(preloadViews, 1500); return () => window.clearTimeout(t);
  }, []);

  // Route build-completion notification deep links directly to the matching build history item.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const repo = params.get('notifyRepo');
    const runId = params.get('notifyRun');
    const notifyTab = params.get('notifyTab');
    if (!repo || !runId || !builds.length) return;
    const match = builds.find((b) => String(b.runId || b.id) === runId && String(b.repo || '').toLowerCase() === repo.toLowerCase());
    if (!match) return;
    setCurrentTab('builds');
    setActiveBuildId(match.id);
    if (notifyTab === 'artifacts' || notifyTab === 'logs') { try { localStorage.setItem('wybuild_notify_tab', notifyTab); } catch {} }
    params.delete('notifyRepo'); params.delete('notifyRun'); params.delete('notifyTab');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, [builds, setActiveBuildId, setCurrentTab]);

  // Register Firebase Cloud Messaging on native Capacitor builds. The server keeps tokens
  // private and maps them to the authenticated GitHub account and repositories.
  useEffect(() => {
    if (authState !== 'authed' || !user?.login) return;
    let disposed = false;
    let tokenListener: { remove: () => Promise<void> } | undefined;
    let actionListener: { remove: () => Promise<void> } | undefined;
    let readyHandler: (() => void) | undefined;
    const register = async () => {
      const native = (window as any).WyBuildNative;
      if (disposed || !native?.isNative?.() || !native?.push) return;
      try {
        tokenListener = await native.push.onToken(async (event: any) => {
          const token = String(event?.value || event?.token || '');
          if (!token || disposed) return;
          await fetch(apiUrl('push/register'), {
            method: 'POST', credentials: isNative() ? 'omit' : 'same-origin', headers: await authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ token, platform: native.platform?.() || 'android', repos: repos.map((r) => r.fullName).filter(Boolean) }),
          }).catch(() => {});
        });
        actionListener = await native.push.onAction(async (event: any) => {
          const data = event?.notification?.data || event?.data || {};
          const rawUrl = String(data.url || '');
          if (!rawUrl) return;
          try {
            const target = new URL(rawUrl, window.location.origin);
            // Never let a push payload navigate the app to an arbitrary external site.
            const trustedWebHost = target.hostname === new URL(API_BASE || 'https://wybuild-black.vercel.app').hostname;
            if (target.origin !== window.location.origin && !trustedWebHost) return;
            // Native Capacitor builds use a local WebView origin; keep navigation inside the app shell.
            window.location.assign(`${target.pathname}${target.search}${target.hash}`);
          } catch { /* malformed notification links are ignored */ }
        });
        await native.push.channel?.();
        await native.push.register();
      } catch (error) {
        console.warn('WyBuild push registration was not completed:', error);
      }
    };
    if ((window as any).WyBuildNative) void register();
    else {
      readyHandler = () => { void register(); };
      window.addEventListener('wybuild-native-ready', readyHandler, { once: true });
    }
    return () => {
      disposed = true;
      if (readyHandler) window.removeEventListener('wybuild-native-ready', readyHandler);
      void tokenListener?.remove().catch(() => {});
      void actionListener?.remove().catch(() => {});
    };
  }, [authState, user?.login]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setNavOpen((v) => (window.matchMedia('(max-width: 1023px)').matches ? false : v)); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Lock page scroll behind the open drawer on small screens.
  useEffect(() => {
    const small = window.matchMedia('(max-width: 1023px)').matches;
    document.body.style.overflow = navOpen && small ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [navOpen]);

  // Always close the drawer after navigating on small screens.
  useEffect(() => {
    if (window.matchMedia('(max-width: 1023px)').matches) setNavOpen(false);
  }, [currentTab]);

  useEffect(() => {
    const onCreditsOpen = (event: Event) => {
      const pack = (event as CustomEvent<{ pack?: string }>).detail?.pack;
      setCreditPack(['starter', 'builder', 'studio'].includes(pack || '') ? String(pack) : 'starter');
      setShowBillingModal(true);
    };
    window.addEventListener('wybuild:credits-open', onCreditsOpen);
    return () => {
      window.removeEventListener('wybuild:credits-open', onCreditsOpen);
    };
  }, []);

  return (
    <div className="wybuild-app-shell flex bg-[#030505] text-slate-100 overflow-hidden font-sans selection:bg-emerald-400/20 selection:text-emerald-200">
      {/* Sidebar */}
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="wybuild-main flex-1 overflow-y-auto overflow-x-hidden min-w-0">
          <Header
            onOpenNewProject={() => setShowNewProjectModal(true)}
            onOpenQuickBuild={() => setShowQuickBuildModal(true)}
            onToggleMenu={() => setNavOpen((v) => !v)}
            menuOpen={navOpen}
          />
          <Suspense fallback={<ViewFallback />}>
            {currentTab === 'projects' && <ProjectsView onOpenNewProject={() => setShowNewProjectModal(true)} />}
            {currentTab === 'twa' && <TwaView />}
            {currentTab === 'builds' && <BuildsView />}
            {currentTab === 'releases' && <ReleasesView />}
            {currentTab === 'errors' && <ErrorTelemetryView />}
            {currentTab === 'tools' && <DevToolsView />}
            {currentTab === 'devstudio' && <DevStudioView />}
            {currentTab === 'billing' && <BillingView />}
            {currentTab === 'settings' && <SettingsView />}
            {currentTab === 'howitworks' && <HowItWorksView />}
            {currentTab === 'dashboard' && (
              <DashboardOverview
                onOpenNewProject={() => setShowNewProjectModal(true)}
                onOpenQuickBuild={() => setShowQuickBuildModal(true)}
                  />
            )}
          </Suspense>
        </div>
      </div>

      {/* Small, dismissible first-build reminder; never blocks build controls. */}
      {showHelpReminder && (currentTab === 'projects' || currentTab === 'twa') && (
        <aside role="status" aria-label="Build preparation tip" className="fixed bottom-20 right-3 sm:right-6 z-[105] w-[min(22rem,calc(100vw-1.5rem))] rounded-xl border border-emerald-400/25 bg-[#07100d] p-3.5 shadow-xl shadow-black/30 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300"><BookOpen className="h-4 w-4" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white">Before your first build</p>
              <p className="mt-1 text-xs leading-relaxed text-slate-300">Check Help first to choose the right APK or TWA setup and avoid backend or native-feature surprises.</p>
              <button onClick={() => { try { localStorage.setItem('wybuild_help_reminder_dismissed_v1', '1'); } catch {} setShowHelpReminder(false); setCurrentTab('howitworks'); }} className="mt-2.5 inline-flex items-center gap-1.5 rounded-md bg-emerald-400 px-3 py-2 text-xs font-bold text-slate-950 hover:bg-emerald-300">Read build help <BookOpen className="h-3.5 w-3.5" /></button>
            </div>
            <button type="button" aria-label="Dismiss build help reminder" title="Dismiss" onClick={() => { try { localStorage.setItem('wybuild_help_reminder_dismissed_v1', '1'); } catch {} setShowHelpReminder(false); }} className="rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-white"><X className="h-4 w-4" /></button>
          </div>
        </aside>
      )}

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:bottom-6 sm:right-6 z-[110] bg-[#07100d] border border-emerald-400/25 shadow-2xl rounded-lg px-4 py-3 flex items-center gap-3 text-xs text-slate-200 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Modals */}
      <Suspense fallback={null}>
        {showNewProjectModal && <NewProjectModal isOpen={showNewProjectModal} onClose={() => setShowNewProjectModal(false)} />}
        {showQuickBuildModal && <QuickBuildModal isOpen={showQuickBuildModal} onClose={() => setShowQuickBuildModal(false)} />}
        {showBillingModal && <CreditsCheckoutModal isOpen={showBillingModal} initialPack={creditPack} onClose={() => setShowBillingModal(false)} />}
      </Suspense>
      {showCreditsSuccess && <div className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-sm rounded-2xl border border-emerald-400/25 bg-slate-950 p-6 text-center shadow-2xl"><div className="mx-auto mb-4 h-12 w-12 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-2xl text-emerald-300">✓</div><h2 className="text-xl font-bold text-white">Credits purchased</h2><p className="mt-2 text-sm text-slate-400">Flutterwave confirmed your one-time payment. Your credit wallet has been updated.</p><button onClick={() => { setShowCreditsSuccess(false); window.history.replaceState({}, '', window.location.pathname); }} className="mt-5 w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-black">Continue</button></div></div>}
    </div>
  );
};

const Gate: React.FC = () => {
  const { authState } = useApp();
  if (authState === 'unreachable') {
    return <main className="min-h-dvh bg-slate-950 text-slate-100 flex items-center justify-center p-6"><section className="max-w-md w-full rounded-2xl border border-amber-400/20 bg-slate-900 p-6"><h1 className="text-xl font-bold">Can’t reach WyBuild</h1><p className="mt-2 text-sm text-slate-300">Your saved sign-in has not been cleared. Check your connection, then retry. {user?.login ? `Last signed in as @${user.login}.` : ''}</p><div className="mt-5 flex flex-col gap-2"><button onClick={() => void retryAuth()} className="rounded-lg bg-emerald-400 px-4 py-3 font-bold text-slate-950">Retry connection</button><a href="https://wybuild-black.vercel.app" onClick={e => { if ((window as any).Capacitor?.isNativePlatform?.()) { e.preventDefault(); void import('@capacitor/browser').then(({ Browser }) => Browser.open({ url: 'https://wybuild-black.vercel.app' })); } }} className="rounded-lg border border-white/10 px-4 py-3 text-center">Open web version</a></div></section></main>;
  }
  if (authState === 'loading') {
    return <div className="h-dvh bg-slate-950 flex items-center justify-center text-slate-500 text-sm">Loading...</div>;
  }
  return authState === 'authed' ? <MainLayout /> : <LoginScreen />;
};

export default function App() {
  return (
    <AppProvider>
      <Gate />
    </AppProvider>
  );
}
