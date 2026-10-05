import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api, ApiError, repoFromUrl, RepoInspection, TwaInspection } from '../../services/api';
import { KeystoreForm } from '../KeystoreForm';
import { LinkMode, LinkRule, Project, TwaConfig } from '../../types';
import { checkLinkRule, LINK_MODES, LINK_PRESETS } from '../../services/links';
import { AlertTriangle, Check, CheckCircle2, Github, Globe2, KeyRound, Link2, Loader2, Package, Play, RefreshCw, Search, Smartphone, Wrench, XCircle } from 'lucide-react';

const EMPTY: TwaConfig = {
  webUrl: '', packageId: '', name: '', launcherName: '', versionName: '1.0.0', versionCode: undefined,
  themeColor: '#0f172a', backgroundColor: '#ffffff', startUrl: '/', iconUrl: '', maskableIconUrl: '', monochromeIconUrl: '',
  display: 'standalone', orientation: 'default', fallbackType: 'customtabs', enableNotifications: false,
  enableSiteSettingsShortcut: true, locationDelegation: false, playBilling: false, additionalTrustedOrigins: [], linkRules: [],
  androidPermissions: [], shortcuts: [], minSdkVersion: 21, expectedFingerprint: '', predictiveBack: false, playSigningFingerprint: '', output: 'both', storeReady: true, useKeystore: true,
};

const FEATURES = [
  { id: 'notifications', label: 'Notifications', hint: 'Web push shows as real Android notifications (permission, icon and push kit included in the build)', permission: 'POST_NOTIFICATIONS' },
  { id: 'location', label: 'Location', hint: 'Use Android location permission for the site', permission: 'ACCESS_FINE_LOCATION' },
  { id: 'camera', label: 'Camera', hint: 'Site can use the camera (declared as optional so Play still lists the app on every phone)', permission: 'CAMERA' },
  { id: 'microphone', label: 'Microphone', hint: 'Allow the site to request the microphone', permission: 'RECORD_AUDIO' },
  { id: 'vibration', label: 'Vibration', hint: 'Allow vibration from supported web APIs', permission: 'VIBRATE' },
] as const;

const SCREEN_MODES = [
  { id: 'standalone', label: 'Standard', hint: 'Status and navigation bars stay visible' },
  { id: 'fullscreen', label: 'Fullscreen', hint: 'Hides the status and navigation bars; swipe from an edge to peek at them' },
  { id: 'fullscreen-sticky', label: 'Sticky fullscreen', hint: 'Bars stay hidden and re-hide on their own after a peek (games, readers, video)' },
] as const;

const input = 'w-full h-11 bg-[#050707] border border-white/[.08] rounded-lg px-3 text-white focus:border-emerald-400/50 focus:outline-none';
const card = 'rounded-2xl bg-[#070a09] border border-white/[.06] p-4 sm:p-5';

