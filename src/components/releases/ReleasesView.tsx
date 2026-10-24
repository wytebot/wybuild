import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api, ReleasePrep, ReleaseResult } from '../../services/api';
import { ReleaseHandoff, peekReleaseHandoff, clearReleaseHandoff } from '../../services/releaseHandoff';
import { AlertTriangle, CheckCircle2, ExternalLink, FileCode, Github, Loader2, RefreshCw, Rocket, Tag } from 'lucide-react';
import { Select } from '../ui/Select';
import { ComboInput } from '../ui/ComboInput';

const input = 'w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500/60';
const mb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export const ReleasesView: React.FC = () => {
  const { builds } = useApp();
  const candidates = useMemo(() => builds.filter((b) => b.status === 'success' && (b.kind === 'twa' || !!b.twa) && !!b.repo), [builds]);
  const [buildId, setBuildId] = useState('');
  const [artifactId, setArtifactId] = useState<number | null>(null);
  const [prep, setPrep] = useState<ReleasePrep | null>(null);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ReleaseResult | null>(null);
  const [tag, setTag] = useState('');
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [prerelease, setPrerelease] = useState(false);
  const [draft, setDraft] = useState(false);
  const handoff = useRef<ReleaseHandoff | null>(peekReleaseHandoff());
  const seq = useRef(0);

  const build = candidates.find((b) => b.id === buildId);

  const load = useCallback(async (id: string, wantArtifact?: number) => {
    const b = candidates.find((x) => x.id === id);
    if (!b?.repo) return;
    const my = ++seq.current;
    setLoading(true); setError(''); setResult(null); setPrep(null); setArtifactId(null);
    try {
      let artId = wantArtifact;
      if (!artId) {
        const detail = await api.run(b.repo, b.id);
        const available = Array.isArray(detail?.artifacts) ? detail.artifacts : [];
        // Prefer the canonical WyBuild TWA artifact, not an unrelated/expired artifact from the same run.
        artId = available.find((a) => !!a?.id && /^wb-twa-/i.test(a.name || ''))?.id
          ?? available.find((a) => !!a?.id)?.id;
        if (!artId) throw new Error('GitHub did not return a downloadable artifact for this build. It may have expired or artifact access may be unavailable. Run the build again, then retry.');
      }
      const response = await api.releasePrepare(b.repo, artId);
      if (my !== seq.current) return;
      if (!response || !Array.isArray(response.files)) {
        throw new Error('GitHub returned an incomplete release-preparation response. Reload the page and retry; no release has been published.');
      }
      const files = response.files
        .filter((f) => f && typeof f.name === 'string' && /\.(apk|aab)$/i.test(f.name))
        .map((f) => ({
          name: f.name,
          size: Number.isFinite(Number(f.size)) ? Number(f.size) : 0,
          kind: f.kind === 'aab' || /\.aab$/i.test(f.name) ? 'aab' as const : 'apk' as const,
          sha256: String(f.sha256 || ''),
        }));
      if (!files.length) throw new Error('This artifact does not contain a readable APK or AAB. Choose another build artifact or run the build again.');
      const p: ReleasePrep = {
        ...response,
        files,
        packageId: String(response.packageId || ''),
        versionName: String(response.versionName || ''),
        versionCode: String(response.versionCode || ''),
        tag: String(response.tag || `build-${b.id}`),
        name: String(response.name || response.tag || `Build ${b.id}`),
        notes: String(response.notes || ''),
        notesSource: response.notesSource === 'github' ? 'github' : 'fallback',
        target: {
          sha: String(response.target?.sha || b.commitHash || ''),
          branch: String(response.target?.branch || b.branch || ''),
        },
        canPush: response.canPush !== false,
        releaseExists: !!response.releaseExists,
        tagExists: !!response.tagExists,
      };
      setArtifactId(artId); setPrep(p);
      setTag(p.tag); setTitle(p.name); setNotes(p.notes);
      setPicked(new Set(p.files.map((f) => f.name)));
      setPrerelease(false); setDraft(false);
    } catch (e: any) {
      if (my === seq.current) setError(e instanceof Error ? e.message : 'Could not read the build artifact.');
    } finally { if (my === seq.current) setLoading(false); }
  }, [candidates]);

  // arriving from the Logs page: preselect that build and artifact
  useEffect(() => {
    const h = handoff.current;
    if (h && candidates.some((b) => b.id === h.buildId)) {
      handoff.current = null;
      clearReleaseHandoff();
      setBuildId(h.buildId);
      void load(h.buildId, h.artifactId);
    }
  }, [candidates, load]);

  // never let an unused handoff leak into a later visit
  useEffect(() => () => clearReleaseHandoff(), []);

  // otherwise default to the newest successful build
  useEffect(() => {
    if (!buildId && !handoff.current && candidates.length) {
      setBuildId(candidates[0].id);
      void load(candidates[0].id);
    }
  }, [candidates, buildId, load]);

  const publish = async () => {
    if (!build?.repo || !artifactId || !prep) return;
    setPublishing(true); setError('');
    try {
      setResult(await api.releasePublish({ repo: build.repo, artifactId, tag: tag.trim(), name: title.trim(), body: notes, files: [...picked], prerelease, draft }));
    } catch (e: any) { setError(e instanceof Error ? e.message : 'Publishing failed.'); }
    finally { setPublishing(false); }
  };

  const blocked = !prep || prep.releaseExists || !prep.canPush || !tag.trim() || !picked.size || publishing;

  return (
    <div className="min-h-full p-4 md:p-8 pb-10">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2"><Rocket className="w-5 h-5 text-emerald-300" /> Release to GitHub</h1>
          <p className="text-sm text-slate-400 mt-1">Pick a finished build. WyBuild unpacks the artifact, finds the APK/AAB, drafts the tag and release notes, and publishes them to your repository's Releases page.</p>
        </div>

        {!candidates.length && <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-400">No successful Web → Android builds yet. Finish a build first, then come back here.</div>}

        {candidates.length > 0 && (
          <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 space-y-2">
            <label className="text-xs text-slate-500">Build</label>
            <div className="flex gap-2">
              <div className="flex-1 min-w-0">
                <Select
                  title="Choose a build"
                  className={input}
                  value={buildId}
                  onChange={(v) => { setBuildId(v); void load(v); }}
                  options={candidates.map((b) => ({ value: b.id, label: `${b.repo} · ${b.twa?.packageId || b.branch}`, hint: `${b.commitHash} · ${new Date(b.startedAt).toLocaleDateString()}` }))}
                />
              </div>
              <button onClick={() => buildId && load(buildId, artifactId ?? undefined)} title="Reload" className="px-3 rounded-lg border border-slate-800 text-slate-300 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
            </div>
          </div>
        )}

        {loading && <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-300 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Unpacking the artifact and preparing release notes…</div>}

        {error && <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-200 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /><span className="break-words">{error}</span></div>}

        {prep && !result && (
          <div className="p-5 rounded-lg bg-slate-950 border border-slate-800 space-y-5">
            <div>
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 mb-2">Files found in the artifact</h3>
              <div className="space-y-2">
                {prep.files.map((f) => (
                  <label key={f.name} className="flex items-center gap-3 p-3 rounded bg-slate-900 border border-slate-800 text-xs cursor-pointer">
                    <input type="checkbox" checked={picked.has(f.name)} onChange={(e) => setPicked((prev) => { const n = new Set(prev); e.target.checked ? n.add(f.name) : n.delete(f.name); return n; })} className="accent-emerald-500" />
                    <FileCode className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-white break-all">{f.name}</span>
                      <span className="block text-[11px] text-slate-500 font-mono">{f.kind.toUpperCase()} · {mb(f.size)} · SHA-256 {(f.sha256 || '').slice(0, 16)}{f.sha256 ? '…' : 'not provided'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 flex items-center gap-1"><Tag className="w-3 h-3" /> Tag</label>
                <ComboInput className={input} value={tag} onChange={setTag} suggestions={prep.tagSuggestions || []} placeholder="v1.0.0" />
                {(prep.tagSuggestions || []).length > 0 && <p className="text-[11px] text-slate-500 mt-1">Suggestions from existing repository tags. Choose a new version tag to create a new release.</p>}
                <p className="text-[11px] text-slate-500 mt-1">Created on commit {(prep.target?.sha || '').slice(0, 7) || 'unknown commit'} ({prep.target?.branch || 'unknown branch'}){prep.previousTag ? ` · previous release ${prep.previousTag}` : ''}</p>
              </div>
              <div>
                <label className="text-xs text-slate-500">Release title</label>
                <input className={input} value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
            </div>

            {prep.releaseExists && <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">A release for <b>{tag || prep.tag}</b> already exists{prep.existingReleaseUrl && <> (<a className="underline" href={prep.existingReleaseUrl} target="_blank" rel="noopener noreferrer">view</a>)</>}. Change the tag to publish a new one.</div>}
            {!prep.canPush && <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-200">Your GitHub account cannot create releases in this repository.</div>}

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-slate-500">Release notes {prep.notesSource === 'github' ? '(generated from commits and pull requests)' : ''}</label>
                <button onClick={() => build && load(build.id, artifactId ?? undefined)} className="text-[11px] text-emerald-400 hover:text-emerald-300">Regenerate</button>
              </div>
              <textarea className={`${input} font-mono text-xs h-64`} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            <div className="flex flex-wrap gap-4 text-xs text-slate-300">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-emerald-500" checked={prerelease} onChange={(e) => setPrerelease(e.target.checked)} /> Mark as pre-release</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-emerald-500" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Save as draft (do not publish yet)</label>
            </div>

            <button onClick={publish} disabled={blocked} className="w-full min-h-11 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold flex items-center justify-center gap-2">
              {publishing ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading to GitHub…</> : <><Github className="w-4 h-4" /> {draft ? 'Save draft release' : `Publish ${tag || 'release'}`}</>}
            </button>
            <p className="text-[11px] text-slate-500">Files are uploaded to a draft first and the release goes public only after every upload succeeds.</p>
          </div>
        )}

        {result && (
          <div className="p-5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-3">
            <div className="flex items-center gap-2 text-emerald-200 font-semibold"><CheckCircle2 className="w-5 h-5" /> {result.draft ? 'Draft saved' : 'Release published'}: {result.tag}</div>
            <ul className="text-xs text-slate-300 space-y-1">
              {(Array.isArray(result.assets) ? result.assets : []).map((a) => <li key={a.name} className="font-mono break-all">{a.name} · {mb(a.size)}</li>)}
            </ul>
            <a href={result.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold"><ExternalLink className="w-4 h-4" /> Open on GitHub</a>
          </div>
        )}
      </div>
    </div>
  );
};
