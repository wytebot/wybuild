import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  CheckCircle2,
  XCircle,
  Clock,
  Play,
  GitBranch,
  Github,
  Zap,
  Download,
  Terminal,
  QrCode,
  ArrowUpRight,
  TrendingUp,
  Filter,
  Search,
  HardDrive,
  Cpu,
  Layers,
  Sparkles,
  FolderArchive,
} from 'lucide-react';

interface DashboardOverviewProps {
  onOpenNewProject: () => void;
  onOpenQuickBuild: () => void;
  onOpenExportZip: () => void;
}

export const DashboardOverview: React.FC<DashboardOverviewProps> = ({
  onOpenNewProject,
  onOpenQuickBuild,
  onOpenExportZip,
}) => {
  const {
    projects,
    builds,
    subscription,
    rateLimits,
    triggerBuild,
    setActiveBuildId,
    setCurrentTab,
    openFlutterwaveCheckout,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed' | 'running'>('all');
  const [selectedQrBuild, setSelectedQrBuild] = useState<string | null>(null);

  const isPro = subscription.plan === 'pro';

  // Calculate high-impact performance metrics
  const totalBuilds = builds.length;
  const successfulBuilds = builds.filter((b) => b.status === 'success').length;
  const failedBuilds = builds.filter((b) => b.status === 'failed').length;
  const runningBuilds = builds.filter((b) => b.status === 'running' || b.status === 'queued').length;
  const successRate = totalBuilds > 0 ? Math.round((successfulBuilds / totalBuilds) * 100) : 100;

  const finishedBuilds = builds.filter((b) => b.durationSeconds > 0);
  const avgDurationSeconds =
    finishedBuilds.length > 0
      ? Math.round(finishedBuilds.reduce((acc, b) => acc + b.durationSeconds, 0) / finishedBuilds.length)
      : 215;

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs.toString().padStart(2, '0')}s`;
  };

  // Filter projects for multi-project management
  const filteredProjects = projects.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.repoUrl.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.branch.toLowerCase().includes(searchQuery.toLowerCase());

    if (statusFilter === 'all') return matchesSearch;
    if (statusFilter === 'success') return matchesSearch && p.lastBuildStatus === 'success';
    if (statusFilter === 'failed') return matchesSearch && p.lastBuildStatus === 'failed';
    if (statusFilter === 'running') return matchesSearch && builds.some((b) => b.projectId === p.id && b.status === 'running');
    return matchesSearch;
  });

  const latestBuild = builds[0];

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-8">
      {/* Welcome & Context Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Flutter CI/CD Command Center</h1>
            {isPro ? (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded">
                Pro Priority Runner
              </span>
            ) : (
              <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-400 bg-cyan-950/80 border border-cyan-800/50 px-2 py-0.5 rounded">
                Free Developer Tier
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Real-time pipeline orchestration, artifact delivery, and build health telemetry for Flutter apps and Web-to-Android (TWA) conversions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <a
            href="/wybuild-source-code.zip"
            download="wybuild-source-code.zip"
            className="px-3.5 py-2 text-xs font-semibold text-emerald-300 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 rounded-md transition shadow-sm flex items-center gap-1.5 cursor-pointer"
            title="Download complete application source code archive with all files and folders intact"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Download Source Code (.zip)</span>
          </a>

          <button
            onClick={onOpenExportZip}
            className="px-3.5 py-2 text-xs font-semibold text-cyan-300 bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-700/60 rounded-md transition shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <FolderArchive className="w-3.5 h-3.5 text-cyan-400" />
            <span>Export Project (.zip)</span>
          </button>
          <button
            onClick={onOpenQuickBuild}
            className="px-4 py-2 text-xs font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5 text-emerald-400 fill-emerald-400" />
            <span>One-Click Cloud Build</span>
          </button>
          <button
            onClick={onOpenNewProject}
            className="px-4 py-2 text-xs font-semibold text-white bg-cyan-600 hover:bg-cyan-500 rounded-md transition shadow-sm flex items-center gap-2 cursor-pointer"
          >
            <Github className="w-4 h-4" />
            <span>Connect GitHub Repo</span>
          </button>
        </div>
      </div>

      {/* 4 Core Performance & Health Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1: Build Success Rate */}
        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Pipeline Success Rate</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="my-3">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">{successRate}%</span>
            <span className="text-xs text-slate-500 ml-2">({successfulBuilds}/{totalBuilds} runs)</span>
          </div>
          <div className="text-[11px] text-emerald-400 flex items-center gap-1 font-medium">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Optimal Gradle DEX compilation</span>
          </div>
        </div>

        {/* Metric 2: Average Cloud Build Time */}
        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Avg Pipeline Duration</span>
            <Clock className="w-4 h-4 text-cyan-400" />
          </div>
          <div className="my-3">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {formatDuration(avgDurationSeconds)}
            </span>
            <span className="text-xs text-slate-500 ml-2">clean build</span>
          </div>
          <div className="text-[11px] text-cyan-400 flex items-center gap-1 font-mono">
            <HardDrive className="w-3 h-3" />
            <span>94.2% SDK warm cache hit</span>
          </div>
        </div>

        {/* Metric 3: Active & Running Queues */}
        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Runner Concurrency</span>
            <Cpu className="w-4 h-4 text-amber-400" />
          </div>
          <div className="my-3">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {runningBuilds} <span className="text-sm font-normal text-slate-400">/ {rateLimits.concurrentLimit} active</span>
            </span>
          </div>
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Queue dispatch:</span>
            <span className="font-mono text-emerald-400 font-medium">{isPro ? '0s (Instant Pro)' : '< 12s'}</span>
          </div>
        </div>

        {/* Metric 4: Free Quota & Cost Protection Guard */}
        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Monthly Successful Build Quota</span>
            <Zap className={`w-4 h-4 ${isPro ? 'text-amber-400' : 'text-slate-400'}`} />
          </div>
          <div className="my-3">
            <span className="text-2xl font-bold font-mono text-white tabular-nums">
              {isPro ? 'Unlimited' : `${rateLimits.monthlyBuildsUsed} / 5`}
            </span>
            {!isPro && <span className="text-xs text-slate-500 ml-2">builds</span>}
          </div>
          <div className="text-[11px] text-slate-400 flex items-center justify-between">
            <span>Cost protection:</span>
            <button
              onClick={() => openFlutterwaveCheckout('monthly')}
              className="text-cyan-400 hover:text-cyan-300 font-medium underline cursor-pointer"
            >
              {isPro ? 'Pro Subscribed' : 'Upgrade ($10/mo)'}
            </button>
          </div>
        </div>
      </div>

      {/* Latest Artifact Spotlight Banner (if latest build is success) */}
      {latestBuild && latestBuild.status === 'success' && latestBuild.artifacts.length > 0 && (
        <div className="p-5 rounded-xl bg-gradient-to-r from-slate-900 via-slate-900 to-cyan-950/40 border border-cyan-800/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-emerald-400">Latest Release Ready</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400 font-mono">Build #{latestBuild.id.replace('build-', '')}</span>
                <span className="text-slate-600">·</span>
                <span className="text-slate-400">{latestBuild.projectName}</span>
              </div>
              <p className="text-sm font-semibold text-white mt-1">
                {latestBuild.artifacts[0].name} ({latestBuild.artifacts[0].sizeFormatted})
              </p>
              <p className="text-xs text-slate-400 font-mono mt-0.5 break-all">
                SHA-256: {latestBuild.artifacts[0].sha256}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              onClick={() => setSelectedQrBuild(latestBuild.id)}
              className="px-3.5 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-md transition flex items-center gap-1.5 cursor-pointer"
            >
              <QrCode className="w-4 h-4 text-cyan-400" />
              <span>Mobile QR Install</span>
            </button>
            <a
              href={latestBuild.artifacts[0].downloadUrl}
              download={latestBuild.artifacts[0].name}
              className="px-4 py-2 text-xs font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-md transition flex items-center gap-1.5 shadow-sm cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Download APK</span>
            </a>
          </div>
        </div>
      )}

      {/* Multi-Project Grid & Filters */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">Project Workspaces</h2>
            <span className="text-xs font-mono text-slate-400">({projects.length} connected)</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search repo, branch..."
                className="pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-md text-xs text-white placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-48 sm:w-64"
              />
            </div>

            {/* Segmented Filter Controls */}
            <div className="flex items-center gap-1 p-1 bg-slate-900 border border-slate-800 rounded-md">
              <button
                onClick={() => setStatusFilter('all')}
                className={`px-2.5 py-1 text-xs rounded transition cursor-pointer ${
                  statusFilter === 'all' ? 'bg-slate-800 text-white font-medium shadow-sm' : 'text-slate-400 hover:text-white'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setStatusFilter('success')}
                className={`px-2.5 py-1 text-xs rounded transition cursor-pointer ${
                  statusFilter === 'success' ? 'bg-emerald-950 text-emerald-300 font-medium' : 'text-slate-400 hover:text-white'
                }`}
              >
                Passing
              </button>
              <button
                onClick={() => setStatusFilter('failed')}
                className={`px-2.5 py-1 text-xs rounded transition cursor-pointer ${
                  statusFilter === 'failed' ? 'bg-rose-950 text-rose-300 font-medium' : 'text-slate-400 hover:text-white'
                }`}
              >
                Failing
              </button>
            </div>
          </div>
        </div>

        {/* Project Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredProjects.map((project) => {
            const isRunning = builds.some((b) => b.projectId === project.id && b.status === 'running');
            return (
              <div
                key={project.id}
                className="p-5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-bold text-white break-words">{project.name}</h3>
                      <p className="text-xs text-slate-400 break-words mt-0.5">{project.repoUrl.replace('https://github.com/', '')}</p>
                    </div>

                    {isRunning ? (
                      <span className="flex items-center gap-1 text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Building
                      </span>
                    ) : project.lastBuildStatus === 'success' ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Passing
                      </span>
                    ) : project.lastBuildStatus === 'failed' ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-rose-400">
                        <XCircle className="w-3.5 h-3.5" />
                        Failed
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-500 font-mono">Not built</span>
                    )}
                  </div>

                  <p className="text-xs text-slate-400 line-clamp-2 mb-3 mt-1">{project.description}</p>

                  <div className="py-2.5 border-y border-slate-800 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Target config:</span>
                      <span className="font-mono text-slate-200 uppercase text-[11px] font-semibold">
                        {project.kind === 'twa' && project.twa ? `TWA · ${project.twa.output}` : `${project.config.target} · ${project.config.mode}`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Branch:</span>
                      <span className="font-mono text-cyan-400 text-[11px] flex items-center gap-1">
                        <GitBranch className="w-3 h-3" />
                        {project.branch}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Flutter SDK:</span>
                      <span className="font-mono text-slate-300 text-[11px]">{project.kind === 'twa' ? 'Bubblewrap' : `v${project.config.flutterVersion}`}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    onClick={() => triggerBuild(project.id)}
                    disabled={isRunning}
                    className="flex-1 py-1.5 px-3 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center justify-center gap-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    <Play className="w-3 h-3 fill-white" />
                    <span>Trigger Build</span>
                  </button>
                  <button
                    onClick={() => {
                      setCurrentTab('projects');
                    }}
                    className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition text-xs font-medium cursor-pointer"
                  >
                    Config
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Build History Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white">Recent Cloud Build Runs</h2>
            <span className="text-xs text-slate-500">· Live execution pipeline</span>
          </div>
          <button
            onClick={() => setCurrentTab('builds')}
            className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
          >
            <span>View all in Terminal</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="bg-slate-950/70 border-b border-slate-800 text-slate-400 uppercase font-mono text-[10px]">
                <tr>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Build ID</th>
                  <th className="py-3 px-4">Project</th>
                  <th className="py-3 px-4">Commit / Branch</th>
                  <th className="py-3 px-4">Target</th>
                  <th className="py-3 px-4 text-right">Duration</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-sans">
                {builds.slice(0, 5).map((build) => {
                  return (
                    <tr key={build.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-3 px-4 whitespace-nowrap">
                        {build.status === 'success' && (
                          <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>Passed</span>
                          </span>
                        )}
                        {build.status === 'failed' && (
                          <span className="inline-flex items-center gap-1.5 text-rose-400 font-medium">
                            <XCircle className="w-4 h-4 shrink-0" />
                            <span>Failed</span>
                          </span>
                        )}
                        {build.status === 'running' && (
                          <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            <span>Building...</span>
                          </span>
                        )}
                        {build.status === 'cancelled' && (
                          <span className="inline-flex items-center gap-1.5 text-slate-400">
                            <span>Cancelled</span>
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 font-mono text-cyan-400 font-medium">
                        #{build.id.replace('build-', '')}
                      </td>

                      <td className="py-3 px-4 font-medium text-white break-words">
                        {build.projectName}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-cyan-300 bg-slate-800 px-1.5 py-0.5 rounded text-[11px]">
                            {build.commitHash}
                          </span>
                          <span className="text-slate-400 break-words">{build.commitMessage}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono uppercase text-[11px] text-slate-300">
                        {build.target} ({build.mode})
                      </td>

                      <td className="py-3 px-4 text-right font-mono text-slate-300 tabular-nums">
                        {build.durationSeconds > 0 ? formatDuration(build.durationSeconds) : 'In progress'}
                      </td>

                      <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                        <button
                          onClick={() => {
                            setActiveBuildId(build.id);
                            setCurrentTab('builds');
                          }}
                          className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Terminal className="w-3 h-3 text-cyan-400" />
                          <span>Logs</span>
                        </button>

                        {build.status === 'success' && build.artifacts.length > 0 && (
                          <button
                            onClick={() => setSelectedQrBuild(build.id)}
                            className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition inline-flex items-center cursor-pointer"
                            title="Scan QR Code to install on Android phone"
                          >
                            <QrCode className="w-3.5 h-3.5 text-emerald-400" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* QR Code Install Modal */}
      {selectedQrBuild && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 max-w-sm w-full max-h-[92dvh] overflow-y-auto overscroll-contain space-y-4 shadow-2xl text-center">
            <h3 className="text-base font-bold text-white">Direct Android Device Install</h3>
            <p className="text-xs text-slate-400">
              Point your Android phone camera at this QR code to download and test the generated APK wirelessly.
            </p>

            {/* Generated QR Code preview */}
            <div className="p-4 bg-white rounded-lg inline-block mx-auto shadow-inner">
              <svg className="w-48 h-48" viewBox="0 0 100 100">
                {/* SVG QR Code Simulation */}
                <rect width="100" height="100" fill="#ffffff" />
                {/* Position detection corners */}
                <rect x="5" y="5" width="25" height="25" fill="#0f172a" />
                <rect x="8" y="8" width="19" height="19" fill="#ffffff" />
                <rect x="11" y="11" width="13" height="13" fill="#0f172a" />

                <rect x="70" y="5" width="25" height="25" fill="#0f172a" />
                <rect x="73" y="8" width="19" height="19" fill="#ffffff" />
                <rect x="76" y="11" width="13" height="13" fill="#0f172a" />

                <rect x="5" y="70" width="25" height="25" fill="#0f172a" />
                <rect x="8" y="73" width="19" height="19" fill="#ffffff" />
                <rect x="11" y="76" width="13" height="13" fill="#0f172a" />

                {/* Simulated data matrix blocks */}
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
                <rect x="70" y="60" width="12" height="12" fill="#0f172a" />
                <rect x="85" y="75" width="8" height="18" fill="#0f172a" />
                <rect x="35" y="82" width="15" height="10" fill="#0f172a" />
                <rect x="55" y="80" width="15" height="12" fill="#0f172a" />
              </svg>
            </div>

            <div className="text-xs font-mono text-slate-400">
              Direct Download URL: <span className="text-cyan-400">https://wybuild.app/dl/{selectedQrBuild}</span>
            </div>

            <button
              onClick={() => setSelectedQrBuild(null)}
              className="w-full py-2 text-xs font-semibold rounded bg-slate-800 text-white hover:bg-slate-700 transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
