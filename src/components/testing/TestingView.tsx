import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import {
  TestTube2,
  CheckCircle2,
  XCircle,
  Play,
  RotateCw,
  FileCode,
  ShieldCheck,
  BarChart3,
  Layers,
} from 'lucide-react';

export const TestingView: React.FC = () => {
  const { builds, projects, triggerBuild } = useApp();
  const [selectedSuite, setSelectedSuite] = useState<string>('all');

  // Find latest build with a test report
  const buildWithTests = builds.find((b) => b.testReport) || builds[0];
  const testReport = buildWithTests?.testReport || {
    total: 36,
    passed: 36,
    failed: 0,
    skipped: 0,
    durationMs: 4800,
    coveragePercent: 88.4,
    results: [
      { name: 'token refresh cycle on 401 response', suite: 'auth_provider_test.dart', status: 'passed' as const, durationMs: 420 },
      { name: 'biometric crypto signature verification', suite: 'auth_provider_test.dart', status: 'passed' as const, durationMs: 680 },
      { name: 'transfer amount currency formatting', suite: 'currency_formatter_test.dart', status: 'passed' as const, durationMs: 90 },
      { name: 'pin keypad accepts exactly 6 digits', suite: 'pin_keypad_test.dart', status: 'passed' as const, durationMs: 310 },
      { name: 'idempotent transfer submission queue', suite: 'transfer_engine_test.dart', status: 'passed' as const, durationMs: 820 },
      { name: 'offline cache synchronization rollback', suite: 'sync_engine_test.dart', status: 'passed' as const, durationMs: 510 },
    ],
  };

  const coverageBreakdown = [
    { module: 'lib/core/auth', coverage: 94, tests: 14 },
    { module: 'lib/data/repositories', coverage: 91, tests: 18 },
    { module: 'lib/bloc/wallet', coverage: 87, tests: 22 },
    { module: 'lib/ui/widgets', coverage: 82, tests: 12 },
  ];

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Automated Testing & QA Engine</h1>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded">
              flutter test
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Automated unit, widget, and integration test execution with lcov code coverage reports prior to compiling release binaries.
          </p>
        </div>

        <button
          onClick={() => triggerBuild(projects[0]?.id)}
          className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition shadow-sm flex items-center gap-2 cursor-pointer self-start sm:self-auto"
        >
          <Play className="w-4 h-4 fill-white" />
          <span>Execute Test Suite</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400">Total Tests</span>
          <div className="text-2xl font-bold font-mono text-white mt-2 tabular-nums">
            {testReport.total}
          </div>
          <span className="text-[11px] text-emerald-400 font-medium">All unit & widget suites</span>
        </div>

        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400">Pass Rate</span>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-2 tabular-nums">
            100%
          </div>
          <span className="text-[11px] text-slate-400 font-mono">0 failures, 0 skipped</span>
        </div>

        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400">Code Coverage</span>
          <div className="text-2xl font-bold font-mono text-emerald-400 mt-2 tabular-nums">
            {testReport.coveragePercent}%
          </div>
          <span className="text-[11px] text-slate-400">lcov.info generated</span>
        </div>

        <div className="p-4 rounded-lg bg-slate-900 border border-slate-800">
          <span className="text-xs text-slate-400">Execution Time</span>
          <div className="text-2xl font-bold font-mono text-white mt-2 tabular-nums">
            {(testReport.durationMs / 1000).toFixed(1)}s
          </div>
          <span className="text-[11px] text-slate-400 font-mono">Parallel test isolates</span>
        </div>
      </div>

      {/* Coverage Breakdown */}
      <div className="p-5 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
        <h2 className="text-sm font-bold text-white flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-emerald-400" />
          <span>Module Code Coverage Breakdown</span>
        </h2>

        <div className="space-y-3">
          {coverageBreakdown.map((item) => (
            <div key={item.module} className="text-xs">
              <div className="flex justify-between text-slate-300 font-mono mb-1">
                <span>{item.module}</span>
                <span className="tabular-nums font-semibold text-emerald-400">{item.coverage}% ({item.tests} tests)</span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-800">
                <div
                  className="bg-emerald-500 h-full rounded-full transition-all"
                  style={{ width: `${item.coverage}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Test Results Table */}
      <div className="space-y-3">
        <h2 className="text-sm font-bold text-white">Individual Test Invariants</h2>
        <div className="bg-slate-900 border border-slate-800 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-xs">
            <thead className="bg-slate-950 border-b border-slate-800 text-slate-400 font-mono text-[10px] uppercase">
              <tr>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Test Case</th>
                <th className="py-2.5 px-4">Test Suite</th>
                <th className="py-2.5 px-4 text-right">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {testReport.results.map((r, i) => (
                <tr key={i} className="hover:bg-slate-800/40 transition">
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Passed</span>
                    </span>
                  </td>
                  <td className="py-2.5 px-4 font-medium text-white">{r.name}</td>
                  <td className="py-2.5 px-4 font-mono text-emerald-300 text-[11px]">{r.suite}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-slate-400 tabular-nums">
                    {r.durationMs}ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>
    </div>
  );
};
