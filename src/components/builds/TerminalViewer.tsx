import React, { useState, useRef, useEffect } from 'react';
import { Search, Download, Copy, Check, ArrowDown, Loader2 } from 'lucide-react';
import { isNative } from '../../services/apiBase';

interface TerminalViewerProps {
  logs: string[];
  isRunning: boolean;
  buildId: string;
}

export const TerminalViewer: React.FC<TerminalViewerProps> = ({ logs, isRunning, buildId }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all');
  const [copied, setCopied] = useState(false);\n  const [downloading, setDownloading] = useState(false);\n  const [downloadMessage, setDownloadMessage] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll only this terminal viewport. scrollIntoView() may scroll ancestors too,
    // which can interfere with the app-level scroll in Android WebView.
    const viewport = terminalScrollRef.current;
    if (autoScroll && viewport) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: 'auto' });
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

  const handleDownloadLogs = async () => {
    if (downloading) return;
    setDownloading(true);
    setDownloadMessage('');
    // Export the complete build log, not the current search/filter view.
    const contents = `${logs.join('\\n')}\\n`;
    const fileName = `wybuild-${String(buildId).replace(/[^a-zA-Z0-9._-]/g, '_')}-log.txt`;
    try {
      const native = isNative() || !!(window as any).Capacitor?.isNativePlatform?.();
      if (native) {
        // Save persistently on the device (Documents), rather than using a Blob URL,
        // which Android WebView often fails to hand to the system download manager.
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
        const saved = await Filesystem.writeFile({
          path: fileName,
          data: contents,
          directory: Directory.Documents,
          encoding: Encoding.UTF8,
          recursive: true,
        });
        setDownloadMessage(`Saved on device: ${fileName}`);
        // Offer the saved file to Android's share/save sheet as a convenient second route
        // to Downloads, Drive, email, or another file manager.
        try {
          const { Share } = await import('@capacitor/share');
          await Share.share({
            title: fileName,
            text: 'WyBuild complete build logs',
            url: saved.uri,
            dialogTitle: 'Share or save build logs',
          });
        } catch (shareError) {
          // A dismissed share sheet must not undo the file already saved in Documents.
          console.warn('Log file saved; Android share sheet was unavailable or dismissed.', shareError);
        }
      } else {
        const blob = new Blob([contents], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        a.remove();
        // Delay revocation so Android browsers/WebViews have time to start the download.
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
        setDownloadMessage('Full log download started.');
      }
    } catch (error) {
      console.error('Could not download build logs:', error);
      setDownloadMessage(error instanceof Error ? `Download failed: ${error.message}` : 'Download failed. Please try again.');
    } finally {
      setDownloading(false);
      window.setTimeout(() => setDownloadMessage(''), 6000);
    }
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

        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {/* Search */}
          <div className="relative">
            <Search className="w-3 h-3 text-slate-500 absolute left-2 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search logs..."
              className="pl-6 pr-2 py-1 bg-slate-950 border border-slate-800 rounded text-[11px] text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-36"
            />
          </div>

          {/* Level Filter */}
          <div className="flex items-center gap-1 text-[11px] bg-slate-950 border border-slate-800 rounded p-0.5 shrink-0 whitespace-nowrap">
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
            className={`p-1.5 rounded text-xs transition cursor-pointer ${autoScroll ? 'text-emerald-400 bg-emerald-950/40' : 'text-slate-500'}`}
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
            onClick={() => void handleDownloadLogs()}
            disabled={downloading}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
            title="Download complete log file"
            aria-label="Download complete build logs"
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {downloadMessage && <div role="status" className="px-3 py-1.5 text-[11px] font-sans text-emerald-300 bg-emerald-950/30 border-b border-slate-800 break-words">{downloadMessage}</div>}

      {/* Terminal Output */}
      <div ref={terminalScrollRef} className="min-h-0 flex-1 p-4 overflow-y-auto overflow-x-hidden overscroll-contain space-y-1 font-mono text-[11px] leading-relaxed text-slate-300 select-text" style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
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
                    ? 'text-emerald-300'
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
