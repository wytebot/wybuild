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
import { TestingView } from './components/testing/TestingView';
import { ErrorTelemetryView } from './components/errors/ErrorTelemetryView';
import { DevToolsView } from './components/tools/DevToolsView';
import { TeamView } from './components/team/TeamView';
import { BillingView } from './components/billing/BillingView';
import { SettingsView } from './components/settings/SettingsView';
import { NewProjectModal } from './components/modals/NewProjectModal';
import { QuickBuildModal } from './components/modals/QuickBuildModal';
import { LoginScreen } from './components/LoginScreen';
import { ExportProjectZipModal } from './components/modals/ExportProjectZipModal';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { BillingCheckoutModal } from './components/billing/BillingCheckoutModal';
import { BillingCycle } from './types';

const MainLayout: React.FC = () => {
  const { currentTab, toastMessage } = useApp();
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showQuickBuildModal, setShowQuickBuildModal] = useState(false);
  const [showExportZipModal, setShowExportZipModal] = useState(false);
  const [showBillingModal, setShowBillingModal] = useState(false);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');

  useEffect(() => {
    const onBillingOpen = (event: Event) => {
      const cycle = (event as CustomEvent<{ cycle?: BillingCycle }>).detail?.cycle;
      setBillingCycle(cycle === 'yearly' ? 'yearly' : 'monthly');
      setShowBillingModal(true);
    };
    window.addEventListener('wybuild:billing-open', onBillingOpen);
    return () => window.removeEventListener('wybuild:billing-open', onBillingOpen);
  }, []);

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden font-sans selection:bg-cyan-500/20 selection:text-cyan-300">
      {/* Sidebar */}
      <Sidebar />

      {/* Main View Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header
          onOpenNewProject={() => setShowNewProjectModal(true)}
          onOpenQuickBuild={() => setShowQuickBuildModal(true)}
          onOpenExportZip={() => setShowExportZipModal(true)}
        />

        <main className="flex-1 overflow-y-auto">
          {currentTab === 'projects' && <ProjectsView onOpenNewProject={() => setShowNewProjectModal(true)} />}
          {currentTab === 'twa' && <TwaView />}
          {currentTab === 'builds' && <BuildsView />}
          {currentTab === 'testing' && <TestingView />}
          {currentTab === 'errors' && <ErrorTelemetryView />}
          {currentTab === 'tools' && <DevToolsView onOpenExportZip={() => setShowExportZipModal(true)} />}
          {currentTab === 'team' && <TeamView />}
          {currentTab === 'billing' && <BillingView />}
          {currentTab === 'settings' && <SettingsView />}
          {currentTab === 'dashboard' && (
            <DashboardOverview
              onOpenNewProject={() => setShowNewProjectModal(true)}
              onOpenQuickBuild={() => setShowQuickBuildModal(true)}
              onOpenExportZip={() => setShowExportZipModal(true)}
            />
          )}
        </main>
      </div>

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-cyan-500/50 shadow-2xl rounded-lg px-4 py-3 flex items-center gap-3 text-xs text-slate-200 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
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
      <ExportProjectZipModal
        isOpen={showExportZipModal}
        onClose={() => setShowExportZipModal(false)}
      />
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
    return <div className="h-screen bg-slate-950 flex items-center justify-center text-slate-500 text-sm">Loading...</div>;
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
