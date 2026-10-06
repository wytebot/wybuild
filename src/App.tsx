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
import { ErrorTelemetryView } from './components/errors/ErrorTelemetryView';
import { DevToolsView } from './components/tools/DevToolsView';
import { TeamView } from './components/team/TeamView';
import { BillingView } from './components/billing/BillingView';
import { SettingsView } from './components/settings/SettingsView';
import { NewProjectModal } from './components/modals/NewProjectModal';
import { QuickBuildModal } from './components/modals/QuickBuildModal';
import { LoginScreen } from './components/LoginScreen';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { BillingCheckoutModal } from './components/billing/BillingCheckoutModal';
import { BillingCycle } from './types';

const MainLayout: React.FC = () => {
  const { currentTab, toastMessage } = useApp();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showQuickBuildModal, setShowQuickBuildModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  // Menu starts open on desktop, closed (drawer) on phones/tablets.
  const [navOpen, setNavOpen] = useState<boolean>(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);

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
    const onBillingOpen = (event: Event) => {
      const cycle = (event as CustomEvent<{ cycle?: BillingCycle }>).detail?.cycle;
      setBillingCycle(cycle === 'yearly' ? 'yearly' : 'monthly');
      setShowBillingModal(true);
    };
    const onPaymentSuccess = () => setShowPaymentSuccess(true);
    window.addEventListener('wybuild:billing-open', onBillingOpen);
    window.addEventListener('wybuild:payment-success', onPaymentSuccess);
    return () => {
      window.removeEventListener('wybuild:billing-open', onBillingOpen);
      window.removeEventListener('wybuild:payment-success', onPaymentSuccess);
    };
  }, []);

  return (
    <div className="flex h-dvh bg-[#030505] text-slate-100 overflow-hidden font-sans selection:bg-emerald-400/20 selection:text-emerald-200">
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

        <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
          {currentTab === 'projects' && <ProjectsView onOpenNewProject={() => setShowNewProjectModal(true)} />}
          {currentTab === 'twa' && <TwaView />}
          {currentTab === 'builds' && <BuildsView />}
          {currentTab === 'errors' && <ErrorTelemetryView />}
          {currentTab === 'tools' && <DevToolsView />}
          {currentTab === 'team' && <TeamView />}
          {currentTab === 'billing' && <BillingView />}
          {currentTab === 'settings' && <SettingsView />}
          {currentTab === 'dashboard' && (
            <DashboardOverview
              onOpenNewProject={() => setShowNewProjectModal(true)}
              onOpenQuickBuild={() => setShowQuickBuildModal(true)}
                />
          )}
        </main>
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
      {showPaymentSuccess && (
        <div className="fixed inset-0 z-[120] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Payment successful">
          <div className="w-full max-w-sm rounded-2xl border border-emerald-400/25 bg-slate-950 p-6 shadow-2xl text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center text-emerald-300 text-2xl">✓</div>
            <h2 className="text-xl font-bold text-white">Payment successful</h2>
            <p className="mt-2 text-sm text-slate-400">Flutterwave payment was confirmed on the server. Your WyBuild Pro access is now active.</p>
            <button onClick={() => setShowPaymentSuccess(false)} className="mt-5 w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-black">Continue with Pro</button>
          </div>
        </div>
      )}
      <BillingCheckoutModal
        isOpen={showBillingModal}
        initialCycle={billingCycle}
        onClose={() => setShowBillingModal(false)}
      />
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
