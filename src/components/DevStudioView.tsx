import React, { useCallback, useEffect, useState } from 'react';
import { Cloud, RefreshCw, Folder, ShieldCheck, AlertTriangle, CheckCircle2, RotateCcw, HardDrive } from 'lucide-react';
import { useApp } from '../context/AppContext';

const CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_DRIVE_CLIENT_ID as string | undefined;
const SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_TIMEOUT_MS = 20_000;
const HISTORY_FILE_NAME = 'wybuild-history.json';
type DriveFile = { id: string; name: string; mimeType?: string };
type DriveHistory = { schema: 1; updatedAt: string; owner: string; builds: unknown[]; projects: unknown[] };

function loadGIS(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.google?.accounts?.oauth2) return resolve(w.google.accounts.oauth2);
    const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]');
    if (existing) { existing.addEventListener('load', () => resolve(w.google.accounts.oauth2), { once: true }); existing.addEventListener('error', () => reject(new Error('Google sign-in library could not load.')), { once: true }); return; }
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.defer = true; script.dataset.googleIdentity = 'true';
    script.onload = () => w.google?.accounts?.oauth2 ? resolve(w.google.accounts.oauth2) : reject(new Error('Google authorization is unavailable.'));
    script.onerror = () => reject(new Error('Could not load Google authorization. Check your connection.'));
    document.head.appendChild(script);
  });
}

