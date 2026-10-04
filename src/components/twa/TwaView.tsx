import React, { useMemo, useState } from 'react';
import { takePendingTwaRepo } from '../../services/handoff';
import { useApp } from '../../context/AppContext';
import { api, repoFromUrl, RepoInspection, TwaInspection } from '../../services/api';
import { Project, TwaConfig } from '../../types';
import { AlertTriangle, Check, CheckCircle2, Globe2, Loader2, Package, Play, RefreshCw, Search, Smartphone, Wrench, XCircle } from 'lucide-react';

const EMPTY: TwaConfig = {
  webUrl: '', packageId: '', name: '', launcherName: '', versionName: '1.0.0', versionCode: undefined,
  themeColor: '#0f172a', backgroundColor: '#ffffff', startUrl: '/', iconUrl: '', maskableIconUrl: '', monochromeIconUrl: '',
  display: 'standalone', orientation: 'default', fallbackType: 'customtabs', enableNotifications: false,
  enableSiteSettingsShortcut: true, locationDelegation: false, playBilling: false, additionalTrustedOrigins: [],
  androidPermissions: [], shortcuts: [], minSdkVersion: 21, expectedFingerprint: '', output: 'both', storeReady: true, useKeystore: true,
};

const FEATURES = [
  { id: 'notifications', label: 'Notifications', hint: 'Web push notifications through Android', permission: 'POST_NOTIFICATIONS' },
  { id: 'location', label: 'Location', hint: 'Use Android location permission for the site', permission: 'ACCESS_FINE_LOCATION' },
  { id: 'camera', label: 'Camera', hint: 'Allow the site to request the camera', permission: 'CAMERA' },
  { id: 'microphone', label: 'Microphone', hint: 'Allow the site to request the microphone', permission: 'RECORD_AUDIO' },
  { id: 'vibration', label: 'Vibration', hint: 'Allow vibration from supported web APIs', permission: 'VIBRATE' },
] as const;

const input = 'w-full h-11 bg-[#050707] border border-white/[.08] rounded-lg px-3 text-white focus:border-emerald-400/50 focus:outline-none';
const card = 'rounded-2xl bg-[#070a09] border border-white/[.06] p-4 sm:p-5';

function featureState(cfg: TwaConfig, id: string) {
  if (id === 'notifications') return cfg.enableNotifications;
  if (id === 'location') return cfg.locationDelegation;
  return cfg.androidPermissions.includes(FEATURES.find(f => f.id === id)?.permission || '');
}

