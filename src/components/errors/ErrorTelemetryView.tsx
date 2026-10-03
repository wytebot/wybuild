import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  AlertTriangle,
  CheckCircle2,
  Sparkles,
  Search,
  Filter,
  ArrowRight,
  ShieldCheck,
  Terminal,
  ExternalLink,
} from 'lucide-react';

export const ErrorTelemetryView: React.FC = () => {
  const { builds, applyAutoFix, setActiveBuildId, setCurrentTab } = useApp();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [search, setSearch] = useState<string>('');

  // Collect all error diagnoses from builds
  const errors = builds
    .filter((b) => b.errorDiagnosis)
    .map((b) => ({
      buildId: b.id,
      projectName: b.projectName,
      branch: b.branch,
      date: b.startedAt,
      diagnosis: b.errorDiagnosis!,
    }));

  const filtered = errors.filter((item) => {
    const matchesSearch =
      item.projectName.toLowerCase().includes(search.toLowerCase()) ||
      item.diagnosis.title.toLowerCase().includes(search.toLowerCase()) ||
      item.diagnosis.description.toLowerCase().includes(search.toLowerCase());

    if (selectedCategory === 'all') return matchesSearch;
    return matchesSearch && item.diagnosis.category === selectedCategory;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Real-Time Error Reporting & Telemetry</h1>
            <span className="text-xs font-mono text-rose-400 bg-rose-950/60 border border-rose-800/50 px-2 py-0.5 rounded">
              Active Telemetry
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Intelligent pattern matching and root-cause diagnostics for Gradle, Kotlin, DEX, and Flutter build failures with 1-click remediation.
          </p>
        </div>

        {/* Filter Badges */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 text-xs rounded transition cursor-pointer ${
              selectedCategory === 'all'
                ? 'bg-slate-800 text-white font-medium shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            All Errors
          </button>
          <button
            onClick={() => setSelectedCategory('gradle')}
            className={`px-3 py-1.5 text-xs rounded transition cursor-pointer ${
              selectedCategory === 'gradle'
                ? 'bg-rose-950 text-rose-300 font-medium'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Gradle / Kotlin
          </button>
          <button
            onClick={() => setSelectedCategory('keystore')}
            className={`px-3 py-1.5 text-xs rounded transition cursor-pointer ${
              selectedCategory === 'keystore'
                ? 'bg-amber-950 text-amber-300 font-medium'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Signing
          </button>
        </div>
      </div>

      {/* Diagnostics List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="p-12 text-center rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
            <h3 className="text-base font-semibold text-white">No Unresolved Errors</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Your Flutter builds are compiling cleanly. If a Gradle, Kotlin, or signing error occurs, our telemetry engine will parse the stack trace and propose an immediate fix.
            </p>
          </div>
        ) : (
          filtered.map((item) => (
            <div
              key={item.buildId}
              className="p-6 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold uppercase text-rose-400 bg-rose-950/80 px-2 py-0.5 rounded border border-rose-800/40">
                      {item.diagnosis.category} failure
                    </span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-semibold text-white">{item.projectName}</span>
                    <span className="text-xs text-slate-400">·</span>
                    <span className="text-xs font-mono text-cyan-400">Build #{item.buildId.replace('build-', '')}</span>
                  </div>
                  <h3 className="text-base font-bold text-white mt-2">{item.diagnosis.title}</h3>
                </div>

                <button
                  onClick={() => {
                    setActiveBuildId(item.buildId);
                    setCurrentTab('builds');
                  }}
                  className="px-3 py-1.5 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition flex items-center gap-1.5 self-start cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Inspect Terminal</span>
                </button>
              </div>

              <p className="text-xs text-slate-300 leading-relaxed">{item.diagnosis.description}</p>

              {/* Matched Pattern */}
              <div className="p-3 rounded bg-slate-950 border border-slate-800 font-mono text-xs text-rose-300">
                <span className="text-slate-500 block text-[11px] mb-1">Triggering Gradle Exception:</span>
                {item.diagnosis.matchedPattern}
              </div>

              {/* Suggested Fix and Action */}
              <div className="p-4 rounded bg-emerald-950/30 border border-emerald-800/40 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider">
                    Remediation Strategy
                  </span>
                </div>
                <p className="text-xs text-slate-200 font-mono">{item.diagnosis.suggestedFix}</p>

                {item.diagnosis.autoFixAvailable && item.diagnosis.autoFixAction && (
                  <div className="pt-2">
                    <button
                      onClick={() => applyAutoFix(item.buildId, item.diagnosis.autoFixAction!)}
                      className="px-4 py-2 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-2 cursor-pointer shadow-sm"
                    >
                      <Sparkles className="w-4 h-4" />
                      <span>{item.diagnosis.autoFixAction}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
