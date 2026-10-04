import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { BuildRecord } from '../../types';
import { Copy, Link2, Loader2, ShieldCheck } from 'lucide-react';

/** Shown under a finished TWA build: signing fingerprint + a live check of /.well-known/assetlinks.json */
export const TwaBuildPanel: React.FC<{ build: BuildRecord }> = ({ build }) => {
  const { projects, showToast } = useApp();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ published: boolean; fingerprintMatches: boolean | null } | null>(null);

  const proj = projects.find((p) => p.id === build.projectId && p.twa);
  const pkg = build.twa?.packageId;
  const fp = build.twa?.fingerprint;
  if (build.kind !== 'twa' || !pkg) return null;

  const check = async () => {
    if (!proj?.twa) return;
    setBusy(true);
    try {
      setResult(await api.twaAssetlinks(proj.twa.webUrl, pkg, fp));
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Check failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <ShieldCheck className="w-4 h-4 text-emerald-400" />
        <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400">TWA signing &amp; Digital Asset Links</h3>
      </div>
      <p className="text-slate-400">
        Package <span className="font-mono text-slate-200">{pkg}</span>. Publish the <span className="font-mono">assetlinks.json</span> from the build artifact at{' '}
        <span className="font-mono text-slate-200">/.well-known/assetlinks.json</span> on your site, otherwise Android shows a browser address bar inside the app.
      </p>
      {fp ? (
        <div className="flex items-center justify-between gap-2 p-2.5 rounded bg-slate-900 border border-slate-800">
          <span className="font-mono text-[11px] text-slate-300 break-all">SHA-256: {fp}</span>
          <button
            onClick={() => {
              navigator.clipboard.writeText(fp);
              showToast('Fingerprint copied.');
            }}
            className="text-emerald-400 hover:text-emerald-300 shrink-0 cursor-pointer"
            title="Copy"
          >
            <Copy className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <p className="text-slate-500">Fingerprint appears here once the verification step has run.</p>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={check}
          disabled={busy || !proj?.twa}
          className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Link2 className="w-3.5 h-3.5" />}
          Check live site
        </button>
        {result && (
          <span className={result.published && result.fingerprintMatches !== false ? 'text-emerald-400' : 'text-amber-400'}>
            {!result.published
              ? 'Not published yet: the live site does not list this package.'
              : result.fingerprintMatches === false
              ? 'Package is listed, but with a different signing fingerprint.'
              : 'Verified: the site authorises this app.'}
          </span>
        )}
        {!proj?.twa && <span className="text-slate-500">Save this app as a project to enable the live check.</span>}
      </div>
    </div>
  );
};
