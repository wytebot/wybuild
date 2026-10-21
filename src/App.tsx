/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardOverview } from './components/dashboard/DashboardOverview';
import { TwaView } from './components/twa/TwaView';
import { ProjectsView } from './components/projects/ProjectsView';
import { BuildsView } from './components/builds/BuildsView';
import { ReleasesView } from './components/releases/ReleasesView';
import { ErrorTelemetryView } from './components/errors/ErrorTelemetryView';
import { DevToolsView } from './components/tools/DevToolsView';
import { DevStudioView } from './components/DevStudioView';
import { BillingView } from './components/billing/BillingView';
import { SettingsView } from './components/settings/SettingsView';
import { HowItWorksView } from './components/help/HowItWorksView';
import { NewProjectModal } from './components/modals/NewProjectModal';
import { QuickBuildModal } from './components/modals/QuickBuildModal';
import { LoginScreen } from './components/LoginScreen';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { PullToRefresh } from './components/PullToRefresh';
import { CreditsCheckoutModal } from './components/billing/CreditsCheckoutModal';

const MainLayout: React.FC = () => {
  const { currentTab, toastMessage, builds, setActiveBuildId, setCurrentTab, authState, user, repos, refreshAll } = useApp();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showQuickBuildModal, setShowQuickBuildModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [creditPack, setCreditPack] = useState<string>('starter');
  const [showCreditsSuccess, setShowCreditsSuccess] = useState<boolean>(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('credits') === 'success');
  // Menu starts open on desktop, closed (drawer) on phones/tablets.
  const [navOpen, setNavOpen] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);

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
          await fetch('/api/push/register', {
            method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
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
            const trustedWebHost = target.hostname === 'wybuild-black.vercel.app';
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
        <Header
          onOpenNewProject={() => setShowNewProjectModal(true)}
          onOpenQuickBuild={() => setShowQuickBuildModal(true)}
          onToggleMenu={() => setNavOpen((v) => !v)}
          menuOpen={navOpen}
        />

        <PullToRefresh onRefresh={refreshAll} className="wybuild-main flex-1 overflow-y-auto overflow-x-hidden min-w-0">
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
        </PullToRefresh>
      </div>

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:bottom-6 sm:right-6 z-[110] bg-[#07100d] border border-emerald-400/25 shadow-2xl rounded-lg px-4 py-3 flex items-center gap-3 text-xs text-slate-200 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* Modals */}
      <NewProjectModal
        isOpen={showNewProjectModal}
        onClose={() => setShowNewProjectModal(false)}
      />
      <QuickBuildModal
        isOpen={showQuickBuildModal}
        onClose={() => setShowQuickBuildModal(false)}
      />
      <CreditsCheckoutModal
        isOpen={showBillingModal}
        initialPack={creditPack}
        onClose={() => setShowBillingModal(false)}
      />
      {showCreditsSuccess && <div className="fixed inset-0 z-[130] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"><div className="w-full max-w-sm rounded-2xl border border-emerald-400/25 bg-slate-950 p-6 text-center shadow-2xl"><div className="mx-auto mb-4 h-12 w-12 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-2xl text-emerald-300">✓</div><h2 className="text-xl font-bold text-white">Credits purchased</h2><p className="mt-2 text-sm text-slate-400">Flutterwave confirmed your one-time payment. Your credit wallet has been updated.</p><button onClick={() => { setShowCreditsSuccess(false); window.history.replaceState({}, '', window.location.pathname); }} className="mt-5 w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-black">Continue</button></div></div>}
    </div>
  );
};

const Gate: React.FC = () => {
  const { authState } = useApp();
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
