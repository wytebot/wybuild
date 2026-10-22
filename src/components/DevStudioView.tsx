import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Folder, ShieldCheck, CheckCircle2, RotateCcw, HardDrive, Save, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';

type DriveConfig = { configured: boolean; folderId: string; updatedAt?: string; serviceEmail?: string; serviceAccountConfigured?: boolean };
type DriveHistory = { found: boolean; fileId?: string; builds: unknown[]; projects: unknown[]; updatedAt?: string };
async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, { ...init, credentials: 'same-origin', headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || data?.message || `Request failed (${response.status})`);
  return data as T;
}

export const DevStudioView: React.FC = () => {
  const { user, builds, projects, showToast } = useApp();
  const [folderId, setFolderId] = useState('');
  const [draftFolderId, setDraftFolderId] = useState('');
  const [serviceEmail, setServiceEmail] = useState('');
  const [serviceAccountConfigured, setServiceAccountConfigured] = useState(false);
  const [busy, setBusy] = useState(false);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const [projectCount, setProjectCount] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState('');
  const [status, setStatus] = useState('Enter a Drive folder ID to configure your storage destination.');
  const [error, setError] = useState('');

  const loadConfig = useCallback(async () => {
    try {
      const config = await api<DriveConfig>('drive-storage');
      setFolderId(config.folderId || ''); setDraftFolderId(config.folderId || '');
      setServiceEmail(config.serviceEmail || ''); setServiceAccountConfigured(!!config.serviceAccountConfigured);
      if (config.folderId) setStatus(`Saved Drive folder ${config.folderId}. The server-side service account handles access; no user OAuth connection is needed.`);
      else setStatus('No Drive folder is saved yet. Paste a folder ID and save it.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load Drive storage settings.'); }
  }, []);
  useEffect(() => { void loadConfig(); }, [loadConfig]);

  const saveFolder = async (rotate = false) => {
    if (busy) return;
    const id = draftFolderId.trim();
    if (!id) { setError('Enter a Google Drive folder ID.'); return; }
    if (folderId && id !== folderId && !rotate) {
      setError('The saved folder is locked. Use Rotate folder and confirm the change before replacing it.'); return;
    }
    if (folderId && id !== folderId && rotate) {
      const yes = window.confirm('Are you sure you want to rotate WyBuild storage to this new Google Drive folder?\n\nThe new folder must be shared with the WyBuild service-account email. The old folder and its data will not be deleted. Choose OK for YES or Cancel for NO.');
      if (!yes) { setDraftFolderId(folderId); setStatus('Folder rotation cancelled. The existing folder remains active.'); return; }
    }
    setBusy(true); setError('');
    try {
      const result = await api<{ ok: boolean; folderId: string; name?: string; unchanged?: boolean; rotated?: boolean }>('drive-storage/validate', { method: 'POST', body: JSON.stringify({ folderId: id, confirmRotation: !!(rotate && folderId && id !== folderId) }) });
      setFolderId(result.folderId); setDraftFolderId(result.folderId); setHistoryCount(null); setProjectCount(null); setLastSync('');
      setStatus(result.unchanged ? 'This folder is already the saved destination.' : `Folder validated and saved${result.name ? `: ${result.name}` : ''}. Previous-folder data remains untouched.`);
      showToast(result.rotated ? 'Drive storage folder rotated' : 'Drive folder saved');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not validate this folder.'); }
    finally { setBusy(false); }
  };

  const readHistory = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const result = await api<DriveHistory>('drive-storage/history');
      setHistoryCount(result.builds.length); setProjectCount(result.projects.length); setLastSync(result.updatedAt || '');
      setStatus(result.found ? `Read ${result.builds.length} build records and ${result.projects.length} project summaries from the saved Drive folder.` : 'The folder is accessible, but no wybuild-history.json exists yet. Sync to create it.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read Drive history.'); }
    finally { setBusy(false); }
  };

  const syncHistory = async () => {
    if (busy) return; setBusy(true); setError('');
    try {
      const result = await api<{ ok: boolean; buildCount: number; projectCount: number; updatedAt: string }>('drive-storage/history', { method: 'POST', body: JSON.stringify({ builds, projects }) });
      setHistoryCount(result.buildCount); setProjectCount(result.projectCount); setLastSync(result.updatedAt);
      setStatus(`Synced ${result.buildCount} build records and ${result.projectCount} project summaries. Existing records were merged; billing and secrets are excluded.`);
      showToast('Build history synced to Drive');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not sync Drive history.'); }
    finally { setBusy(false); }
  };

  return <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 space-y-5">
    <div><div className="flex items-center gap-2 text-emerald-300"><HardDrive className="w-5 h-5"/><span className="text-xs font-semibold uppercase tracking-widest">Developer workspace</span></div><h1 className="mt-2 text-2xl font-bold text-white">Dev Studio</h1><p className="mt-1 max-w-2xl text-sm text-slate-400">Use your own Google Drive folder for build-history backups. WyBuild uses its existing server-side service account; there is no Connect Drive button or Google OAuth popup.</p></div>
    {!serviceAccountConfigured && <div role="alert" className="flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[.06] p-4 text-sm text-amber-100"><AlertTriangle className="w-5 h-5 shrink-0"/><div><b>Drive service account is not available to this API.</b><p className="mt-1 text-amber-100/70">Configure the existing service-account JSON in the server-side DRIVE_SERVICE_ACCOUNT_JSON environment variable (or supported existing service-account variable) and redeploy.</p></div></div>}
    <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5 space-y-4"><div><h2 className="font-semibold text-white">Drive folder ID</h2><p className="mt-1 text-xs text-slate-400">{folderId ? 'A folder is saved and locked. It can only be changed through the explicit rotation confirmation.' : 'Paste the folder ID from its Google Drive URL. Share the folder with the service-account email below as Editor.'}</p></div>
      {serviceEmail && <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm"><div className="text-xs text-slate-500">Share your Drive folder with this service account</div><code className="mt-1 block break-all text-emerald-200">{serviceEmail}</code><p className="mt-1 text-xs text-slate-500">The folder ID alone does not grant access. Google Drive must grant this account Editor permission.</p></div>}
      <label className="block text-xs text-slate-400">Google Drive folder ID<input value={draftFolderId} onChange={e=>setDraftFolderId(e.target.value)} placeholder="Paste folder ID from the Drive URL" className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none focus:border-emerald-300/40" autoCapitalize="none" autoCorrect="off"/></label>
      <div className="flex flex-wrap gap-2"><button disabled={busy || !serviceAccountConfigured || (!!folderId && draftFolderId.trim() !== folderId)} onClick={()=>void saveFolder(false)} className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40"><Save className="inline w-4 h-4 mr-2"/>{folderId ? 'Saved folder' : 'Validate & save folder'}</button>{folderId && <button disabled={busy || !serviceAccountConfigured || !draftFolderId.trim() || draftFolderId.trim() === folderId} onClick={()=>void saveFolder(true)} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"><RotateCcw className="inline w-4 h-4 mr-2"/>Rotate folder</button>}</div>
      <p className="text-xs text-slate-500">Rotation requires a YES/NO confirmation. The new folder is validated before it becomes active; old Drive data is not deleted. Only the authenticated WyBuild account's folder setting is changed.</p>
    </section>
    <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5"><div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-300"/><h2 className="font-semibold text-white">Build history stored in your Drive</h2></div><p className="mt-2 text-sm text-slate-400">WyBuild reads and writes <code>wybuild-history.json</code> in the saved folder. Only build/project summaries are synced; payment details, credit balances, access tokens, keystores and signing secrets are excluded.</p><div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3"><div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-slate-500">Drive build records</div><div className="mt-1 text-xl font-semibold text-white">{historyCount === null ? '—' : historyCount}</div></div><div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-slate-500">Drive project summaries</div><div className="mt-1 text-xl font-semibold text-white">{projectCount === null ? '—' : projectCount}</div></div><div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-slate-500">Last history update</div><div className="mt-1 text-sm font-semibold text-white">{lastSync ? new Date(lastSync).toLocaleString() : 'Not synced'}</div></div></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={busy || !folderId} onClick={()=>void readHistory()} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"><RefreshCw className="inline w-4 h-4 mr-2"/>Read from Drive</button><button disabled={busy || !folderId} onClick={()=>void syncHistory()} className="rounded-lg bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{busy ? 'Working…' : 'Sync history to Drive'}</button></div><div className="mt-3 flex items-start gap-2 text-xs text-slate-500"><CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-300"/><span>{status}</span></div>{error && <div role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[.06] p-3 text-sm text-rose-200">{error}</div>}</section>
    <p className="text-xs text-slate-500">Drive is user-owned backup storage, not the authoritative source for GitHub live build status, Supabase billing, or the credit ledger. A folder ID is an identifier, not an access credential.</p>
  </div>;
};
