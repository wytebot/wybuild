import React, { useEffect, useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api, repoFromUrl, TwaInspection } from '../../services/api';
import { Project, TwaConfig } from '../../types';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Globe,
  KeyRound,
  Loader2,
  Package,
  Play,
  Save,
  ScanSearch,
  Smartphone,
  Wrench,
  XCircle,
} from 'lucide-react';

const EMPTY: TwaConfig = {
  webUrl: '',
  packageId: '',
  name: '',
  launcherName: '',
  versionName: '1.0.0',
  versionCode: undefined,
  themeColor: '#0f172a',
  backgroundColor: '#ffffff',
  startUrl: '/',
  iconUrl: '',
  maskableIconUrl: '',
  monochromeIconUrl: '',
  display: 'standalone',
  orientation: 'default',
  fallbackType: 'customtabs',
  enableNotifications: false,
  enableSiteSettingsShortcut: true,
  locationDelegation: false,
  playBilling: false,
  additionalTrustedOrigins: [],
  androidPermissions: [],
  shortcuts: [],
  minSdkVersion: 21,
  expectedFingerprint: '',
  output: 'both',
  storeReady: true,
  useKeystore: true,
};

const COMMON_PERMISSIONS = [
  ['CAMERA', 'Camera'],
  ['RECORD_AUDIO', 'Microphone'],
  ['ACCESS_FINE_LOCATION', 'Precise location'],
  ['POST_NOTIFICATIONS', 'Notifications (Android 13+)'],
  ['VIBRATE', 'Vibration'],
];

const input = 'w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none';
const label = 'block text-slate-300 font-medium mb-1';
const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);

const Card: React.FC<{ icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }> = ({ icon, title, hint, children }) => (
  <section className="p-5 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
    <div>
      <h2 className="text-sm font-bold text-white flex items-center gap-2">
        {icon}
        {title}
      </h2>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
    {children}
  </section>
);

const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; title: string; desc?: string; disabled?: boolean }> = ({ checked, onChange, title, desc, disabled }) => (
  <label className={`flex items-start gap-2.5 p-2.5 rounded bg-slate-950 border border-slate-800 ${disabled ? 'opacity-60' : 'cursor-pointer'}`}>
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-cyan-500" />
    <span>
      <span className="text-slate-200 font-medium block">{title}</span>
      {desc && <span className="text-[11px] text-slate-400">{desc}</span>}
    </span>
  </label>
);

