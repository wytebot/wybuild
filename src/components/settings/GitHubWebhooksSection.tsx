import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { GitHubWebhook, BuildTarget, BuildMode } from '../../types';
import {
  Webhook,
  Plus,
  Copy,
  Check,
  RotateCw,
  Trash2,
  Play,
  Github,
  GitBranch,
  ShieldCheck,
  AlertCircle,
  Clock,
  Eye,
  EyeOff,
  ExternalLink,
  CheckCircle2,
  XCircle,
  Activity,
  Layers,
  Sparkles,
} from 'lucide-react';

export const GitHubWebhooksSection: React.FC = () => {
  const {
    projects,
    webhooks,
    webhookDeliveries,
    createWebhook,
    updateWebhook,
    deleteWebhook,
    regenerateWebhookSecret,
    triggerTestWebhookPush,
    showToast,
    setActiveBuildId,
    setCurrentTab,
  } = useApp();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [branchesInput, setBranchesInput] = useState<string>('main, release/**');
  const [target, setTarget] = useState<BuildTarget>('apk');
  const [mode, setMode] = useState<BuildMode>('release');
  const [autoCancelRedundant, setAutoCancelRedundant] = useState(true);
  const [events, setEvents] = useState<('push' | 'pull_request' | 'release')[]>(['push']);

  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [visibleSecrets, setVisibleSecrets] = useState<Record<string, boolean>>({});
  const [testingWebhookId, setTestingWebhookId] = useState<string | null>(null);
  const [editingWebhook, setEditingWebhook] = useState<GitHubWebhook | null>(null);

  const copyToClipboard = (text: string, keyId: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(keyId);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const toggleSecretVisibility = (id: string) => {
    setVisibleSecrets((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCreateWebhook = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId) return;

    const parsedBranches = branchesInput
      .split(',')
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    createWebhook({
      projectId: selectedProjectId,
      branches: parsedBranches.length > 0 ? parsedBranches : ['main'],
      target,
      mode,
      events,
      autoCancelRedundantBuilds: autoCancelRedundant,
    });

    setShowCreateModal(false);
    setBranchesInput('main, release/**');
  };

  const handleTestPush = async (webhookId: string, branchName: string) => {
    setTestingWebhookId(webhookId);
    await triggerTestWebhookPush(webhookId, branchName);
    setTestingWebhookId(null);
  };

  const handleSaveEditBranches = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWebhook) return;

    updateWebhook(editingWebhook.id, {
      branches: editingWebhook.branches,
      target: editingWebhook.target,
      mode: editingWebhook.mode,
      autoCancelRedundantBuilds: editingWebhook.autoCancelRedundantBuilds,
    });
    setEditingWebhook(null);
  };

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <Webhook className="w-5 h-5 text-cyan-400" />
            <h2 className="text-lg font-bold text-white">GitHub Webhook Pipeline Automation</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Generate and manage secure Webhook URLs with HMAC SHA-256 signatures to automatically trigger cloud APK builds on every git push to specified branches.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-2 shadow-sm cursor-pointer self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          <span>Generate Webhook URL</span>
        </button>
      </div>

      {/* GitHub Repository Webhooks List */}
      <div className="space-y-4">
        {webhooks.length === 0 ? (
          <div className="p-8 text-center rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-400 space-y-3">
            <Webhook className="w-8 h-8 text-slate-600 mx-auto" />
            <p className="font-semibold text-white">No GitHub Webhooks Generated Yet</p>
            <p className="max-w-md mx-auto">
              Generate a webhook endpoint for your repository to trigger automated cloud builds whenever you or your team pushes commits.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-3.5 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-medium inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Generate First Webhook</span>
            </button>
          </div>
        ) : (
          webhooks.map((wh) => {
            const isSecretVisible = visibleSecrets[wh.id] || false;
            const isTesting = testingWebhookId === wh.id;

            return (
              <div
                key={wh.id}
                className={`p-5 rounded-lg bg-slate-950 border transition space-y-4 ${
                  wh.isActive ? 'border-slate-800 hover:border-slate-700' : 'border-slate-800/50 opacity-75'
                }`}
              >
                {/* Header Row */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400 shrink-0">
                      <Github className="w-5 h-5 text-slate-300" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-bold text-white">{wh.projectName}</h3>
                        <span className="text-slate-600">·</span>
                        <span className="font-mono text-xs text-slate-400">{wh.repoUrl.replace('https://github.com/', '')}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-400">
                        <span>Triggers:</span>
                        <span className="font-mono text-cyan-300 font-semibold uppercase">{wh.target} ({wh.mode})</span>
                        <span>·</span>
                        <span>Deliveries: <strong className="font-mono text-slate-200">{wh.deliveryCount}</strong></span>
                        {wh.lastDeliveredAt && (
                          <>
                            <span>·</span>
                            <span>Last push: {new Date(wh.lastDeliveredAt).toLocaleTimeString()}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions & Status */}
                  <div className="flex items-center gap-2.5">
                    <label className="flex items-center gap-2 text-xs cursor-pointer mr-2">
                      <input
                        type="checkbox"
                        checked={wh.isActive}
                        onChange={(e) => updateWebhook(wh.id, { isActive: e.target.checked })}
                        className="rounded bg-slate-900 border-slate-700 text-cyan-600 focus:ring-0"
                      />
                      <span className={wh.isActive ? 'text-emerald-400 font-medium' : 'text-slate-500'}>
                        {wh.isActive ? 'Active' : 'Paused'}
                      </span>
                    </label>

                    <button
                      onClick={() => handleTestPush(wh.id, wh.branches[0] || 'main')}
                      disabled={isTesting}
                      className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      title="Simulate a GitHub push event payload to trigger an automated build"
                    >
                      {isTesting ? (
                        <>
                          <span className="w-3 h-3 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                          <span>Dispatching...</span>
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
                          <span>Test Webhook Push</span>
                        </>
                      )}
                    </button>

                    <button
                      onClick={() => setEditingWebhook(wh)}
                      className="px-2.5 py-1.5 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 text-xs transition cursor-pointer"
                    >
                      Configure
                    </button>

                    <button
                      onClick={() => deleteWebhook(wh.id)}
                      className="p-1.5 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                      title="Delete Webhook"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Target Branches Filter Pills */}
                <div className="p-3 rounded bg-slate-900 border border-slate-800/80 text-xs flex flex-wrap items-center gap-2">
                  <span className="text-slate-400 font-medium flex items-center gap-1">
                    <GitBranch className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Monitored Branches:</span>
                  </span>
                  {wh.branches.map((b, i) => (
                    <span
                      key={i}
                      className="font-mono text-[11px] text-cyan-300 bg-cyan-950/80 border border-cyan-800/60 px-2 py-0.5 rounded"
                    >
                      {b}
                    </span>
                  ))}
                  {wh.autoCancelRedundantBuilds && (
                    <span className="text-[10px] font-mono text-amber-300 bg-amber-950/40 border border-amber-800/40 px-1.5 py-0.5 rounded ml-auto">
                      Auto-cancels redundant in-flight builds
                    </span>
                  )}
                </div>

                {/* Webhook URL & Secret Display */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {/* Payload URL */}
                  <div className="p-3 rounded bg-slate-900 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-medium text-[11px]">Payload URL (GitHub Webhook)</span>
                      <button
                        onClick={() => copyToClipboard(wh.webhookUrl, `url-${wh.id}`)}
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono text-[11px] cursor-pointer"
                      >
                        {copiedKey === `url-${wh.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedKey === `url-${wh.id}` ? 'Copied!' : 'Copy URL'}</span>
                      </button>
                    </div>
                    <p className="font-mono text-slate-200 text-xs break-words select-all">{wh.webhookUrl}</p>
                  </div>

                  {/* Secret */}
                  <div className="p-3 rounded bg-slate-900 border border-slate-800 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400 font-medium text-[11px]">Webhook Secret (HMAC SHA-256)</span>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleSecretVisibility(wh.id)}
                          className="text-slate-400 hover:text-slate-200 transition cursor-pointer"
                          title={isSecretVisible ? 'Hide Secret' : 'Reveal Secret'}
                        >
                          {isSecretVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                        </button>
                        <button
                          onClick={() => regenerateWebhookSecret(wh.id)}
                          className="text-amber-400 hover:text-amber-300 transition cursor-pointer"
                          title="Rotate Secret Key"
                        >
                          <RotateCw className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => copyToClipboard(wh.secret, `sec-${wh.id}`)}
                          className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-mono text-[11px] cursor-pointer"
                        >
                          {copiedKey === `sec-${wh.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          <span>{copiedKey === `sec-${wh.id}` ? 'Copied!' : 'Copy Secret'}</span>
                        </button>
                      </div>
                    </div>
                    <p className="font-mono text-slate-200 text-xs break-words select-all">
                      {isSecretVisible ? wh.secret : '••••••••••••••••••••••••••••••••••••••••'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* GitHub Setup Instructions Card */}
      <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-3">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
          <Github className="w-4 h-4 text-cyan-400" />
          <span>How to Connect this Webhook in GitHub</span>
        </h3>
        <ol className="list-decimal list-inside space-y-1.5 text-slate-400 leading-relaxed">
          <li>
            Go to your GitHub repository and click <strong className="text-white">Settings</strong> &gt; <strong className="text-white">Webhooks</strong> &gt; <strong className="text-white">Add webhook</strong>.
          </li>
          <li>
            Paste the copied <strong className="text-cyan-300 font-mono">Payload URL</strong> into the Payload URL field.
          </li>
          <li>
            Set <strong className="text-white">Content type</strong> to <code className="text-cyan-400 font-mono">application/json</code>.
          </li>
          <li>
            Paste the <strong className="text-cyan-300 font-mono">Secret</strong> into the Secret field for HMAC SHA-256 signature verification.
          </li>
          <li>
            Under <strong className="text-white">Which events would you like to trigger this webhook?</strong>, select <strong className="text-white">Just the push event</strong>.
          </li>
          <li>
            Ensure <strong className="text-white">Active</strong> is checked, then click <strong className="text-white">Add webhook</strong>.
          </li>
        </ol>
      </div>

      {/* Recent Webhook Deliveries & Activity History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-cyan-400" />
            <h3 className="text-sm font-bold text-white">Recent Inbound Webhook Deliveries</h3>
            <span className="text-xs font-mono text-slate-500">({webhookDeliveries.length} logged)</span>
          </div>
        </div>

        <div className="bg-slate-950 border border-slate-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="bg-slate-900 border-b border-slate-800 text-slate-400 font-mono text-[10px] uppercase">
                <tr>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4">Event</th>
                  <th className="py-2.5 px-4">Branch</th>
                  <th className="py-2.5 px-4">Commit Hash / Message</th>
                  <th className="py-2.5 px-4">Pushed By</th>
                  <th className="py-2.5 px-4">Latency</th>
                  <th className="py-2.5 px-4 text-right">Triggered Build</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {webhookDeliveries.map((del) => (
                  <tr key={del.id} className="hover:bg-slate-900/40 transition">
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      {del.httpStatus === 200 ? (
                        <span className="inline-flex items-center gap-1 font-mono text-emerald-400 text-[11px] font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>200 OK</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-mono text-rose-400 text-[11px] font-semibold">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>{del.httpStatus}</span>
                        </span>
                      )}
                    </td>

                    <td className="py-2.5 px-4 font-mono text-cyan-300 text-[11px]">
                      {del.event}
                    </td>

                    <td className="py-2.5 px-4 font-mono text-slate-200 text-[11px]">
                      <span className="flex items-center gap-1">
                        <GitBranch className="w-3 h-3 text-cyan-400" />
                        {del.branch}
                      </span>
                    </td>

                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-1.5 break-words">
                        <span className="font-mono text-cyan-400 text-[11px]">{del.commitHash}</span>
                        <span className="text-slate-400 break-words text-xs">{del.commitMessage}</span>
                      </div>
                    </td>

                    <td className="py-2.5 px-4 font-mono text-slate-300 text-[11px]">
                      {del.author}
                    </td>

                    <td className="py-2.5 px-4 font-mono text-slate-400 text-[11px] tabular-nums">
                      {del.latencyMs}ms
                    </td>

                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      {del.triggeredBuildId && (
                        <button
                          onClick={() => {
                            setActiveBuildId(del.triggeredBuildId!);
                            setCurrentTab('builds');
                          }}
                          className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-800 text-cyan-400 hover:text-cyan-300 font-mono text-[11px] transition inline-flex items-center gap-1 cursor-pointer"
                        >
                          <span>#{del.triggeredBuildId.replace('build-', '')}</span>
                          <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* MODAL: GENERATE NEW WEBHOOK */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 max-w-lg w-full max-h-[92dvh] overflow-y-auto overscroll-contain space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Webhook className="w-4 h-4 text-cyan-400" />
                <h3 className="text-base font-bold text-white">Generate GitHub Webhook Endpoint</h3>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer text-xs"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleCreateWebhook} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Target Flutter Project</label>
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-medium focus:border-cyan-500 focus:outline-none"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.repoUrl.replace('https://github.com/', '')})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Trigger Branches (Comma-separated or Glob patterns)
                </label>
                <input
                  type="text"
                  required
                  value={branchesInput}
                  onChange={(e) => setBranchesInput(e.target.value)}
                  placeholder="main, release/**, staging, feature/*"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
                <span className="text-[11px] text-slate-500 block mt-1">
                  Supports wildcards, e.g. <code className="text-cyan-400">main</code>, <code className="text-cyan-400">release/**</code>, or <code className="text-cyan-400">v*</code>.
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Output Target Binary</label>
                  <select
                    value={target}
                    onChange={(e) => setTarget(e.target.value as BuildTarget)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="apk">Android APK (Universal)</option>
                    <option value="split-per-abi">Split APK per ABI (arm64/v7a)</option>
                    <option value="appbundle">Android App Bundle (.aab)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Build Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as BuildMode)}
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="release">Release (Production)</option>
                    <option value="debug">Debug (Fast Unsigned)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoCancelRedundant}
                    onChange={(e) => setAutoCancelRedundant(e.target.checked)}
                    className="rounded bg-slate-950 border-slate-700 text-cyan-600 focus:ring-0"
                  />
                  <span className="text-slate-300">
                    Automatically cancel in-flight builds if a newer commit is pushed to the same branch
                  </span>
                </label>
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>Generate Webhook</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIGURE / EDIT WEBHOOK */}
      {editingWebhook && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 max-w-lg w-full max-h-[92dvh] overflow-y-auto overscroll-contain space-y-5 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="text-base font-bold text-white">Configure Webhook: {editingWebhook.projectName}</h3>
              <button
                onClick={() => setEditingWebhook(null)}
                className="text-slate-400 hover:text-white cursor-pointer text-xs"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleSaveEditBranches} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">
                  Monitored Branches (Comma-separated)
                </label>
                <input
                  type="text"
                  value={editingWebhook.branches.join(', ')}
                  onChange={(e) =>
                    setEditingWebhook({
                      ...editingWebhook,
                      branches: e.target.value.split(',').map((s) => s.trim()).filter((s) => s.length > 0),
                    })
                  }
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Output Target</label>
                  <select
                    value={editingWebhook.target}
                    onChange={(e) =>
                      setEditingWebhook({
                        ...editingWebhook,
                        target: e.target.value as BuildTarget,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="apk">Android APK</option>
                    <option value="split-per-abi">Split APK per ABI</option>
                    <option value="appbundle">Android App Bundle (.aab)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Build Mode</label>
                  <select
                    value={editingWebhook.mode}
                    onChange={(e) =>
                      setEditingWebhook({
                        ...editingWebhook,
                        mode: e.target.value as BuildMode,
                      })
                    }
                    className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                  >
                    <option value="release">Release</option>
                    <option value="debug">Debug</option>
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer pt-2">
                <input
                  type="checkbox"
                  checked={editingWebhook.autoCancelRedundantBuilds}
                  onChange={(e) =>
                    setEditingWebhook({
                      ...editingWebhook,
                      autoCancelRedundantBuilds: e.target.checked,
                    })
                  }
                  className="rounded bg-slate-950 border-slate-700 text-cyan-600 focus:ring-0"
                />
                <span className="text-slate-300">Auto-cancel redundant in-flight builds on new push</span>
              </label>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setEditingWebhook(null)}
                  className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition cursor-pointer"
                >
                  Save Configuration
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
