import React, { useState, useRef, useEffect } from 'react';
import { Search, Download, Copy, Check, ArrowDown } from 'lucide-react';

interface TerminalViewerProps {
  logs: string[];
  isRunning: boolean;
  buildId: string;
}

export const TerminalViewer: React.FC<TerminalViewerProps> = ({ logs, isRunning, buildId }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all');
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && terminalEndRef.current) {
      terminalEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const filteredLogs = logs.filter((log) => {
    const matchesSearch = log.toLowerCase().includes(search.toLowerCase());
    if (filter === 'errors') {
      return (
        matchesSearch &&
        (log.toLowerCase().includes('error') ||
          log.toLowerCase().includes('failure') ||
          log.toLowerCase().includes('failed') ||
          log.toLowerCase().includes('exception'))
      );
    }
    if (filter === 'warnings') {
      return (
        matchesSearch &&
        (log.toLowerCase().includes('warning') ||
          log.toLowerCase().includes('warn') ||
          log.toLowerCase().includes('deprecated'))
      );
    }
    return matchesSearch;
  });

  const handleCopyLogs = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadLogs = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wybuild-${buildId}-log.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-slate-950 border border-slate-800 rounded-lg flex flex-col h-[520px] font-mono text-xs overflow-hidden">
      {/* Terminal Control Bar */}
      <div className="px-4 py-2 bg-slate-900 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 text-slate-400">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-2">
            <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
          </div>
          <span className="text-[11px] text-slate-300 font-sans font-medium">Cloud Build Console</span>
          {isRunning && (
            <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded ml-2">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              Streaming logs
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs..."
              className="pl-6 pr-2 py-1 bg-slate-950 border border-slate-800 rounded text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 w-36"
            />
          </div>

          {/* Level Filter */}
          <div className="flex items-center gap-1 text-[11px] bg-slate-950 border border-slate-800 rounded p-0.5">
            <button
              onClick={() => setFilter('all')}
              className={`px-2 py-0.5 rounded cursor-pointer ${filter === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400'}`}
            >
              All
            </button>
            <button
              onClick={() => setFilter('errors')}
              className={`px-2 py-0.5 rounded cursor-pointer ${filter === 'errors' ? 'bg-rose-950 text-rose-300' : 'text-slate-400'}`}
            >
              Errors
            </button>
            <button
              onClick={() => setFilter('warnings')}
              className={`px-2 py-0.5 rounded cursor-pointer ${filter === 'warnings' ? 'bg-amber-950 text-amber-300' : 'text-slate-400'}`}
            >
              Warns
            </button>
          </div>

          {/* Auto scroll toggle */}
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={`p-1.5 rounded text-xs transition cursor-pointer ${autoScroll ? 'text-cyan-400 bg-cyan-950/40' : 'text-slate-500'}`}
            title="Auto-scroll"
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          {/* Copy */}
          <button
            onClick={handleCopyLogs}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Copy logs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Download */}
          <button
            onClick={handleDownloadLogs}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            title="Download full log file"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div className="flex-1 p-4 overflow-y-auto space-y-1 font-mono text-[11px] leading-relaxed text-slate-300 select-text">
        {filteredLogs.length === 0 ? (
          <div className="text-slate-600 italic py-8 text-center">No log output for current filter</div>
        ) : (
          filteredLogs.map((line, idx) => {
            const isError =
              line.toLowerCase().includes('error') ||
              line.toLowerCase().includes('failure') ||
              line.toLowerCase().includes('failed');
            const isWarning = line.toLowerCase().includes('warning') || line.toLowerCase().includes('warn');
            const isSuccess =
              line.toLowerCase().includes('success') ||
              line.toLowerCase().includes('[passed]') ||
              line.toLowerCase().includes('done.');
            const isCmd = line.startsWith('Running') || line.startsWith('Cloning') || line.startsWith('Built');

            return (
              <div
                key={idx}
                className={`flex gap-3 hover:bg-slate-900/60 px-1 py-0.5 rounded ${
                  isError
                    ? 'text-rose-400 bg-rose-950/20'
                    : isWarning
                    ? 'text-amber-300'
                    : isSuccess
                    ? 'text-emerald-300'
                    : isCmd
                    ? 'text-cyan-300'
                    : 'text-slate-300'
                }`}
              >
                <span className="text-slate-600 select-none w-8 text-right shrink-0">{idx + 1}</span>
                <span className="whitespace-pre-wrap break-all">{line}</span>
              </div>
            );
          })
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
};