export const TwaView: React.FC = () => {
  const { projects, repos, keystores, addProject, updateProject, triggerBuild, setCurrentTab, showToast } = useApp();
  const twaProjects = projects.filter((p) => p.kind === 'twa' && p.twa);

  const [cfg, setCfg] = useState<TwaConfig>(EMPTY);
  const [repo, setRepo] = useState('');
  const [branch, setBranch] = useState('main');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [originsText, setOriginsText] = useState('');
  const [permsText, setPermsText] = useState('');
  const [shortcutsText, setShortcutsText] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspection, setInspection] = useState<TwaInspection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; since: string } | null>(null);

  const set = <K extends keyof TwaConfig>(k: K, v: TwaConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const hasKeystore = useMemo(() => !!repo && keystores.some((k) => k.id === repo), [keystores, repo]);

  // "Save & build" waits until the saved project is visible in state, so the build uses the saved values
  useEffect(() => {
    if (!pending) return;
    const proj = projects.find((p) => p.id === pending.id);
    if (proj && proj.updatedAt >= pending.since) {
      setPending(null);
      triggerBuild(proj.id);
    }
  }, [pending, projects, triggerBuild]);

  const load = (p: Project) => {
    if (!p.twa) return;
    setCfg({ ...EMPTY, ...p.twa });
    setRepo(repoFromUrl(p.repoUrl) || '');
    setBranch(p.branch);
    setEditingId(p.id);
    setOriginsText(p.twa.additionalTrustedOrigins.join('\n'));
    setPermsText(p.twa.androidPermissions.join('\n'));
    setShortcutsText(p.twa.shortcuts.map((s) => `${s.name} | ${s.url}`).join('\n'));
    setInspection(null);
  };

  const reset = () => {
    setCfg(EMPTY);
    setEditingId(null);
    setOriginsText('');
    setPermsText('');
    setShortcutsText('');
    setInspection(null);
  };

  const inspect = async () => {
    setError(null);
    setInspecting(true);
    try {
      const r = await api.twaInspect(cfg.webUrl);
      setInspection(r);
      // fill only what is still empty, so manual edits are never overwritten
      setCfg((c) => {
        const next = { ...c };
        (Object.keys(r.detected) as (keyof typeof r.detected)[]).forEach((k) => {
          const v = r.detected[k];
          if (v && !(c as any)[k]) (next as any)[k] = v;
        });
        if (r.detected.webUrl) next.webUrl = r.detected.webUrl;
        if (r.detected.themeColor && c.themeColor === EMPTY.themeColor) next.themeColor = r.detected.themeColor;
        if (r.detected.backgroundColor && c.backgroundColor === EMPTY.backgroundColor) next.backgroundColor = r.detected.backgroundColor;
        return next;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not inspect the site');
    } finally {
      setInspecting(false);
    }
  };

  const buildConfig = (): TwaConfig | null => {
    setError(null);
    if (!/^https:\/\//.test(cfg.webUrl)) return setError('Enter the https:// address of your web app.'), null;
    if (!repoFromUrl(repo)) return setError('Choose the GitHub repository that will host the build workflow (owner/name).'), null;
    if (cfg.packageId && !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(cfg.packageId)) return setError('Package id must look like com.yourbrand.app.'), null;
    if (cfg.storeReady && !cfg.useKeystore) return setError('Store-ready builds must be signed with your own release keystore.'), null;
    const shortcuts = lines(shortcutsText).map((l) => {
      const [name, url] = l.split('|').map((x) => x.trim());
      return { name: name || '', shortName: (name || '').slice(0, 12), url: url || '' };
    });
    if (shortcuts.some((s) => !s.name || !s.url.startsWith('/'))) return setError('Shortcuts use the format "Name | /path" (one per line).'), null;
    return {
      ...cfg,
      additionalTrustedOrigins: lines(originsText),
      androidPermissions: lines(permsText),
      shortcuts: shortcuts.slice(0, 4),
    };
  };

  const save = (andBuild: boolean) => {
    const twa = buildConfig();
    if (!twa) return;
    const since = new Date().toISOString();
    const base = {
      name: twa.name || new URL(twa.webUrl).hostname,
      description: `Web app to Android (TWA): ${new URL(twa.webUrl).hostname}`,
      repoUrl: `https://github.com/${repoFromUrl(repo)}`,
      branch: branch || 'main',
      kind: 'twa' as const,
      twa,
      config: projects[0]?.config || { target: 'apk' as const, mode: 'release' as const, flutterVersion: 'stable', dartDefines: [], obfuscate: false, splitDebugInfo: false, runTests: false, customArgs: '' },
    };
    let id = editingId;
    if (editingId) {
      updateProject(editingId, base);
    } else {
      const res = addProject(base);
      if (!res.success) return setError(res.error || 'Could not save the project');
      id = res.id || null;
      setEditingId(id);
    }
    if (andBuild && id) setPending({ id, since });
  };

  const checkLevelIcon = (lvl: 'ok' | 'warn' | 'error') =>
    lvl === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" /> : lvl === 'warn' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <XCircle className="w-3.5 h-3.5 text-rose-400 shrink-0" />;

  return (
    <div className="p-3 sm:p-6 max-w-5xl mx-auto space-y-4 sm:space-y-5 text-xs">
      <div>
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <Smartphone className="w-5 h-5 text-cyan-400" />
          Web app to Android (TWA)
        </h1>
        <p className="text-slate-400 mt-1 max-w-3xl">
          Wrap a PWA or website as a Trusted Web Activity with Google&apos;s Bubblewrap CLI, built in your own GitHub Actions. Fields you leave blank are detected from the
          site&apos;s Web App Manifest. The result is a signed APK (and AAB) plus the Digital Asset Links file and a store-readiness report.
        </p>
      </div>

      {twaProjects.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400">Saved:</span>
          {twaProjects.map((p) => (
            <button
              key={p.id}
              onClick={() => load(p)}
              className={`px-2.5 py-1 rounded border cursor-pointer ${editingId === p.id ? 'border-cyan-500 text-cyan-300 bg-cyan-500/10' : 'border-slate-800 text-slate-300 hover:border-slate-600'}`}
            >
              {p.name}
            </button>
          ))}
          {editingId && (
            <button onClick={reset} className="px-2.5 py-1 rounded text-slate-400 hover:text-white cursor-pointer">
              + New
            </button>
          )}
        </div>
      )}

      <Card icon={<Globe className="w-4 h-4 text-cyan-400" />} title="1. Your web app" hint="HTTPS is required. WyBuild reads the page and its manifest to pre-fill the rest.">
        <div className="flex gap-2">
          <input className={input} placeholder="https://app.yourdomain.com/" value={cfg.webUrl} onChange={(e) => set('webUrl', e.target.value)} />
          <button
            onClick={inspect}
            disabled={inspecting || !cfg.webUrl}
            className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center gap-1.5 shrink-0 disabled:opacity-50 cursor-pointer"
          >
            {inspecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanSearch className="w-3.5 h-3.5" />}
            Inspect &amp; auto-fill
          </button>
        </div>
        {inspection && (
          <ul className="space-y-1.5">
            {inspection.checks.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-slate-300">
                {checkLevelIcon(c.level)}
                {c.msg}
              </li>
            ))}
            <li className="flex items-center gap-2 text-slate-300">
              {checkLevelIcon(inspection.assetlinks.present ? 'ok' : 'warn')}
              {inspection.assetlinks.present
                ? `assetlinks.json exists (lists: ${inspection.assetlinks.packages.join(', ') || 'no packages'})`
                : 'No assetlinks.json yet. The build generates it; publish it at /.well-known/assetlinks.json.'}
            </li>
          </ul>
        )}
      </Card>

      <Card icon={<Package className="w-4 h-4 text-cyan-400" />} title="2. App identity">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={label}>App name</label>
            <input className={input} value={cfg.name} onChange={(e) => set('name', e.target.value)} placeholder="Detected from manifest" />
          </div>
          <div>
            <label className={label}>Launcher name (12 characters or fewer)</label>
            <input className={input} value={cfg.launcherName} onChange={(e) => set('launcherName', e.target.value)} placeholder="Shown under the icon" />
          </div>
          <div>
            <label className={`${label} flex items-center gap-2`}>Package id <span className="text-[9px] text-emerald-400 font-mono">FREE</span></label>
            <input className={`${input} font-mono`} value={cfg.packageId} onChange={(e) => set('packageId', e.target.value.trim())} placeholder="com.yourbrand.app" />
            <p className="text-[11px] text-slate-500 mt-1">Permanent. It identifies your app on every device and store; never reuse com.example.*.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={label}>Version name</label>
              <input className={`${input} font-mono`} value={cfg.versionName} onChange={(e) => set('versionName', e.target.value)} />
            </div>
            <div>
              <label className={label}>Version code</label>
              <input
                className={`${input} font-mono`}
                inputMode="numeric"
                value={cfg.versionCode ?? ''}
                onChange={(e) => set('versionCode', e.target.value ? Number(e.target.value.replace(/\D/g, '')) : undefined)}
                placeholder="auto"
              />
            </div>
          </div>
          <div>
            <label className={label}>App icon URL (512×512 PNG)</label>
            <input className={input} value={cfg.iconUrl} onChange={(e) => set('iconUrl', e.target.value)} placeholder="Detected from manifest" />
          </div>
          <div>
            <label className={label}>Maskable icon URL (optional)</label>
            <input className={input} value={cfg.maskableIconUrl} onChange={(e) => set('maskableIconUrl', e.target.value)} />
          </div>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className={label}>Theme colour</label>
              <input type="color" value={cfg.themeColor} onChange={(e) => set('themeColor', e.target.value)} className="w-full h-9 bg-slate-950 border border-slate-800 rounded cursor-pointer" />
            </div>
            <div className="flex-1">
              <label className={label}>Splash background</label>
              <input type="color" value={cfg.backgroundColor} onChange={(e) => set('backgroundColor', e.target.value)} className="w-full h-9 bg-slate-950 border border-slate-800 rounded cursor-pointer" />
            </div>
          </div>
          <div>
            <label className={label}>Start URL path</label>
            <input className={`${input} font-mono`} value={cfg.startUrl} onChange={(e) => set('startUrl', e.target.value)} />
          </div>
        </div>
      </Card>

      <Card icon={<Wrench className="w-4 h-4 text-cyan-400" />} title="3. Android features" hint="Automatic defaults work for most sites. Open the manual section for permissions, shortcuts and project-level overrides.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={label}>Display</label>
            <select className={input} value={cfg.display} onChange={(e) => set('display', e.target.value as TwaConfig['display'])}>
              <option value="standalone">Standalone</option>
              <option value="fullscreen">Fullscreen</option>
              <option value="minimal-ui">Minimal UI</option>
            </select>
          </div>
          <div>
            <label className={label}>Orientation</label>
            <select className={input} value={cfg.orientation} onChange={(e) => set('orientation', e.target.value as TwaConfig['orientation'])}>
              <option value="default">Follow device</option>
              <option value="portrait">Portrait</option>
              <option value="landscape">Landscape</option>
            </select>
          </div>
          <div>
            <label className={label}>If Chrome is unavailable</label>
            <select className={input} value={cfg.fallbackType} onChange={(e) => set('fallbackType', e.target.value as TwaConfig['fallbackType'])}>
              <option value="customtabs">Custom Tab (recommended)</option>
              <option value="webview">WebView</option>
            </select>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Toggle checked={cfg.enableNotifications} onChange={(v) => set('enableNotifications', v)} title="Push notification delegation" desc="Lets the site's web notifications show as native Android notifications." />
          <Toggle checked={cfg.locationDelegation} onChange={(v) => set('locationDelegation', v)} title="Location delegation" desc="Uses Android's location permission prompt for the site." />
          <Toggle checked={cfg.enableSiteSettingsShortcut} onChange={(v) => set('enableSiteSettingsShortcut', v)} title="Site settings shortcut" desc="Long-press the icon to reach notification/site settings." />
          <Toggle checked={cfg.playBilling} onChange={(v) => set('playBilling', v)} title="Play Billing bridge" desc="Only needed for Google Play distribution; mirrors do not use it." />
        </div>

        <button type="button" onClick={() => setShowAdvanced((v) => !v)} className="flex items-center gap-1.5 text-cyan-400 hover:text-cyan-300 font-medium cursor-pointer">
          {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          Manual Android configuration
        </button>
        {showAdvanced && (
          <div className="space-y-4 pl-3 border-l border-slate-800">
            <div>
              <label className={label}>Extra Android permissions (one per line)</label>
              <textarea className={`${input} font-mono h-20`} value={permsText} onChange={(e) => setPermsText(e.target.value)} placeholder={'CAMERA\nandroid.permission.RECORD_AUDIO'} />
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {COMMON_PERMISSIONS.map(([p, t]) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => !lines(permsText).includes(p) && setPermsText((x) => (x ? `${x.replace(/\n*$/, '')}\n${p}` : p))}
                    className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 cursor-pointer"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={label}>Additional trusted origins (one per line)</label>
                <textarea className={`${input} font-mono h-20`} value={originsText} onChange={(e) => setOriginsText(e.target.value)} placeholder="https://login.partner.com" />
              </div>
              <div>
                <label className={label}>App shortcuts: &quot;Name | /path&quot; (max 4)</label>
                <textarea className={`${input} font-mono h-20`} value={shortcutsText} onChange={(e) => setShortcutsText(e.target.value)} placeholder="Orders | /orders" />
              </div>
              <div>
                <label className={label}>Minimum Android SDK</label>
                <input className={`${input} font-mono`} inputMode="numeric" value={cfg.minSdkVersion} onChange={(e) => set('minSdkVersion', Number(e.target.value.replace(/\D/g, '')) || 21)} />
              </div>
            </div>
            <div className="p-3 rounded bg-slate-950 border border-slate-800 text-slate-400 space-y-1">
              <p className="text-slate-200 font-medium">Repository-level overrides (committed next to your code)</p>
              <p><span className="font-mono text-cyan-300">wybuild/twa.json</span>: any field above, applied last and wins over this form.</p>
              <p><span className="font-mono text-cyan-300">wybuild/android-overrides/</span>: files copied over the generated Android project (res/, AndroidManifest.xml, build.gradle, proguard rules).</p>
              <p><span className="font-mono text-cyan-300">wybuild/twa-patch.sh</span>: a shell hook that runs inside the generated project before building.</p>
            </div>
          </div>
        )}
      </Card>

      <Card icon={<KeyRound className="w-4 h-4 text-cyan-400" />} title="4. Signing and distribution" hint="APKMirror and Uptodown host APK files, so they need an APK signed with your own long-lived release key.">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={label}>Output</label>
            <select className={input} value={cfg.output} onChange={(e) => set('output', e.target.value as TwaConfig['output'])}>
              <option value="both">APK + AAB</option>
              <option value="apk">APK only (mirrors, sideloading)</option>
              <option value="aab">AAB only (Google Play)</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={label}>Expected signing fingerprint (optional)</label>
            <input className={`${input} font-mono`} value={cfg.expectedFingerprint} onChange={(e) => set('expectedFingerprint', e.target.value.trim())} placeholder="SHA-256 of your previous releases; the build fails if the key differs" />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Toggle
            checked={cfg.storeReady}
            onChange={(v) => setCfg((c) => ({ ...c, storeReady: v, useKeystore: v ? true : c.useKeystore }))}
            title="Store-ready mode (APKMirror / Uptodown)"
            desc="Fails the build unless the APK is release-signed (v2/v3), zip-aligned, non-debuggable, uses your key and a real package id."
          />
          <Toggle checked={cfg.useKeystore} disabled={cfg.storeReady} onChange={(v) => set('useKeystore', v)} title="Sign with my release keystore" desc="Off = throw-away test key; the APK can never be updated in place." />
        </div>
        {cfg.useKeystore && repo && !hasKeystore && (
          <div className="p-2.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-200 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              No keystore is stored for {repo}. Upload one first; use the same key for every release.
            </span>
            <button onClick={() => setCurrentTab('settings')} className="underline font-semibold shrink-0 cursor-pointer">
              Open Keystores
            </button>
          </div>
        )}
        <p className="text-slate-500">
          Neither mirror publishes a guarantee: both review uploads by hand and are selective about new or little-known apps. WyBuild makes sure the file is technically sound; it cannot get
          an app accepted.
        </p>
      </Card>

      <Card icon={<Play className="w-4 h-4 text-cyan-400" />} title="5. Build in GitHub Actions" hint="The workflow, helper scripts and your signing secrets live in this repository. It can be your web app's repo or an empty one.">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={label}>Repository</label>
            <input className={`${input} font-mono`} list="wb-twa-repos" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" />
            <datalist id="wb-twa-repos">
              {repos.filter((r) => r.canPush).map((r) => (
                <option key={r.fullName} value={r.fullName} />
              ))}
            </datalist>
          </div>
          <div>
            <label className={label}>Branch</label>
            <input className={`${input} font-mono`} value={branch} onChange={(e) => setBranch(e.target.value)} />
          </div>
        </div>
        {error && (
          <div className="p-2.5 rounded bg-rose-500/10 border border-rose-500/30 text-rose-300 flex items-center gap-2">
            <XCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
        <div className="flex justify-end gap-2.5">
          <button onClick={() => save(false)} className="px-4 py-2 rounded bg-slate-800 text-slate-200 hover:bg-slate-700 flex items-center gap-1.5 cursor-pointer">
            <Save className="w-3.5 h-3.5" />
            {editingId ? 'Update project' : 'Save as project'}
          </button>
          <button onClick={() => save(true)} disabled={!!pending} className="px-4 py-2 rounded bg-cyan-600 hover:bg-cyan-500 text-white font-semibold flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
            {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
            Save &amp; build Android app
          </button>
        </div>
      </Card>
    </div>
  );
};
