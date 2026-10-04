import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { TerminalViewer } from './TerminalViewer';
import { TwaBuildPanel } from '../twa/TwaBuildPanel';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  GitBranch,
  Github,
  Download,
  QrCode,
  AlertTriangle,
  RotateCw,
  StopCircle,
  FileCode,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

export const BuildsView: React.FC = () => {
  const { builds, activeBuildId, setActiveBuildId, cancelBuild, applyAutoFix, triggerBuild, awaitingNewBuild } = useApp();
  const [filterProject, setFilterProject] = useState<string>('all');
  const [showQrModal, setShowQrModal] = useState<boolean>(false);

  // while a new run is being created the old build (and its logs) must not stay on screen
  const selectedBuild = awaitingNewBuild ? undefined : builds.find((b) => b.id === activeBuildId) || builds[0];

  const allLogs = selectedBuild
    ? selectedBuild.steps.flatMap((s) => s.logs)
    : [];

  const isRunning = selectedBuild?.status === 'running';

  return (
    <div className="h-full flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
      {/* Left List Pane: Builds Queue & History */}
      <div className="w-full md:w-80 lg:w-96 border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950 flex flex-col shrink-0 max-h-[40dvh] md:max-h-none overflow-y-auto">
        <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-white">Build Pipeline History</h2>
            <span className="text-xs font-mono text-slate-400 tabular-nums">({builds.length})</span>
          </div>
        </div>

        <div className="divide-y divide-slate-800/80">
          {builds.map((build) => {
            const isSelected = !awaitingNewBuild && build.id === selectedBuild?.id;
            return (
              <button
                key={build.id}
                onClick={() => setActiveBuildId(build.id)}
                className={`w-full text-left p-4 transition cursor-pointer ${
                  isSelected ? 'bg-slate-900 border-l-4 border-emerald-400' : 'hover:bg-slate-900/50'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-mono text-xs font-semibold text-white">
                    #{build.id.replace('build-', '')}
                  </span>
                  {build.status === 'success' && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Success</span>
                    </span>
                  )}
                  {build.status === 'failed' && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-rose-400">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Failed</span>
                    </span>
                  )}
                  {build.status === 'running' && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
                      <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                      <span>Building</span>
                    </span>
                  )}
                  {build.status === 'cancelled' && (
                    <span className="text-[11px] text-slate-500">Cancelled</span>
                  )}
                </div>

                <p className="text-xs font-semibold text-slate-200 break-words">{build.projectName}</p>

                <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-1">
                  <span className="flex items-center gap-1 font-mono text-emerald-400">
                    <GitBranch className="w-3 h-3" />
                    {build.branch}
                  </span>
                  <span>·</span>
                  <span className="font-mono text-slate-400">{build.commitHash}</span>
                </div>

                <div className="flex items-center justify-between text-[11px] text-slate-400 mt-2 font-mono">
                  <span>{build.target.toUpperCase()} ({build.mode})</span>
                  <span>{build.durationSeconds > 0 ? `${build.durationSeconds}s` : 'running...'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Detail Pane: Pipeline Execution Details */}
      <div className="flex-1 min-w-0 bg-slate-900 md:overflow-y-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {selectedBuild ? (
          <>
            {/* Header info */}
            <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-lg font-bold text-white">{selectedBuild.projectName}</h1>
                  <span className="text-xs font-mono text-emerald-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                    Build #{selectedBuild.id.replace('build-', '')}
                  </span>
                  <span className="text-xs font-mono uppercase text-slate-400 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded">
                    {selectedBuild.kind === 'twa' ? `TWA · ${selectedBuild.twa?.packageId || ''}` : `${selectedBuild.target} · ${selectedBuild.mode}`}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mt-2 font-mono">
                  <span className="flex items-center gap-1 text-emerald-300">
                    <GitBranch className="w-3.5 h-3.5" />
                    {selectedBuild.branch}
                  </span>
                  <span>·</span>
                  <span>{selectedBuild.commitHash}</span>
                  <span>·</span>
                  <span className="text-slate-300 italic font-sans break-words">"{selectedBuild.commitMessage}"</span>
                  <span>·</span>
                  <span>Runner: {selectedBuild.runnerType}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 shrink-0">
                {isRunning ? (
                  <button
                    onClick={() => cancelBuild(selectedBuild.id)}
                    className="px-3.5 py-2 text-xs font-semibold rounded bg-rose-950 hover:bg-rose-900 border border-rose-800 text-rose-300 transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <StopCircle className="w-4 h-4" />
                    <span>Cancel Pipeline</span>
                  </button>
                ) : (
                  <button
                    onClick={() => triggerBuild(selectedBuild.projectId, selectedBuild.branch)}
                    className="px-3.5 py-2 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1.5 cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Re-run Build</span>
                  </button>
                )}
              </div>
            </div>

            {/* Error Diagnostics Banner if failed */}
            {selectedBuild.errorDiagnosis && (
              <div className="p-5 rounded-lg bg-rose-950/40 border border-rose-800/60 space-y-3">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono uppercase tracking-wider text-rose-400 font-bold">
                        Build diagnosis
                      </span>
                      <span className="text-slate-500">·</span>
                      <span className="text-xs text-slate-300 font-medium">{selectedBuild.errorDiagnosis.category}</span>
                    </div>
                    <h3 className="text-sm font-bold text-white mt-1">
                      {selectedBuild.errorDiagnosis.title}
                    </h3>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {selectedBuild.errorDiagnosis.description}
                    </p>

                    <div className="mt-3 grid sm:grid-cols-2 gap-2">
                      <div className="p-3 bg-slate-950/80 rounded border border-rose-900/40">
                        <span className="text-slate-500 block mb-1">What went wrong</span>
                        <span className="text-rose-200">{selectedBuild.errorDiagnosis.description}</span>
                      </div>
                      <div className="p-3 bg-slate-950/80 rounded border border-emerald-900/40">
                        <span className="text-slate-500 block mb-1">What is needed</span>
                        <span className="text-emerald-200">{selectedBuild.errorDiagnosis.suggestedFix}</span>
                      </div>
                    </div>
                    {selectedBuild.errorDiagnosis.matchedPattern && <div className="p-2.5 bg-black/30 rounded border border-white/[.05] text-[11px] font-mono text-slate-400 mt-2 break-words"><span className="text-slate-600">Build reported: </span>{selectedBuild.errorDiagnosis.matchedPattern}</div>}

                    {selectedBuild.errorDiagnosis.autoFixAvailable && selectedBuild.errorDiagnosis.autoFixAction && (
                      <div className="mt-3">
                        <button
                          onClick={() => applyAutoFix(selectedBuild.id, selectedBuild.errorDiagnosis!.autoFixAction!)}
                          className="px-3.5 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                        >
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Apply 1-Click Fix ({selectedBuild.errorDiagnosis.autoFixAction})</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Pipeline Step Timeline */}
            <div className="p-5 rounded-lg bg-slate-950 border border-slate-800">
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-4">
                Pipeline Stages Execution
              </h3>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {selectedBuild.steps.map((step, idx) => {
                  return (
                    <div
                      key={step.id}
                      className="p-3 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {step.status === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                        {step.status === 'failed' && <XCircle className="w-4 h-4 text-rose-400 shrink-0" />}
                        {step.status === 'running' && (
                          <span className="w-4 h-4 rounded-full border-2 border-amber-400 border-t-transparent animate-spin shrink-0" />
                        )}
                        {step.status === 'pending' && <Clock className="w-4 h-4 text-slate-600 shrink-0" />}

                        <div className="min-w-0">
                          <p className="text-slate-200 font-medium break-words">{step.name}</p>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {step.status === 'success' ? `${Math.round(step.durationMs / 100) / 10}s` : step.status}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {selectedBuild.status === 'success' && <TwaBuildPanel build={selectedBuild} />}

            {/* Generated Artifacts Section */}
            {selectedBuild.artifacts.length > 0 && (
              <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">
                    Compiled Binary Artifacts
                  </h3>
                  <button
                    onClick={() => setShowQrModal(true)}
                    className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer font-medium"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Scan with Android Device</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {selectedBuild.artifacts.map((art, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 mr-3">
                        <div className="flex items-center gap-1.5">
                          <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />
                          <span className="font-semibold text-white break-words font-mono">{art.name}</span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {art.sizeFormatted} · SHA-256: {art.sha256.substring(0, 16)}...
                        </p>
                      </div>

                      <a
                        href={art.downloadUrl}
                        download={art.name}
                        className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold flex items-center gap-1 shrink-0 transition cursor-pointer text-xs"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download</span>
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Terminal Console Viewer */}
            <TerminalViewer
              logs={allLogs}
              isRunning={isRunning}
              buildId={selectedBuild.id}
            />
          </>
        ) : awaitingNewBuild ? (
          <div className="text-center py-20 text-slate-400 space-y-3">
            <div className="mx-auto w-8 h-8 rounded-full border-2 border-emerald-400/30 border-t-emerald-400 animate-spin" />
            <div className="text-sm font-semibold text-white">Starting a new build…</div>
            <p className="text-xs text-slate-500">Previous logs cleared. The new run's logs appear here as soon as GitHub starts it.</p>
          </div>
        ) : (
          <div className="text-center py-20 text-slate-500">No builds selected.</div>
        )}
      </div>

      {/* QR Code Modal */}
      {showQrModal && selectedBuild && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 max-w-sm w-full max-h-[92dvh] overflow-y-auto overscroll-contain space-y-4 shadow-2xl text-center">
            <h3 className="text-base font-bold text-white">Install APK on Physical Device</h3>
            <p className="text-xs text-slate-400">
              Scan this QR code with Google Lens or Camera on your Android phone to download and sideload the APK.
            </p>

            <div className="p-4 bg-white rounded-lg inline-block mx-auto shadow-inner">
              <svg className="w-48 h-48" viewBox="0 0 100 100">
                <rect width="100" height="100" fill="#ffffff" />
                <rect x="5" y="5" width="25" height="25" fill="#0f172a" />
                <rect x="8" y="8" width="19" height="19" fill="#ffffff" />
                <rect x="11" y="11" width="13" height="13" fill="#0f172a" />

                <rect x="70" y="5" width="25" height="25" fill="#0f172a" />
                <rect x="73" y="8" width="19" height="19" fill="#ffffff" />
                <rect x="76" y="11" width="13" height="13" fill="#0f172a" />

                <rect x="5" y="70" width="25" height="25" fill="#0f172a" />
                <rect x="8" y="73" width="19" height="19" fill="#ffffff" />
                <rect x="11" y="76" width="13" height="13" fill="#0f172a" />

                <rect x="35" y="8" width="5" height="5" fill="#0f172a" />
                <rect x="45" y="8" width="8" height="5" fill="#0f172a" />
                <rect x="35" y="18" width="12" height="6" fill="#0f172a" />
                <rect x="52" y="18" width="6" height="6" fill="#0f172a" />
                <rect x="8" y="38" width="6" height="12" fill="#0f172a" />
                <rect x="18" y="42" width="10" height="6" fill="#0f172a" />
                <rect x="34" y="34" width="8" height="8" fill="#0f172a" />
                <rect x="46" y="34" width="18" height="6" fill="#0f172a" />
                <rect x="70" y="34" width="6" height="16" fill="#0f172a" />
                <rect x="80" y="44" width="12" height="6" fill="#0f172a" />
                <rect x="35" y="50" width="16" height="8" fill="#0f172a" />
                <rect x="55" y="45" width="8" height="16" fill="#0f172a" />
                <rect x="35" y="65" width="8" height="10" fill="#0f172a" />
                <rect x="48" y="65" width="18" height="6" fill="#0f172a" />
              </svg>
            </div>

            <div className="text-xs font-mono text-slate-400">
              Artifact: <span className="text-emerald-400">{selectedBuild.artifacts[0]?.name || 'app-release.apk'}</span>
            </div>

            <button
              onClick={() => setShowQrModal(false)}
              className="w-full py-2 text-xs font-semibold rounded bg-slate-800 text-white hover:bg-slate-700 transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
