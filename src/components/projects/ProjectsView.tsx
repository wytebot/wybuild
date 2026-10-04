import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Project, BuildConfiguration } from '../../types';
import {
  Play,
  Settings2,
  Trash2,
  GitBranch,
  Github,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  Plus,
  ShieldAlert,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

interface ProjectsViewProps {
  onOpenNewProject: () => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({ onOpenNewProject }) => {
  const { projects, deleteProject, updateProject, triggerBuild, setCurrentTab, subscription, keystores, openFlutterwaveCheckout } = useApp();
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);

  const isPro = subscription.plan === 'pro';
  const freeSlotsRemaining = Math.max(0, 10 - projects.length);

  const handleTrigger = async (projId: string) => {
    setTriggeringId(projId);
    await triggerBuild(projId);
    setTriggeringId(null);
  };

  const handleSaveConfig = (updatedConfig: BuildConfiguration) => {
    if (!editingProject) return;
    updateProject(editingProject.id, { config: updatedConfig });
    setEditingProject(null);
  };

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-8">
      {/* Top Banner & Quota */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Flutter Projects & Repositories</h1>
          <p className="text-sm text-slate-400 mt-1">
            Connect GitHub repositories, configure Android APK/AAB build matrices, and trigger one-click cloud pipelines.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {!isPro ? (
            <div className="px-3.5 py-2 rounded-lg bg-slate-900 border border-slate-800 text-xs flex items-center gap-2">
              <span className="text-slate-400">Free Project Quota:</span>
              <span className="font-mono text-emerald-400 font-bold">{projects.length} / 10 used</span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-400">{freeSlotsRemaining} available</span>
            </div>
          ) : (
            <div className="px-3.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs flex items-center gap-2 text-amber-300">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>Unlimited Projects Active</span>
            </div>
          )}

          <button
            onClick={onOpenNewProject}
            className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Connect Repository</span>
          </button>
        </div>
      </div>

      {/* Free Tier Limit Warning if near 10 */}
      {!isPro && projects.length >= 10 && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs text-amber-200">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <p className="font-semibold text-amber-300">Free Tier Project Cap Reached (10 / 10)</p>
              <p className="text-amber-200/80 mt-0.5">
                To keep server infrastructure costs sustainable, Free tier is capped at 10 projects. Upgrade to Pro for unlimited repositories and priority dedicated build runners.
              </p>
            </div>
          </div>
          <button
            onClick={() => openFlutterwaveCheckout('monthly')}
            className="px-3 py-1.5 rounded bg-amber-500 text-slate-950 font-bold hover:bg-amber-400 transition shrink-0 cursor-pointer"
          >
            Upgrade to Pro ($10/mo)
          </button>
        </div>
      )}

      {/* Projects Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {projects.map((project) => {
          const isTriggering = triggeringId === project.id;
          return (
            <div
              key={project.id}
              className="bg-slate-900 border border-slate-800 rounded-lg p-5 flex flex-col justify-between hover:border-slate-700 transition"
            >
              <div>
                {/* Header */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-white break-words">{project.name}</h3>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                      <Github className="w-3.5 h-3.5 shrink-0" />
                      <span className="break-words">{project.repoUrl.replace('https://github.com/', '')}</span>
                    </div>
                  </div>

                  {project.lastBuildStatus === 'success' && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Ready</span>
                    </span>
                  )}
                  {project.lastBuildStatus === 'failed' && (
                    <span className="flex items-center gap-1 text-[11px] font-medium text-rose-400">
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Failed</span>
                    </span>
                  )}
                </div>

                <p className="text-xs text-slate-400 line-clamp-2 my-3">{project.description}</p>

                {/* Configuration Specs */}
                <div className="py-3 border-y border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[11px]">Branch:</span>
                    <span className="text-slate-200 font-mono flex items-center gap-1">
                      <GitBranch className="w-3 h-3 text-emerald-400" />
                      {project.branch}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Target:</span>
                    <span className="text-slate-200 font-mono uppercase font-semibold">
                      {project.kind === 'twa' && project.twa ? `TWA ${project.twa.output}` : `${project.config.target} (${project.config.mode})`}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">{project.kind === 'twa' ? 'Web app:' : 'Flutter SDK:'}</span>
                    <span className="text-slate-200 font-mono break-words block">
                      {project.kind === 'twa' && project.twa ? project.twa.webUrl.replace(/^https:\/\//, '') : `v${project.config.flutterVersion}`}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[11px]">Builds:</span>
                    <span className="text-slate-200 font-mono tabular-nums">{project.buildCount} runs</span>
                  </div>
                </div>

                {/* Dart defines & flags */}
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {project.config.obfuscate && (
                    <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 px-1.5 py-0.5 rounded">
                      obfuscated
                    </span>
                  )}
                  {project.config.runTests && (
                    <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/60 border border-emerald-800/50 px-1.5 py-0.5 rounded">
                      tests enabled
                    </span>
                  )}
                  {project.config.dartDefines.length > 0 && (
                    <span className="text-[10px] font-mono text-slate-300 bg-slate-800 px-1.5 py-0.5 rounded">
                      {project.config.dartDefines.length} defines
                    </span>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between gap-2">
                <button
                  onClick={() => handleTrigger(project.id)}
                  disabled={isTriggering}
                  className="flex-1 py-1.5 px-3 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isTriggering ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Dispatching...</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-white" />
                      <span>{project.kind === 'twa' ? 'Build Android app' : `Build ${project.config.target.toUpperCase()}`}</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => (project.kind === 'twa' ? setCurrentTab('twa') : setEditingProject(project))}
                  title="Edit Build Configuration"
                  className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
                >
                  <Settings2 className="w-4 h-4" />
                </button>

                <button
                  onClick={() => deleteProject(project.id)}
                  title="Remove Project"
                  className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Configuration Modal */}
      {editingProject && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 max-w-xl w-full max-h-[92dvh] overflow-y-auto overscroll-contain space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="text-base font-bold text-white">Custom Build Configuration</h3>
                <p className="text-xs text-slate-400 mt-0.5">{editingProject.name}</p>
              </div>
              <button
                onClick={() => setEditingProject(null)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Target & Mode */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1.5">Output Artifact Target</label>
                  <select
                    value={editingProject.config.target}
                    onChange={(e) =>
                      setEditingProject({
                        ...editingProject,
                        config: { ...editingProject.config, target: e.target.value as any },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="apk">Android APK (Fat Single Binary)</option>
                    <option value="split-per-abi">Split APK per ABI (arm64-v8a / v7a)</option>
                    <option value="appbundle">Android App Bundle (.aab for Google Play)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1.5">Build Mode</label>
                  <select
                    value={editingProject.config.mode}
                    onChange={(e) =>
                      setEditingProject({
                        ...editingProject,
                        config: { ...editingProject.config, mode: e.target.value as any },
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="release">Release (Optimized & Signed)</option>
                    <option value="debug">Debug (Fast Unsigned Check)</option>
                    <option value="profile">Profile (Performance Tracing)</option>
                  </select>
                </div>
              </div>

              {/* Flutter SDK Version */}
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Flutter SDK Version</label>
                <select
                  value={editingProject.config.flutterVersion}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      config: { ...editingProject.config, flutterVersion: e.target.value },
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                >
                  <option value="3.29.0">Flutter 3.29.0 (Stable - Recommended)</option>
                  <option value="3.27.4">Flutter 3.27.4 (Stable)</option>
                  <option value="3.24.5">Flutter 3.24.5 (LTS)</option>
                  <option value="beta">Flutter Beta Channel</option>
                  <option value="master">Flutter Master (Edge)</option>
                </select>
              </div>

              {/* Toggles */}
              <div className="space-y-2.5 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingProject.config.obfuscate}
                    onChange={(e) =>
                      setEditingProject({
                        ...editingProject,
                        config: { ...editingProject.config, obfuscate: e.target.checked },
                      })
                    }
                    className="rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-0"
                  />
                  <span className="text-slate-200">
                    Enable R8/ProGuard symbol obfuscation (<code className="font-mono text-emerald-400">--obfuscate</code>)
                  </span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editingProject.config.runTests}
                    onChange={(e) =>
                      setEditingProject({
                        ...editingProject,
                        config: { ...editingProject.config, runTests: e.target.checked },
                      })
                    }
                    className="rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-0"
                  />
                  <span className="text-slate-200">
                    Execute automated tests before compiling (<code className="font-mono text-emerald-400">flutter test</code>)
                  </span>
                </label>
              </div>

              {/* Keystore */}
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Signing Keystore Profile</label>
                <select
                  value={editingProject.config.keystoreId || ''}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      config: { ...editingProject.config, keystoreId: e.target.value || undefined },
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                >
                  <option value="">Default Cloud Debug Keystore (Unsigned)</option>
                  {keystores.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name} (alias: {k.alias})
                    </option>
                  ))}
                </select>
              </div>

              {/* Custom Command Args */}
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Additional Flutter Build Flags</label>
                <input
                  type="text"
                  value={editingProject.config.customArgs}
                  onChange={(e) =>
                    setEditingProject({
                      ...editingProject,
                      config: { ...editingProject.config, customArgs: e.target.value },
                    })
                  }
                  placeholder="--no-tree-shake-icons --dart-define=KEY=VAL"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-emerald-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-slate-800 flex justify-end gap-2.5">
              <button
                onClick={() => setEditingProject(null)}
                className="px-4 py-2 text-xs rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSaveConfig(editingProject.config)}
                className="px-4 py-2 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition cursor-pointer"
              >
                Save Configuration
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