function featureState(cfg: TwaConfig, id: string) {
  if (id === 'notifications') return cfg.enableNotifications;
  if (id === 'location') return cfg.locationDelegation;
  return cfg.androidPermissions.includes(FEATURES.find(f => f.id === id)?.permission || '');
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const TwaView: React.FC = () => {
  const { projects, builds, repos, addProject, updateProject, setCurrentTab, subscription, selectedRepo, selectRepo, inspections, discoverRepo, notifyBuildStarted, expectNewBuild, cancelExpectNewBuild, openFlutterwaveCheckout, defaultKeystore } = useApp();
  const saved = projects.filter(p => p.kind === 'twa' && p.twa);
  const [cfg, setCfg] = useState<TwaConfig>(EMPTY);
  const repo = selectedRepo;
  const repoInspection: RepoInspection | null = repo ? inspections[repo] ?? null : null;
  const [inspection, setInspection] = useState<TwaInspection | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [needKey, setNeedKey] = useState(false);
  const inspectedUrl = useRef('');
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;
  // replace the whole form and make the new values visible to discover() in the same tick
  const replaceCfg = (next: TwaConfig) => { cfgRef.current = next; setCfg(next); };

  const signing = repoInspection?.signing;
  const signingReady = signing === 'repo' || signing === 'default' || (signing === undefined && defaultKeystore);
  const latestBuild = useMemo(() => [...builds].filter(b => b.kind === 'twa' && b.repo === repo).sort((a,b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))[0], [builds, repo]);
  const savedProject = editingId ? projects.find(p => p.id === editingId) : undefined;
  // key-order independent, and projects saved before a setting existed (e.g. linkRules) compare equal to its default
  const stable = (v: unknown): string => JSON.stringify(v, (_k, val) => val && typeof val === 'object' && !Array.isArray(val) ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b))) : val);
  const withDefaults = (t: TwaConfig) => ({ ...EMPTY, ...t, fallbackType: 'customtabs' });
  const settingsChanged = !!savedProject?.twa && stable(withDefaults(savedProject.twa)) !== stable(withDefaults(cfg));
  const sourceChanged = !!latestBuild?.commitHash && !!repoInspection?.latestCommitSha && !repoInspection.latestCommitSha.startsWith(latestBuild.commitHash);
  const buildCurrent = !!latestBuild && latestBuild.status === 'success' && !settingsChanged && !sourceChanged;
  const workflow = repoInspection?.workflows?.twa ?? { installed: repoInspection?.workflowInstalled ?? false, upToDate: repoInspection?.workflowUpToDate ?? false };

  const set = <K extends keyof TwaConfig>(key: K, value: TwaConfig[K]) => setCfg(c => ({ ...c, [key]: value }));

  const applyInspection = (r: TwaInspection, url: string) => {
    setInspection(r);
    const fresh = inspectedUrl.current !== url; // a different site replaces old detections; the same site only fills blanks
    inspectedUrl.current = url;
    const detected = Object.fromEntries(Object.entries(r.detected).filter(([, v]) => v !== undefined && v !== ''));
    setCfg(c => {
      const next: Record<string, unknown> = { ...c };
      for (const [k, v] of Object.entries(detected)) {
        const cur = (c as unknown as Record<string, unknown>)[k];
        if (fresh || cur === '' || cur === undefined || (Array.isArray(cur) && !cur.length)) next[k] = v;
      }
      next.fallbackType = 'customtabs';
      return next as unknown as TwaConfig;
    });
  };

  /** fill only the blanks from the manifest/package.json that lives in the repo */
  const fillFromRepo = (ri: RepoInspection) => {
    const w = ri.web;
    if (!w) return;
    setCfg(c => {
      const next: TwaConfig = { ...c };
      const blank = (v: unknown) => v === '' || v === undefined;
      if (blank(c.name) && w.name) next.name = w.name;
      if (blank(c.launcherName) && (w.launcherName || w.name)) next.launcherName = w.launcherName || w.name;
      if (blank(c.themeColor) || (editingId == null && c.themeColor === EMPTY.themeColor && w.themeColor)) next.themeColor = w.themeColor || c.themeColor;
      if (editingId == null && c.backgroundColor === EMPTY.backgroundColor && w.backgroundColor) next.backgroundColor = w.backgroundColor;
      if (editingId == null && c.display === EMPTY.display && (w.display === 'fullscreen' || w.display === 'minimal-ui')) next.display = w.display;
      if (editingId == null && c.orientation === 'default' && (w.orientation === 'portrait' || w.orientation === 'landscape')) next.orientation = w.orientation;
      if (editingId == null && c.startUrl === '/' && w.startUrl) next.startUrl = w.startUrl;
      return next;
    });
  };

  /** THE discover: repository + web app together, one button, one click */
  const discover = async () => {
    const r = repoFromUrl(repo);
    if (!r) return setError('Choose a GitHub repository first.');
    setBusy(true); setError(''); setStage('Discovering…');
    try {
      const ri = await discoverRepo(r, true);
      const url = cfgRef.current.webUrl || ri.homepage || '';
      if (url) {
        if (!cfgRef.current.webUrl) setCfg(c => ({ ...c, webUrl: url }));
        try { applyInspection(await api.twaInspect(url), url); }
        catch (e: any) { setError(`Repository found, but the live site could not be read (${e?.message || 'unreachable'}). Check the address and tap Discover again.`); }
      }
      fillFromRepo(ri);
      if (!url) setError('Repository found, but no live address was found (GitHub website field, package.json homepage, CNAME or Pages). Enter the address of your live web app (for example https://yourapp.com) and tap Discover again.');
    } catch (e: any) { setError(e?.message || 'Could not discover this repository.'); }
    finally { setBusy(false); setStage(''); }
  };

  const loadProject = (p: Project) => {
    if (!p.twa) return;
    const r = repoFromUrl(p.repoUrl) || '';
    inspectedUrl.current = p.twa.webUrl;
    replaceCfg({ ...EMPTY, ...p.twa, fallbackType: 'customtabs' });
    if (r) selectRepo(r);
    setEditingId(p.id);
    setInspection(null);
    setError(''); setNeedKey(false);
  };

  // Choosing a repo (here or anywhere else) discovers it automatically, and restores its saved app if there is one
  const lastAuto = useRef('');
  useEffect(() => {
    if (!repo || lastAuto.current === repo) return;
    lastAuto.current = repo;
    const existing = projects.find(p => p.kind === 'twa' && p.twa && repoFromUrl(p.repoUrl)?.toLowerCase() === repo.toLowerCase());
    if (existing) loadProject(existing);
    else { setEditingId(null); replaceCfg(EMPTY); setInspection(null); inspectedUrl.current = ''; }
    void discover();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo]);

  const toggleFeature = (id: string) => {
    const on = !featureState(cfg, id);
    if (id === 'notifications') return set('enableNotifications', on);
    if (id === 'location') return set('locationDelegation', on);
    const permission = FEATURES.find(f => f.id === id)?.permission;
    if (!permission) return;
    set('androidPermissions', on ? [...cfg.androidPermissions, permission] : cfg.androidPermissions.filter(p => p !== permission));
  };

  const linkRules: LinkRule[] = cfg.linkRules || [];
  const setRules = (next: LinkRule[]) => set('linkRules', next);
  const addRule = (pattern = '', mode: LinkMode = 'internal') => {
    if (pattern && linkRules.some(r => r.pattern.toLowerCase() === pattern)) return;
    setRules([...linkRules, { pattern, mode }]);
  };
  const changeRule = (i: number, patch: Partial<LinkRule>) => setRules(linkRules.map((r, j) => j === i ? { ...r, ...patch } : r));
  const hasMode = (m: LinkMode) => linkRules.some(r => r.pattern.trim() && r.mode === m);

  /** Explicit action: overwrite this repo's signing secrets with the WyBuild (Vercel) default key. */
  const useDefaultKey = async () => {
    const r = repoFromUrl(repo);
    if (!r) return;
    if (!window.confirm(`Replace the signing key stored in ${r} with the WyBuild default key?\n\nApps already published with the old key can only be updated with that old key.`)) return;
    setBusy(true); setError('');
    try { await api.resetSigning(r); await discoverRepo(r, true); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  /** One button: discover anything missing, install the workflow, make sure signing exists, dispatch. */
  const build = async () => {
    setError(''); setNeedKey(false);
    const r = repoFromUrl(repo);
    if (!r) return setError('Choose the GitHub repository for this Android build.');
    if (!cfg.webUrl) return setError('Enter the address of your live web app first (https://…).');
    if (!cfg.webUrl.startsWith('https://')) return setError('Your web app must use HTTPS.');
    const badLink = (cfg.linkRules || []).map(x => ({ x, e: checkLinkRule(x) })).find(v => v.e);
    if (badLink) return setError(`Link handling: "${badLink.x.pattern || 'empty rule'}" - ${badLink.e}`);
    setBusy(true);
    try {
      if (cfg.packageId && !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(cfg.packageId)) throw new Error('Package ID must look like com.yourbrand.app (lowercase letters, digits, underscores, at least two parts).');
      let twaCfg = cfg;
      if (!cfg.packageId) {
        setStage('Reading your web app…');
        const wi = await api.twaInspect(cfg.webUrl);
        applyInspection(wi, cfg.webUrl);
        twaCfg = { ...cfg, ...Object.fromEntries(Object.entries(wi.detected).filter(([, v]) => v !== undefined && v !== '' )) } as TwaConfig;
        if (!twaCfg.packageId) throw new Error('A package ID could not be generated from this web address.');
      }
      setStage('Checking repository…');
      const ri = await discoverRepo(r, true);
      if (ri.canPush === false) throw new Error('Your GitHub account cannot push to this repository, so WyBuild cannot install its workflow. Sign in as the owner, get write access, or pick a fork.');
      if (ri.signing === 'none') { setNeedKey(true); setBusy(false); setStage(''); return; }
      const wf = ri.workflows?.twa ?? { installed: ri.workflowInstalled, upToDate: ri.workflowUpToDate };
      const installedNow = !wf.installed || !wf.upToDate;
      if (installedNow) { setStage('Installing the WyBuild workflow…'); await api.installWorkflow(r, ri.defaultBranch, 'twa'); }
      const branch = ri.defaultBranch;
      const project = { name: twaCfg.name || new URL(twaCfg.webUrl).hostname, description: 'Trusted Web Activity build', repoUrl: `https://github.com/${r}`, branch, kind: 'twa' as const, twa: { ...twaCfg, shortcuts: twaCfg.shortcuts.filter(x => x.name && x.url), fallbackType: 'customtabs' as const, useKeystore: true, storeReady: true }, config: { target: 'apk' as const, mode: 'release' as const, flutterVersion: 'stable', dartDefines: [], obfuscate: false, splitDebugInfo: false, runTests: false, customArgs: '' } };
      let id = editingId;
      if (id) updateProject(id, project);
      else { const res = addProject(project); if (!res.success || !res.id) throw new Error(res.error || 'Could not save the project.'); id = res.id; setEditingId(id); }
      setStage('Starting the build…');
      const transient = ['NO_WORKFLOW', 'MISSING_HELPER_FILES', 'WORKFLOW_OUTDATED', 'WORKFLOW_NOT_DISPATCHABLE', 'GITHUB_NOT_FOUND', 'GITHUB_VALIDATION', 'GITHUB_ERROR'];
      expectNewBuild(r);
      for (let attempt = 0; ; attempt++) {
        try { await api.twaBuild(r, branch, project.twa); break; }
        catch (e) {
          // GitHub needs a few seconds to register a workflow we just committed
          if (!(installedNow && attempt < 4 && e instanceof ApiError && !!e.code && transient.includes(e.code))) throw e;
          await sleep(attempt === 0 ? 2500 : 4000);
        }
      }
      void discoverRepo(r, true);
      notifyBuildStarted();
      setCurrentTab('builds');
    } catch (e: any) {
      cancelExpectNewBuild();
      if (e instanceof ApiError && e.code === 'LIMIT') openFlutterwaveCheckout('monthly');
      setError(e?.message || 'Build could not be started.');
    } finally { setBusy(false); setStage(''); }
  };

  const reset = () => { replaceCfg(EMPTY); setInspection(null); setEditingId(null); setError(''); setNeedKey(false); inspectedUrl.current = ''; };

  const chip = (ok: boolean, good: string, todo: string) => <span className={`px-2.5 py-1 rounded-full border ${ok ? 'border-emerald-400/20 text-emerald-300' : 'border-amber-400/20 text-amber-300'}`}>{ok ? good : todo}</span>;
  const pushable = repos.filter(r => r.canPush);
  const readOnlyRepo = repoInspection?.canPush === false;
  const missing = !repo ? 'Choose a repository' : !cfg.webUrl ? 'Enter your web app address' : '';

  return <div className="max-w-4xl mx-auto p-3 sm:p-6 space-y-4 text-xs">
    <header>
      <div className="flex items-center gap-2"><Smartphone className="w-5 h-5 text-emerald-300"/><h1 className="text-xl font-bold text-white">Web → Android</h1></div>
      <p className="text-slate-500 mt-1">Pick the repo, tap Discover once, press Build. WyBuild installs the workflow and signs the app for you.</p>
    </header>

    {saved.length > 0 && <div className="flex gap-2 overflow-x-auto pb-1">{saved.map(p => <button key={p.id} onClick={() => loadProject(p)} className={`px-3 py-2 rounded-lg border whitespace-nowrap ${editingId === p.id ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : 'border-white/[.07] text-slate-400'}`}>{p.name}</button>)}<button onClick={reset} className="px-3 py-2 text-slate-500">+ New</button></div>}

    <section className={card}>
      <div className="flex items-center gap-2 text-white font-semibold"><Github className="w-4 h-4 text-emerald-300"/>Repository &amp; web app</div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <div>
          <label className="text-slate-500">GitHub repository</label>
          <select className={input} value={repo} onChange={e => selectRepo(e.target.value)}>
            <option value="">{repos.length ? 'Choose a repository…' : 'Loading repositories…'}</option>
            {repo && !repos.some(r => r.fullName === repo) && <option value={repo}>{repo}</option>}
            {pushable.map(r => <option key={r.fullName} value={r.fullName}>{r.fullName}</option>)}
            {repos.filter(r => !r.canPush).map(r => <option key={r.fullName} value={r.fullName}>{r.fullName} (read-only)</option>)}
          </select>
        </div>
        <div>
          <label className="text-slate-500">Live web app address</label>
          <input className={input} placeholder="https://yourapp.com" value={cfg.webUrl} onChange={e => set('webUrl', e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void discover(); }}/>
        </div>
      </div>
      <button onClick={discover} disabled={busy || !repo} className="mt-3 w-full sm:w-auto h-11 px-5 rounded-lg bg-emerald-400 text-black font-bold flex items-center justify-center gap-2 disabled:opacity-40">{busy && stage === 'Discovering…' ? <Loader2 className="w-4 h-4 animate-spin"/> : <Search className="w-4 h-4"/>}Discover</button>
      {readOnlyRepo && <div className="mt-3 p-3 rounded-lg border border-amber-400/20 bg-amber-400/[.05] text-amber-200">Read-only: your GitHub account cannot push to this repo, so the workflow cannot be installed. Sign in as the owner, get write access, or pick a fork.</div>}
      {repoInspection && <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
        <div className="p-2 rounded-lg bg-black/20"><span className="text-slate-600">Branch</span><b className="block text-white font-mono break-all">{repoInspection.defaultBranch}</b></div>
        <div className="p-2 rounded-lg bg-black/20"><span className="text-slate-600">Commit</span><b className="block text-white font-mono">{repoInspection.latestCommitSha?.slice(0,7) || '—'}</b></div>
        <div className="p-2 rounded-lg bg-black/20"><span className="text-slate-600">Workflow</span><b className={`block ${workflow.installed && workflow.upToDate ? 'text-emerald-300' : 'text-amber-300'}`}>{workflow.installed && workflow.upToDate ? 'Installed' : workflow.installed ? 'Updates on build' : 'Installs on build'}</b></div>
        <div className="p-2 rounded-lg bg-black/20"><span className="text-slate-600">Signing</span><b className={`block ${signingReady ? 'text-emerald-300' : 'text-amber-300'}`}>{signing === 'repo' ? 'Repo key' : signingReady ? 'Default key' : 'Key needed'}</b></div>
      </div>}
      {repoInspection && defaultKeystore && signing === 'repo' && <button type="button" disabled={busy} onClick={useDefaultKey} className="mt-2 text-xs text-emerald-300 underline disabled:opacity-40">Replace this repo's key with the WyBuild default key</button>}
      {inspection && <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">{inspection.checks.map(c => <div key={c.id} className={`rounded-lg px-3 py-2 border ${c.level === 'error' ? 'border-rose-500/20 text-rose-300' : c.level === 'warn' ? 'border-amber-500/20 text-amber-200' : 'border-emerald-400/15 text-emerald-200'}`}><div className="flex gap-2 items-center">{c.level === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0"/> : <AlertTriangle className="w-3.5 h-3.5 shrink-0"/>}{c.msg}</div></div>)}</div>}
    </section>

    <section className={card}>
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-white font-semibold"><Package className="w-4 h-4 text-emerald-300"/>Automatic app identity</div><span className="text-[10px] text-emerald-300">{editingId ? `EDITING ${(savedProject?.name || cfg.name || 'APP').toUpperCase()}` : 'PACKAGE ID IS FREE'}</span></div>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <div><label className="text-slate-500">App name</label><input className={input} value={cfg.name} onChange={e => set('name', e.target.value)} placeholder="Detected automatically"/></div>
        <div><label className="text-slate-500">Package ID</label><input className={`${input} font-mono text-emerald-200`} value={cfg.packageId} onChange={e => set('packageId', e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} placeholder="Generated from your domain" autoCapitalize="none" spellCheck={false}/></div>
        <div><label className="text-slate-500">Version</label><input className={input} value={cfg.versionName} onChange={e => set('versionName', e.target.value)}/></div>
        <div><label className="text-slate-500">Minimum version code <span className="text-slate-600">(optional)</span></label><input className={`${input} font-mono`} inputMode="numeric" value={cfg.versionCode ?? ''} onChange={e => { const n = Number(e.target.value.replace(/\D/g, '')); set('versionCode', n > 0 ? n : undefined); }} placeholder="Auto: always higher than before"/></div>
        <div><label className="text-slate-500">Launcher name <span className="text-slate-600">(under the icon)</span></label><input className={input} value={cfg.launcherName} onChange={e => set('launcherName', e.target.value)} placeholder="Same as app name"/></div>
        <div><label className="text-slate-500">Icon</label><div className="flex gap-2">{cfg.iconUrl && /^https:\/\//.test(cfg.iconUrl) && <img src={cfg.iconUrl} alt="" className="h-11 w-11 rounded-lg bg-black/40 object-contain shrink-0" onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}/>}<input className={input} value={cfg.iconUrl} onChange={e => set('iconUrl', e.target.value)} placeholder="Detected from manifest"/></div></div>
      </div>
      <p className="text-slate-600 mt-2">The package ID is generated from the domain and reused on future builds so updates keep the same Android identity. You can set your own (like com.yourbrand.app), but changing it on a published app makes Android treat the new build as a different app, so users cannot update to it. The version code rises automatically on every build (time-based), so Google Play never rejects an upload as "version code already used". Set a minimum only if Play reports a higher one.</p>
    </section>

    <section className={card}>
      <div className="flex items-center gap-2 text-white font-semibold"><Wrench className="w-4 h-4 text-emerald-300"/>Native features</div>
      <p className="text-slate-500 mt-1">Tick only what your website needs. WyBuild adds the required Android permissions/configuration.</p>
      <div className="grid sm:grid-cols-2 gap-2 mt-3">{FEATURES.map(f => { const checked = featureState(cfg, f.id); return <button key={f.id} type="button" onClick={() => toggleFeature(f.id)} className={`text-left rounded-xl border p-3 flex gap-3 ${checked ? 'border-emerald-400/30 bg-emerald-400/[.06]' : 'border-white/[.06] bg-black/20'}`}><span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${checked ? 'bg-emerald-400 border-emerald-400 text-black' : 'border-slate-600'}`}>{checked && <Check className="w-3.5 h-3.5"/>}</span><span><b className="text-slate-200 block">{f.label}</b><span className="text-[11px] text-slate-500">{f.hint}</span></span></button>; })}</div>
      {(() => { const hints = (inspection?.featureHints || []).filter(id => !featureState(cfg, id)); return hints.length > 0 && <div className="mt-3 p-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[.04] text-emerald-200 flex flex-wrap items-center gap-2"><span>Your site's code appears to use:</span>{hints.map(id => <button key={id} type="button" onClick={() => toggleFeature(id)} className="px-2.5 py-1 rounded-full border border-emerald-400/30 hover:bg-emerald-400/10">+ {FEATURES.find(f => f.id === id)?.label}</button>)}</div>; })()}
    </section>

    <section className={card}>
      <div className="flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-white font-semibold"><Link2 className="w-4 h-4 text-emerald-300"/>Link handling</div><span className="text-[10px] text-slate-500">{linkRules.length ? `${linkRules.length} RULE${linkRules.length === 1 ? '' : 'S'}` : 'DEFAULT'}</span></div>
      <p className="text-slate-500 mt-1">Choose what happens when someone taps a link in the app. Links on your own site always stay inside the app. Add a domain, a custom domain, or a link type such as <span className="font-mono text-slate-400">tel:</span>. The first matching rule wins.</p>
      <div className="grid sm:grid-cols-3 gap-2 mt-3">{LINK_MODES.map(m => <div key={m.id} className="rounded-xl border border-white/[.06] bg-black/20 p-3"><b className="text-slate-200 block">{m.label}</b><span className="text-[11px] text-slate-500">{m.hint}</span></div>)}</div>
      {linkRules.map((rule, i) => { const err = rule.pattern.trim() ? checkLinkRule(rule) : ''; return <div key={i} className={`mt-2 rounded-xl border p-3 ${err ? 'border-rose-500/30' : 'border-white/[.06]'} bg-black/20`}>
        <div className="flex gap-2">
          <input className={`${input} font-mono`} value={rule.pattern} onChange={e => changeRule(i, { pattern: e.target.value })} placeholder="shop.example.com  ·  *.example.com/docs  ·  tel:" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-label="Domain or link type"/>
          <button type="button" onClick={() => setRules(linkRules.filter((_, j) => j !== i))} className="px-2 text-slate-500 hover:text-rose-400 shrink-0" aria-label="Remove rule"><XCircle className="w-4 h-4"/></button>
        </div>
        <div className="grid grid-cols-3 gap-2 mt-2">{LINK_MODES.map(m => { const on = rule.mode === m.id; return <button key={m.id} type="button" onClick={() => changeRule(i, { mode: m.id })} className={`h-10 rounded-lg border font-semibold ${on ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200' : 'border-white/[.08] text-slate-400'}`}>{m.label}</button>; })}</div>
        {err && <p className="text-rose-300 mt-2">{err}</p>}
      </div>; })}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => addRule()} disabled={linkRules.length >= 30} className="h-10 px-4 rounded-lg border border-emerald-400/30 text-emerald-300 disabled:opacity-40">+ Add link</button>
        {LINK_PRESETS.filter(pr => !linkRules.some(r => r.pattern.toLowerCase() === pr.pattern)).map(pr => <button key={pr.pattern} type="button" onClick={() => addRule(pr.pattern, pr.mode)} className="h-10 px-3 rounded-full border border-white/[.08] text-slate-400 hover:text-slate-200">+ {pr.label}</button>)}
      </div>
      {hasMode('internal') && <p className="text-slate-600 mt-3">Internal domains are added as trusted domains and verified app links, so tapping a link to them anywhere on the phone opens this app. Publish the build's assetlinks.json on <b className="text-slate-500">each</b> internal domain (the post-build check lists any that are missing).</p>}
      {(hasMode('external') || hasMode('other')) && <p className="text-slate-600 mt-2">External and Other rules are applied by <span className="font-mono text-slate-500">wybuild-links.js</span>, which the build produces for you: add it to your website with <span className="font-mono text-slate-500">&lt;script src="/wybuild-links.js" defer&gt;</span>. Android's Trusted Web Activity cannot intercept those taps by itself.</p>}
      {!linkRules.length && <p className="text-slate-600 mt-3">No rules: your site stays in the app and other sites open in an in-app browser tab.</p>}
    </section>

    <section className={card}>
      <div className="flex items-center gap-2 text-white font-semibold"><Smartphone className="w-4 h-4 text-emerald-300"/>Screen &amp; gestures</div>
      <p className="text-slate-500 mt-1">Built into the APK and AAB at build time.</p>
      <div className="grid sm:grid-cols-3 gap-2 mt-3">{SCREEN_MODES.map(m => { const on = (cfg.display === 'minimal-ui' ? 'standalone' : cfg.display) === m.id; return <button key={m.id} type="button" onClick={() => set('display', m.id)} className={`text-left rounded-xl border p-3 ${on ? 'border-emerald-400/30 bg-emerald-400/[.06]' : 'border-white/[.06] bg-black/20'}`}><b className="text-slate-200 block">{m.label}</b><span className="text-[11px] text-slate-500">{m.hint}</span></button>; })}</div>
      <button type="button" onClick={() => set('predictiveBack', !cfg.predictiveBack)} className={`mt-2 w-full text-left rounded-xl border p-3 flex gap-3 ${cfg.predictiveBack ? 'border-emerald-400/30 bg-emerald-400/[.06]' : 'border-white/[.06] bg-black/20'}`}><span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${cfg.predictiveBack ? 'bg-emerald-400 border-emerald-400 text-black' : 'border-slate-600'}`}>{cfg.predictiveBack && <Check className="w-3.5 h-3.5"/>}</span><span><b className="text-slate-200 block">Predictive back gesture</b><span className="text-[11px] text-slate-500">Android 13+ shows the back-swipe preview animation. Older phones ignore it.</span></span></button>
      <div className="mt-3"><label className="text-slate-500">Google Play app-signing SHA-256 <span className="text-slate-600">(optional)</span></label><input className={`${input} font-mono`} value={cfg.playSigningFingerprint || ''} onChange={e => set('playSigningFingerprint', e.target.value.trim())} placeholder="Play Console → Setup → App signing → SHA-256"/></div>
      <p className="text-slate-600 mt-2">Fullscreen hides the status bar, navigation bar and address bar like a native app, but only while Android can verify your site. WyBuild checks this after every build and reports it in the run summary. Publish the build's assetlinks.json at /.well-known/assetlinks.json; if the app is installed from Google Play, add the Play app-signing fingerprint above, otherwise the browser address bar comes back.</p>
    </section>

    <section className={card}>
      <div className="flex items-center gap-2 text-white font-semibold"><Wrench className="w-4 h-4 text-emerald-300"/>More app info</div>
      <p className="text-slate-500 mt-1">Colors, start page, orientation, Android version support, extra trusted domains and shortcuts. Change anything, then rebuild.</p>
      <div className="grid sm:grid-cols-2 gap-3 mt-3">
        <div><label className="text-slate-500">Theme color</label><div className="flex gap-2"><input type="color" className="h-11 w-12 bg-[#050707] border border-white/[.08] rounded-lg p-1" value={/^#[0-9a-fA-F]{6}$/.test(cfg.themeColor) ? cfg.themeColor : '#0f172a'} onChange={e => set('themeColor', e.target.value)}/><input className={`${input} font-mono`} value={cfg.themeColor} onChange={e => set('themeColor', e.target.value)}/></div></div>
        <div><label className="text-slate-500">Background (splash) color</label><div className="flex gap-2"><input type="color" className="h-11 w-12 bg-[#050707] border border-white/[.08] rounded-lg p-1" value={/^#[0-9a-fA-F]{6}$/.test(cfg.backgroundColor) ? cfg.backgroundColor : '#ffffff'} onChange={e => set('backgroundColor', e.target.value)}/><input className={`${input} font-mono`} value={cfg.backgroundColor} onChange={e => set('backgroundColor', e.target.value)}/></div></div>
        <div><label className="text-slate-500">Start URL</label><input className={`${input} font-mono`} value={cfg.startUrl} onChange={e => set('startUrl', e.target.value)} placeholder="/"/></div>
        <div><label className="text-slate-500">Orientation</label><select className={input} value={cfg.orientation} onChange={e => set('orientation', e.target.value as TwaConfig['orientation'])}><option value="default">Any (follow the phone)</option><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select></div>
        <div><label className="text-slate-500">Minimum Android version</label><select className={input} value={cfg.minSdkVersion} onChange={e => set('minSdkVersion', Number(e.target.value))}>{[[21, 'Android 5.0 (API 21)'], [23, 'Android 6.0 (API 23)'], [26, 'Android 8.0 (API 26)'], [29, 'Android 10 (API 29)'], [31, 'Android 12 (API 31)']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label className="text-slate-500">Output</label><select className={input} value={cfg.output} onChange={e => set('output', e.target.value as TwaConfig['output'])}><option value="both">APK + AAB</option><option value="apk">APK only</option><option value="aab">AAB only (Google Play)</option></select></div>
      </div>
      <div className="mt-3"><label className="text-slate-500">Extra trusted domains <span className="text-slate-600">(one per line, https://…)</span></label><textarea rows={2} className="w-full bg-[#050707] border border-white/[.08] rounded-lg px-3 py-2 text-white font-mono focus:border-emerald-400/50 focus:outline-none" value={cfg.additionalTrustedOrigins.join('\n')} onChange={e => set('additionalTrustedOrigins', e.target.value.split('\n').map(x => x.trim()).filter(Boolean))} placeholder="https://auth.yourapp.com"/></div>
      <div className="mt-3">
        <div className="flex items-center justify-between"><label className="text-slate-500">App shortcuts <span className="text-slate-600">(long-press the icon)</span></label>{cfg.shortcuts.length < 4 && <button type="button" onClick={() => set('shortcuts', [...cfg.shortcuts, { name: '', shortName: '', url: '/' }])} className="text-emerald-300">+ Add</button>}</div>
        {cfg.shortcuts.map((sc, i) => <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 mt-2">
          <input className={input} placeholder="Name" value={sc.name} onChange={e => set('shortcuts', cfg.shortcuts.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}/>
          <input className={input} placeholder="Short name" value={sc.shortName} onChange={e => set('shortcuts', cfg.shortcuts.map((x, j) => j === i ? { ...x, shortName: e.target.value } : x))}/>
          <input className={`${input} font-mono`} placeholder="/path" value={sc.url} onChange={e => set('shortcuts', cfg.shortcuts.map((x, j) => j === i ? { ...x, url: e.target.value } : x))}/>
          <button type="button" onClick={() => set('shortcuts', cfg.shortcuts.filter((_, j) => j !== i))} className="px-2 text-slate-500 hover:text-rose-400"><XCircle className="w-4 h-4"/></button>
        </div>)}
      </div>
    </section>

    {repoInspection && latestBuild && <section className={card}>
      <div className="flex items-center gap-2 text-white font-semibold"><RefreshCw className="w-4 h-4 text-emerald-300"/>Build status</div>
      <div className="mt-3 flex flex-wrap gap-2">
        {chip(!sourceChanged, 'Repo build source current', 'APK outdated: repo changed')}
        {chip(!settingsChanged, 'Build settings current', 'APK outdated: settings changed')}
        {chip(buildCurrent, 'APK current', 'Build required')}
      </div>
    </section>}

    <section className={card}>
      <div className="flex items-center justify-between"><div><div className="text-white font-semibold">Pro automation</div><p className="text-slate-500 mt-1">Automatic rebuilds and other repo-change automation stay behind Pro. Manual builds remain available here.</p></div><span className="text-[10px] px-2 py-1 rounded bg-emerald-400/10 text-emerald-300">PRO</span></div>
      {subscription.plan !== 'pro' && <button onClick={() => setCurrentTab('billing')} className="mt-2 text-emerald-300 underline">View Pro</button>}
    </section>

    {needKey && <section className="rounded-2xl border border-amber-400/25 bg-amber-400/[.04] p-4 sm:p-5 space-y-3">
      <div className="flex items-center gap-2 text-amber-200 font-semibold"><KeyRound className="w-4 h-4"/>One-time signing key for {repo}</div>
      <p className="text-slate-400">No usable release keystore is available for this repo. {repoInspection?.signingProblem ? <span className="text-amber-200">The WyBuild default key was not used: {repoInspection.signingProblem} Fix it in Vercel and redeploy, and no repo will ask again. </span> : defaultKeystore ? '' : 'To skip this for every repo, set WB_KEYSTORE_* in the WyBuild Vercel environment. '}Or upload a key for this repo only; the build then starts automatically.</p>
      <KeystoreForm repos={[repo]} defaultRepo={repo} onCancel={() => setNeedKey(false)} onDone={() => { setNeedKey(false); void discoverRepo(repo, true).then(() => build()); }}/>
    </section>}

    {error && <div className="p-3 rounded-xl border border-rose-500/20 bg-rose-500/[.05] text-rose-300 flex gap-2"><XCircle className="w-4 h-4 shrink-0"/><span className="break-words min-w-0">{error}</span></div>}
    <div className="sticky bottom-0 -mx-3 sm:mx-0 px-3 sm:px-0 py-3 bg-gradient-to-t from-[#030505] via-[#030505]/95 to-transparent flex flex-col sm:flex-row sm:items-center sm:justify-end gap-2">
      {!busy && missing && <span className="text-slate-500 sm:mr-2">{missing} to build.</span>}
      {busy && stage && <span className="text-emerald-300 sm:mr-2 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin"/>{stage}</span>}
      <button onClick={build} disabled={busy || !!missing} className="px-5 h-12 rounded-lg bg-emerald-400 text-black font-bold flex items-center justify-center gap-2 disabled:opacity-40">{busy ? <Loader2 className="w-4 h-4 animate-spin"/> : <Play className="w-4 h-4 fill-current"/>}Build {cfg.output === 'aab' ? 'AAB' : cfg.output === 'apk' ? 'APK' : 'APK + AAB'}</button>
    </div>
  </div>;
};