async function driveRequest(token: string, url: string, init: RequestInit = {}) {
  if (!token) throw new Error('Google Drive is not connected. Connect Drive and retry.');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), DRIVE_TIMEOUT_MS);
  let response: Response;
  const headers = { Authorization: `Bearer ${token}`, ...(init.body && typeof init.body === 'string' && !String(init.headers && (init.headers as any)['Content-Type'] || '').includes('multipart/related') ? { 'Content-Type': 'application/json' } : {}), ...init.headers };
  try {
    const safeToRetry = !init.method || init.method.toUpperCase() === 'GET';
    for (let attempt = 0; ; attempt++) {
      response = await fetch(url, { ...init, signal: init.signal || controller.signal, headers });
      if (!safeToRetry || ![429, 500, 502, 503, 504].includes(response.status) || attempt >= 2) break;
      const retryAfter = Number(response.headers.get('Retry-After') || 0);
      await new Promise(resolve => window.setTimeout(resolve, Math.min(2500, retryAfter > 0 ? retryAfter * 1000 : 300 * (2 ** attempt))));
    }
  }
  catch (error) { if ((error as any)?.name === 'AbortError') throw new Error('Google Drive request timed out. Your local data is unchanged; check your connection and retry.'); throw new Error('Could not reach Google Drive. Check your connection and retry.'); }
  finally { window.clearTimeout(timeout); }
  if (!response.ok) {
    let detail = ''; try { detail = (await response.json())?.error?.message || ''; } catch {}
    if (response.status === 401) throw new Error('Google Drive authorization expired. Connect Drive again.');
    if (response.status === 403 && /storage quota|quota exceeded|user rate limit exceeded|rate limit/i.test(detail)) throw new Error('Google Drive storage or API quota was reached. Your local changes are preserved; wait and retry, free space, or choose another accessible folder.');
    if (response.status === 429) throw new Error('Google Drive is rate-limiting requests. Wait a moment and retry.');
    throw new Error(detail || `Google Drive request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DRIVE_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: init.signal || controller.signal });
  } catch (error) {
    if ((error as any)?.name === 'AbortError') throw new Error('Google Drive request timed out. Local data remains unchanged; check your connection and retry.');
    throw new Error('Could not reach Google Drive. Check your connection and retry.');
  } finally { window.clearTimeout(timer); }
}

export const DevStudioView: React.FC = () => {
  const { user, builds, projects, showToast } = useApp();
  const storageKey = `wybuild_drive_settings:${(user?.login || 'anonymous').toLowerCase()}`;
  const [token, setToken] = useState('');
  const [tokenExpiresAt, setTokenExpiresAt] = useState(0);
  const [folderId, setFolderId] = useState(() => { try { return localStorage.getItem(storageKey) || ''; } catch { return ''; } });
  const [draftFolderId, setDraftFolderId] = useState(folderId);
  const [status, setStatus] = useState('Drive is not connected in this session.');
  const [busy, setBusy] = useState(false);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState('');
  const [error, setError] = useState('');
  const [driveReady, setDriveReady] = useState(false);
  const [fileId, setFileId] = useState('');

  useEffect(() => { try { localStorage.setItem(storageKey, folderId); } catch {} }, [folderId, storageKey]);
  const connect = useCallback(async () => {
    setError('');
    if (!CLIENT_ID) { setError('Google Drive is not configured yet. Set VITE_GOOGLE_DRIVE_CLIENT_ID in Vercel and authorize your deployed origin in Google Cloud Console.'); return; }
    try {
      const oauth = await loadGIS();
      const client = oauth.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: (response: any) => {
        if (response?.error || !response?.access_token) { setError(response?.error_description || response?.error || 'Google Drive authorization was cancelled.'); setBusy(false); return; }
        setToken(response.access_token); setTokenExpiresAt(Date.now() + Math.max(60, Number(response.expires_in || 3600) - 60) * 1000); setDriveReady(true); setStatus('Google Drive connected for this session.'); setBusy(false); showToast('Google Drive connected');
      } });
      setBusy(true); client.requestAccessToken({ prompt: token ? '' : 'consent' });
    } catch (e) { setBusy(false); setError(e instanceof Error ? e.message : 'Could not connect Google Drive.'); }
  }, [showToast, token]);

  const chooseFolder = async () => {
    if (busy) return;
    setError(''); const id = draftFolderId.trim();
    if (!token) { setError('Connect Google Drive before validating a folder.'); return; }
    if (!id) { setError('Enter a Google Drive folder ID.'); return; }
    if (id === folderId) { setStatus('This folder is already the active destination.'); return; }
    setBusy(true);
    try {
      const folder = await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,mimeType,capabilities(canAddChildren,canEdit)`);
      if (folder.mimeType !== 'application/vnd.google-apps.folder') throw new Error('That ID is not a Google Drive folder.');
      if (folder.capabilities?.canAddChildren === false || folder.capabilities?.canEdit === false) throw new Error('This folder is readable but not writable by the connected Google account. Choose a folder where you can add files.');
      // Probe actual write permission using a temporary marker, then remove it before activating the destination.
      const marker = await driveRequest(token, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', body: JSON.stringify({ name: `.wybuild-write-probe-${Date.now()}.tmp`, mimeType: 'text/plain', parents: [id] }) });
      if (!marker?.id) throw new Error('Drive did not confirm write access. The active folder was not changed.');
      await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(marker.id)}`, { method: 'DELETE' });
      setFolderId(id); setDraftFolderId(id); setStatus(`Storage destination validated for reading and writing: ${folder.name}. Previous-folder data was preserved; only this folder is active now.`); setFileId(''); setHistoryCount(null); setLastSync('');
      showToast('Drive folder validated and selected');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not validate folder access.'); }
    finally { setBusy(false); }
  };

  const findHistoryFile = async (): Promise<DriveFile | null> => {
    if (!folderId) throw new Error('Choose a Drive folder first.');
    if (!token || (tokenExpiresAt && Date.now() >= tokenExpiresAt)) throw new Error('Google Drive authorization expired. Reconnect Drive and retry.');
    const escapedFolder = folderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const q = encodeURIComponent(`'${escapedFolder}' in parents and name = '${HISTORY_FILE_NAME}' and trashed = false`);
    const data = await driveRequest(token, `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&fields=files(id,name,mimeType,modifiedTime,version)&pageSize=100`);
    const files = Array.isArray(data.files) ? data.files as DriveFile[] : [];
    if (files.some((item) => item.mimeType !== 'application/json' && item.mimeType !== 'text/plain')) throw new Error('A file named wybuild-history.json exists but is not a supported JSON file. Rename it or repair it before syncing.');
    if (files.length > 1) throw new Error('Multiple wybuild-history.json files were found in this folder. To avoid overwriting the wrong history, remove or rename duplicates and retry.');
    const found = files[0];
    if (found) setFileId(found.id);
    return found || null;
  };

  const readHistory = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!token || !folderId) throw new Error('Connect Google Drive and select a storage folder first.');
      const file = await findHistoryFile();
      if (!file) { setHistoryCount(0); setStatus('No saved history file found in this folder yet.'); setLastSync(''); return; }
      const data = await driveRequest(token, `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`);
      const history = typeof data === 'string' ? JSON.parse(data) : data as DriveHistory;
      if (!history || typeof history !== 'object' || !Array.isArray((history as any).builds) || !Array.isArray((history as any).projects) || Number((history as any).schema) !== 1) throw new Error('The Drive history file has an unsupported or invalid format. It was not changed.');
      const count = history.builds.length;
      setHistoryCount(count); setLastSync((history as any)?.updatedAt || ''); setStatus(`Read ${count} build history records directly from Google Drive.`);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not read Drive history.'); }
    finally { setBusy(false); }
  };

  const syncHistory = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      if (!token || !folderId) throw new Error('Connect Google Drive and select a storage folder first.');
      // Read the current Drive file first and merge by stable ID. Never replace older records just because
      // the current device has a shorter local history. Sensitive credentials and billing data are excluded.
      const file = await findHistoryFile();
      let existing: any = { schema: 1, builds: [], projects: [] };
      if (file) {
        const response = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
        if (!response.ok) throw new Error(response.status === 401 ? 'Google Drive authorization expired. Reconnect Drive.' : `Could not read existing history before merging (${response.status}). Nothing was overwritten.`);
        try { existing = await response.json(); } catch { throw new Error('The existing Drive history file is not valid JSON. It was left untouched; export or repair it before syncing.'); }
        if (!existing || Number(existing.schema) !== 1 || !Array.isArray(existing.builds) || !Array.isArray(existing.projects)) throw new Error('The existing Drive history has an unsupported format. It was left untouched.');
        if (existing.builds.length > 10000 || existing.projects.length > 5000) throw new Error('The existing Drive history is too large to safely merge in one browser operation. It was left untouched.');
      }
      if (!Array.isArray(builds) || !Array.isArray(projects)) throw new Error('Local build or project data is unavailable. Nothing was uploaded.');
      const safeBuild = (b: any) => ({ id: b.id, projectId: b.projectId, projectName: b.projectName, repo: b.repo, runId: b.runId, name: b.name, branch: b.branch, commitHash: b.commitHash, commitMessage: b.commitMessage, author: b.author, status: b.status, conclusion: b.conclusion, startedAt: b.startedAt, finishedAt: b.finishedAt, createdAt: b.createdAt, updatedAt: b.updatedAt, durationSeconds: b.durationSeconds, target: b.target, mode: b.mode, htmlUrl: b.htmlUrl, kind: b.kind, twa: b.twa ? { packageId: b.twa.packageId, output: b.twa.output, versionName: b.twa.versionName } : undefined });
      const safeProject = (p: any) => ({ id: p.id, name: p.name, repoUrl: p.repoUrl, branch: p.branch, createdAt: p.createdAt, updatedAt: p.updatedAt, buildCount: p.buildCount });
      const merge = (oldItems: any[], newItems: any[], safe: (x: any) => any) => {
        const byId = new Map<string, any>();
        for (const item of oldItems) if (item?.id) byId.set(String(item.id), safe(item));
        for (const item of newItems) if (item?.id) {
          const prior = byId.get(String(item.id));
          const cleaned = safe(item);
          byId.set(String(item.id), prior ? { ...prior, ...Object.fromEntries(Object.entries(cleaned).filter(([,v]) => v !== undefined && v !== null && v !== '')) } : cleaned);
        }
        return [...byId.values()];
      };
      const payload: DriveHistory = { schema: 1, updatedAt: new Date().toISOString(), owner: user?.login || existing.owner || '', builds: merge(existing.builds, builds as any[], safeBuild), projects: merge(existing.projects, projects as any[], safeProject) };
      if (payload.builds.length > 10000 || payload.projects.length > 5000) throw new Error('History is unusually large. Sync was stopped to avoid excessive requests or browser memory usage. Export or archive old records first.');
      const json = JSON.stringify(payload);
      let response: Response;
      if (file) {
        response = await fetchWithTimeout(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(file.id)}?uploadType=media`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: json });
      } else {
        const boundary = `wybuild_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: 'wybuild-history.json', mimeType: 'application/json', parents: [folderId] })}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${json}\r\n--${boundary}--`;
        response = await fetchWithTimeout('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
      }
      if (!response.ok) {
        let detail = ''; try { detail = (await response.json())?.error?.message || ''; } catch {}
        if (response.status === 401) throw new Error('Google Drive authorization expired. Reconnect Drive.');
        if (response.status === 429) throw new Error('Google Drive is rate-limiting requests. Wait and retry; the existing history was read before this update.');
        if (response.status === 403) throw new Error(detail || 'Drive permission, storage, or API quota blocked this sync. Your local source data remains unchanged.');
        throw new Error(detail || `Drive sync failed (${response.status}).`);
      }
      const saved = await response.json().catch(() => ({})); if (saved.id) setFileId(saved.id);
      setHistoryCount(payload.builds.length); setLastSync(payload.updatedAt); setStatus(`Merged and synced ${payload.builds.length} build records and ${payload.projects.length} project summaries. Older Drive records were preserved.`); showToast('History merged and synchronized to your Drive');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not synchronize history.'); }
    finally { setBusy(false); }
  };

  const rotateFolder = () => { if (busy) return; setDraftFolderId(''); setError('Enter the new folder ID and choose Validate & select folder. The current destination remains active until the new folder passes read/write validation and you confirm the switch. No data is deleted from the old folder.'); };
  return <div className="mx-auto w-full max-w-5xl p-4 sm:p-6 space-y-5">
    <div><div className="flex items-center gap-2 text-emerald-300"><HardDrive className="w-5 h-5"/><span className="text-xs font-semibold uppercase tracking-widest">Developer workspace</span></div><h1 className="mt-2 text-2xl font-bold text-white">Dev Studio</h1><p className="mt-1 max-w-2xl text-sm text-slate-400">Own your project history and configuration snapshots. WyBuild reads and writes this history directly to your Google Drive; it is not uploaded to WyBuild's application server.</p></div>
    {!CLIENT_ID && <div className="flex gap-3 rounded-xl border border-amber-400/20 bg-amber-400/[.06] p-4 text-sm text-amber-100"><AlertTriangle className="w-5 h-5 shrink-0"/><div><b>Drive connection needs configuration</b><p className="mt-1 text-amber-100/70">Set <code>VITE_GOOGLE_DRIVE_CLIENT_ID</code> in Vercel and add your production origin to the OAuth client's authorized JavaScript origins.</p></div></div>}
    <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5 space-y-4"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold text-white">Google Drive ownership</h2><p className="text-xs text-slate-400 mt-1">{driveReady && tokenExpiresAt > Date.now() ? 'Connected for this browser session' : 'Not connected or authorization expired; reconnect to continue.'}</p></div><button disabled={busy} onClick={() => void connect()} className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"><Cloud className="inline w-4 h-4 mr-2"/>{driveReady ? 'Reconnect Drive' : 'Connect Drive'}</button></div>
    <label className="block text-xs text-slate-400">Google Drive folder ID<input value={draftFolderId} onChange={e=>setDraftFolderId(e.target.value)} placeholder="Paste the folder ID from its Drive URL" className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-3 text-sm text-white outline-none focus:border-emerald-300/40"/></label><div className="flex flex-wrap gap-2"><button disabled={busy||!token} onClick={()=>void chooseFolder()} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"><Folder className="inline w-4 h-4 mr-2"/>Validate & select folder</button><button onClick={rotateFolder} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200"><RotateCcw className="inline w-4 h-4 mr-2"/>Rotate folder</button></div><p className="text-xs text-slate-500">The selected folder ID is locked as the active destination until a validated rotation is confirmed. Folder IDs are identifiers, not secrets; access is enforced by Google permissions.</p></section>
    <section className="rounded-2xl border border-white/10 bg-white/[.025] p-4 sm:p-5"><div className="flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-300"/><h2 className="font-semibold text-white">Build history stored in your Drive</h2></div><p className="mt-2 text-sm text-slate-400">History is read from <code>wybuild-history.json</code> in the selected folder. Sync writes only build/project summaries; payment details, credit balances, access tokens, keystores and signing secrets are excluded.</p><div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3"><div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-slate-500">Drive history records</div><div className="mt-1 text-xl font-semibold text-white">{historyCount === null ? '—' : historyCount}</div></div><div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-slate-500">Local build list</div><div className="mt-1 text-xl font-semibold text-white">{builds.length}</div></div><div className="rounded-xl bg-black/20 p-3"><div className="text-xs text-slate-500">Last Drive sync</div><div className="mt-1 text-sm font-semibold text-white">{lastSync ? new Date(lastSync).toLocaleString() : 'Not synced'}</div></div></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={busy||!token||!folderId} onClick={()=>void readHistory()} className="rounded-lg border border-white/10 px-3 py-2 text-sm text-slate-200 disabled:opacity-40"><RefreshCw className="inline w-4 h-4 mr-2"/>Read from Drive</button><button disabled={busy||!token||!folderId} onClick={()=>void syncHistory()} className="rounded-lg bg-emerald-300 px-3 py-2 text-sm font-semibold text-slate-950 disabled:opacity-40">{busy?'Working…':'Sync history to Drive'}</button></div><div className="mt-3 flex items-start gap-2 text-xs text-slate-500"><CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-300"/><span>{status}</span></div>{error&&<div role="alert" className="mt-3 rounded-lg border border-rose-400/20 bg-rose-400/[.06] p-3 text-sm text-rose-200">{error}</div>}</section>
    <p className="text-xs text-slate-500">Google Drive sync is user-owned storage, not a replacement for GitHub's live run records or Supabase's authoritative billing and credit ledger. Keep local changes until Drive confirms a successful write.</p>
  </div>;
};