export const TwaView: React.FC = () => {
  const { projects, builds, repos, keystores, addProject, updateProject, setCurrentTab, subscription } = useApp();
  const saved = projects.filter(p => p.kind === 'twa' && p.twa);
  const [cfg, setCfg] = useState<TwaConfig>(EMPTY);
  const [repo, setRepo] = useState(() => takePendingTwaRepo());
  const [inspection, setInspection] = useState<TwaInspection | null>(null);
  const [repoInspection, setRepoInspection] = useState<RepoInspection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusText, setStatusText] = useState('');

  const hasKeystore = !!repo && keystores.some(k => k.repo === repo);
  const latestBuild = useMemo(() => [...builds].filter(b => b.kind === 'twa' && b.repo === repo).sort((a,b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0], [builds, repo]);
  const savedProject = editingId ? projects.find(p => p.id === editingId) : undefined;
  const settingsChanged = !!savedProject?.twa && JSON.stringify({ ...savedProject.twa, fallbackType: 'customtabs' }) !== JSON.stringify({ ...cfg, fallbackType: 'customtabs' });
  const sourceChanged = !!latestBuild?.commitHash && !!repoInspection?.latestCommitSha && !repoInspection.latestCommitSha.startsWith(latestBuild.commitHash);
  const buildCurrent = !!latestBuild && latestBuild.status === 'success' && !settingsChanged && !sourceChanged;


  const set = <K extends keyof TwaConfig>(key: K, value: TwaConfig[K]) => setCfg(c => ({ ...c, [key]: value }));

  const loadProject = (p: Project) => {
    if (!p.twa) return;
    setCfg({ ...EMPTY, ...p.twa, fallbackType: 'customtabs' });
    setRepo(repoFromUrl(p.repoUrl) || '');
    setEditingId(p.id);
    setInspection(null);
    setRepoInspection(null);
    setError('');
  };

  const discover = async () => {
    const r = repoFromUrl(repo);
    if (!r) return setError('Choose a GitHub repository first.');
    setBusy(true); setError('');
    try {
      const [ri, wi] = await Promise.all([api.inspectRepo(r, 'twa'), cfg.webUrl ? api.twaInspect(cfg.webUrl) : Promise.resolve(null)]);
      setRepoInspection(ri);
      if (wi) applyInspection(wi);
      setRepo(r);
    } catch (e: any) { setError(e?.message || 'Could not inspect the repository.'); }
    finally { setBusy(false); }
  };

  const inspectWeb = async () => {
    if (!cfg.webUrl) return setError('Paste the web app address first.');
    setBusy(true); setError('');
    try { applyInspection(await api.twaInspect(cfg.webUrl)); }
    catch (e: any) { setError(e?.message || 'Could not inspect the web app.'); }
    finally { setBusy(false); }
  };

  const applyInspection = (r: TwaInspection) => {
    setInspection(r);
    setCfg(c => ({ ...c, ...Object.fromEntries(Object.entries(r.detected).filter(([, v]) => v !== undefined && v !== '')), fallbackType: 'customtabs' } as TwaConfig));
  };

  const toggleFeature = (id: string) => {
    const on = !featureState(cfg, id);
    if (id === 'notifications') return set('enableNotifications', on);
    if (id === 'location') return set('locationDelegation', on);
    const permission = FEATURES.find(f => f.id === id)?.permission;
    if (!permission) return;
    set('androidPermissions', on ? [...cfg.androidPermissions, permission] : cfg.androidPermissions.filter(p => p !== permission));
  };

  const refreshStatus = async () => {
    if (!repo) return setError('Choose a repository first.');
    setStatusBusy(true); setError('');
    try {
      const r = await api.inspectRepo(repo, 'twa');
      setRepoInspection(r);
      const workflow = r.workflowUpToDate ? 'workflow current' : 'workflow update needed';
      setStatusText(`${workflow} · latest repo commit ${r.latestCommitSha?.slice(0, 7) || 'unknown'}`);
    } catch (e: any) { setError(e?.message || 'Could not refresh build status.'); }
    finally { setStatusBusy(false); }
  };

  const build = async () => {
    setError('');
    const r = repoFromUrl(repo);
    if (!r) return setError('Choose the GitHub repository for this Android build.');
    if (!cfg.webUrl.startsWith('https://')) return setError('Your web app must use HTTPS.');
    if (!cfg.packageId) return setError('Package ID could not be generated. Inspect the web app again.');
    if (!hasKeystore) return setError('Add a release keystore before building a store-ready APK.');
    setBusy(true);
    try {
      const ri = repoInspection || await api.inspectRepo(r, 'twa');
      setRepoInspection(ri);
      if (!ri.workflowUpToDate) await api.installWorkflow(r, ri.defaultBranch, 'twa');
      const branch = ri.defaultBranch;
      const project = { name: cfg.name || new URL(cfg.webUrl).hostname, description: 'Trusted Web Activity build', repoUrl: `https://github.com/${r}`, branch, kind: 'twa' as const, twa: { ...cfg, fallbackType: 'customtabs', useKeystore: true, storeReady: true }, config: { target: 'apk' as const, mode: 'release' as const, flutterVersion: 'stable', dartDefines: [], obfuscate: false, splitDebugInfo: false, runTests: false, customArgs: '' } };
      let id = editingId;
      if (id) updateProject(id, project);
      else { const res = addProject(project); if (!res.success || !res.id) throw new Error(res.error || 'Could not save the project.'); id = res.id; setEditingId(id); }
      await api.twaBuild(r, branch, project.twa!);
      setCurrentTab('builds');
    } catch (e: any) { setError(e?.message || 'Build could not be started.'); }
    finally { setBusy(false); }
  };

  const reset = () => { setCfg(EMPTY); setRepo(''); setInspection(null); setRepoInspection(null); setEditingId(null); setError(''); setStatusText(''); };

  return <div className="max-w-4xl mx-auto p-3 sm:p-6 space-y-4 text-xs">
    <header>
      <div className="flex items-center gap-2"><Smartphone className="w-5 h-5 text-emerald-300"/><h1 className="text-xl font-bold text-white">Web → Android</h1></div>
      <p className="text-slate-500 mt-1">Paste your web app and pick the Android features you want. WyBuild does the rest.</p>
    </header>

    {saved.length > 0 && <div className="flex gap-2 overflow-x-auto pb-1">{saved.map(p => <button key={p.id} onClick={() => loadProject(p)} className={`px-3 py-2 rounded-lg border whitespace-nowrap ${editingId === p.id ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-white/[.07] text-slate-400'}`}>{p.name}</button>)}<button onClick={reset} className="px-3 py-2 text-slate-500">+ New</button></div>}

    <section className={card}>
      <div className="flex items-center gap-2 text-white font-semibold"><Globe2 className="w-4 h-4 text-emerald-300"/>Web app</div>
      <div className="flex gap-2 mt-3"><input className={input} placeholder="https://yourapp.com" value={cfg.webUrl} onChange={e => set('webUrl', e.target.value)}/><button onClick={inspectWeb} disabled={busy || !cfg.webUrl} className="h-11 px-4 rounded-lg bg-emerald-400 text-black font-bold flex items-center gap-1.5 disabled:opacity-40">{busy ? <Loader2 className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4"/>}Discover</button></div>
      {inspection && <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">{inspection.checks.map(c => <div key={c.id} className={`rounded-lg px-3 py-2 border ${c.level === 'error' ? 'border-rose-500/20 text-rose-300' : c.level === 'warn' ? 'border-amber-500/20 text-amber-200' : 'border-emerald-400/15 text-emerald-200'}`}><div className="flex gap-2 items-center">{c.level === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5"/> : <AlertTriangle className="w-3.5 h-3.5"/>}{c.msg}</div></div>)}</div>}
    </section>

    <section className={card}>
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-white font-semibold"><Package className="w-4 h-4 text-emerald-300"/>Automatic app identity</div><span className="text-[10px] text-emerald-300">PACKAGE ID IS FREE</span></div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <div><label className="text-slate-500">App name</label><input className={input} value={cfg.name} onChange={e => set('name', e.target.value)} placeholder="Detected automatically"/></div>
        <div><label className="text-slate-500">Package ID</label><input className={`${input} font-mono text-emerald-200`} value={cfg.packageId} readOnly placeholder="Generated from your domain"/></div>
        <div><label className="text-slate-500">Version</label><input className={input} value={cfg.versionName} onChange={e => set('versionName', e.target.value)}/></div>
        <div><label className="text-slate-500">Icon</label><input className={input} value={cfg.iconUrl} onChange={e => set('iconUrl', e.target.value)} placeholder="Detected from manifest"/></div>
      </div>
      <p className="text-slate-600 mt-2">The package ID is generated from the domain and reused on future builds so updates keep the same Android identity.</p>
    </section>

    <section className={card}>
      <div className="flex items-center gap-2 text-white font-semibold"><Wrench className="w-4 h-4 text-emerald-300"/>Native features</div>
      <p className="text-slate-500 mt-1">Tick only what your website needs. WyBuild adds the required Android permissions/configuration.</p>
      <div className="grid sm:grid-cols-2 gap-2 mt-3">{FEATURES.map(f => { const checked = featureState(cfg, f.id); return <button key={f.id} type="button" onClick={() => toggleFeature(f.id)} className={`text-left rounded-xl border p-3 flex gap-3 ${checked ? 'border-emerald-400/30 bg-emerald-400/[.06]' : 'border-white/[.06] bg-black/20'}`}><span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-emerald-400 border-emerald-400 text-black' : 'border-slate-600'}`}>{checked && <Check className="w-3.5 h-3.5"/>}</span><span><b className="text-slate-200 block">{f.label}</b><span className="text-[11px] text-slate-500">{f.hint}</span></span></button>; })}</div>
    </section>

    <section className={card}>
      <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-white font-semibold"><RefreshCw className="w-4 h-4 text-emerald-300"/>Build status</div><button onClick={refreshStatus} disabled={statusBusy || !repo} className="text-emerald-300 flex items-center gap-1 disabled:opacity-40">{statusBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RefreshCw className="w-3.5 h-3.5"/>}Refresh</button></div>
      <div className="mt-3 flex gap-2"><input className={`${input} font-mono`} list="wb-twa-repos" value={repo} onChange={e => { setRepo(e.target.value); setRepoInspection(null); }} placeholder="Choose your GitHub repo"/><button onClick={discover} disabled={busy || !repo} className="h-11 px-4 rounded-lg border border-emerald-400/20 text-emerald-200 font-semibold disabled:opacity-40">Discover repo</button></div>
      <datalist id="wb-twa-repos">{repos.filter(r => r.canPush).map(r => <option key={r.fullName} value={r.fullName}/>)}</datalist>
      {repoInspection && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3"><div className="p-2 rounded-lg bg-black/20"><span className="text-slate-600">Branch</span><b className="block text-white font-mono">{repoInspection.defaultBranch}</b></div><div className="p-2 rounded-lg bg-black/20"><span className="text-slate-600">Commit</span><b className="block text-white font-mono">{repoInspection.latestCommitSha?.slice(0,7) || '—'}</b></div><div className="p-2 rounded-lg bg-black/20"><span className="text-slate-600">Workflow</span><b className={`block ${repoInspection.workflowUpToDate ? 'text-emerald-300' : 'text-amber-300'}`}>{repoInspection.workflowUpToDate ? 'Current' : 'Will update'}</b></div><div className="p-2 rounded-lg bg-black/20"><span className="text-slate-600">Signing</span><b className={`block ${hasKeystore ? 'text-emerald-300' : 'text-amber-300'}`}>{hasKeystore ? 'Ready' : 'Keystore needed'}</b></div></div>}
      {repoInspection && <div className="mt-3 flex flex-wrap gap-2"><span className={`px-2.5 py-1 rounded-full border ${repoInspection.workflowUpToDate ? 'border-emerald-400/20 text-emerald-300' : 'border-amber-400/20 text-amber-300'}`}>{repoInspection.workflowUpToDate ? 'Workflow current' : 'Workflow outdated'}</span><span className={`px-2.5 py-1 rounded-full border ${sourceChanged ? 'border-amber-400/20 text-amber-300' : 'border-emerald-400/20 text-emerald-300'}`}>{sourceChanged ? 'APK outdated: repo changed' : 'Repo build source current'}</span><span className={`px-2.5 py-1 rounded-full border ${settingsChanged ? 'border-amber-400/20 text-amber-300' : 'border-emerald-400/20 text-emerald-300'}`}>{settingsChanged ? 'APK outdated: settings changed' : 'Build settings current'}</span><span className={`px-2.5 py-1 rounded-full border ${buildCurrent ? 'border-emerald-400/20 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>{buildCurrent ? 'APK current' : 'Build required'}</span></div>}
      {repoInspection && <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-2"><div className="p-2.5 rounded-lg bg-black/20 border border-white/[.04]"><span className="text-slate-600">APK</span><b className={`block ${buildCurrent ? 'text-emerald-300' : 'text-amber-300'}`}>{latestBuild?.status === 'success' && latestBuild.twa?.output !== 'aab' ? (buildCurrent ? 'Current' : 'Outdated') : 'Not built'}</b></div><div className="p-2.5 rounded-lg bg-black/20 border border-white/[.04]"><span className="text-slate-600">AAB</span><b className={`block ${buildCurrent ? 'text-emerald-300' : 'text-amber-300'}`}>{latestBuild?.status === 'success' && latestBuild.twa?.output !== 'apk' ? (buildCurrent ? 'Current' : 'Outdated') : 'Not built'}</b></div><div className="p-2.5 rounded-lg bg-black/20 border border-white/[.04]"><span className="text-slate-600">Asset links</span><b className={`block ${buildCurrent ? 'text-emerald-300' : 'text-amber-300'}`}>{latestBuild?.artifacts.some(a => a.name.includes('assetlinks')) ? (buildCurrent ? 'Current' : 'Outdated') : (latestBuild?.status === 'success' ? 'Generated in report' : 'Not built')}</b></div></div>}
      {statusText && <p className="mt-2 text-slate-500">{statusText}</p>}
    </section>

    <section className={card}>
      <div className="flex items-center justify-between"><div><div className="text-white font-semibold">Pro automation</div><p className="text-slate-500 mt-1">Automatic rebuilds and other repo-change automation stay behind Pro. Manual builds remain available here.</p></div><span className="text-[10px] px-2 py-1 rounded bg-emerald-400/10 text-emerald-300">PRO</span></div>
      {subscription.plan !== 'pro' && <button onClick={() => setCurrentTab('billing')} className="mt-2 text-emerald-300 underline">View Pro</button>}
    </section>

    {error && <div className="p-3 rounded-xl border border-rose-500/20 bg-rose-500/[.05] text-rose-300 flex gap-2"><XCircle className="w-4 h-4 shrink-0"/>{error}</div>}
    <div className="flex justify-end gap-2 pb-4"><button onClick={() => setCurrentTab('settings')} className="px-4 h-11 rounded-lg border border-white/[.07] text-slate-300">Keystore</button><button onClick={build} disabled={busy || !repo || !cfg.packageId || !hasKeystore} className="px-5 h-11 rounded-lg bg-emerald-400 text-black font-bold flex items-center gap-2 disabled:opacity-40">{busy ? <Loader2 className="w-4 h-4 animate-spin"/> : <Play className="w-4 h-4 fill-current"/>}Build TWA APK</button></div>
  </div>;
};
