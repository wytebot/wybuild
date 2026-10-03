import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { BuildTarget, BuildMode } from '../../types';
import { Github, Plus, X, AlertCircle } from 'lucide-react';

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({ isOpen, onClose }) => {
  const { addProject, subscription, projects, openFlutterwaveCheckout, repos } = useApp();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [target, setTarget] = useState<BuildTarget>('apk');
  const [mode, setMode] = useState<BuildMode>('release');
  const [flutterVersion, setFlutterVersion] = useState('3.29.0');
  const [obfuscate, setObfuscate] = useState(true);
  const [runTests, setRunTests] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  const isPro = subscription.plan === 'pro';
  const isAtLimit = !isPro && projects.length >= 10;

  const presetRepos = [
    { name: 'finflow-labs/mobile-wallet', desc: 'Fintech mobile app with biometrics' },
    { name: 'flutter-community/sample-ecommerce', desc: 'Cross-platform online store' },
    { name: 'developer/crypto-portfolio', desc: 'Live price tracker with WebSockets' },
  ];

  const handleSelectPreset = (presetName: string, desc: string) => {
    setName(presetName.split('/')[1].replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()));
    setDescription(desc);
    setRepoUrl(`https://github.com/${presetName}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (isAtLimit) {
      setErrorMsg('Free tier limit reached (10/10 projects). Upgrade to Pro for unlimited project integration.');
      return;
    }

    if (!name || !repoUrl) {
      setErrorMsg('Please enter both project name and repository URL.');
      return;
    }

    const res = addProject({
      name,
      description: description || 'Flutter mobile project',
      repoUrl,
      branch,
      config: {
        target,
        mode,
        flutterVersion,
        dartDefines: [],
        obfuscate,
        splitDebugInfo: obfuscate,
        runTests,
        customArgs: '',
      },
    });

    if (res.success) {
      onClose();
    } else if (res.error) {
      setErrorMsg(res.error);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-800 rounded-t-2xl sm:rounded-xl p-4 sm:p-6 max-w-xl w-full max-h-[92dvh] overflow-y-auto overscroll-contain space-y-5 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Github className="w-5 h-5 text-cyan-400" />
            <h2 className="text-base font-bold text-white">Connect GitHub Repository</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isAtLimit && (
          <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>Free tier limit reached (10/10 projects).</span>
            </div>
            <button
              onClick={() => {
                onClose();
                openFlutterwaveCheckout('monthly');
              }}
              className="text-amber-300 font-bold underline cursor-pointer"
            >
              Upgrade to Pro ($10/mo)
            </button>
          </div>
        )}

        {/* Quick presets */}
        <div>
          <span className="text-[11px] font-mono uppercase text-slate-400 block mb-2">
            Quick Connect Presets:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {presetRepos.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => handleSelectPreset(p.name, p.desc)}
                className="p-2.5 rounded bg-slate-950 border border-slate-800 hover:border-cyan-500/50 text-left transition text-xs cursor-pointer"
              >
                <p className="font-semibold text-white break-words">{p.name.split('/')[1]}</p>
                <p className="text-[10px] text-slate-400 break-words mt-0.5">{p.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 mb-1 font-medium">Project Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. FinTrack Mobile"
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-slate-300 mb-1 font-medium">GitHub Repository URL</label>
            <input
              type="text"
              required
              list="wb-repos"
              value={repoUrl}
              onChange={(e) => {
                setRepoUrl(e.target.value);
                const hit = repos.find((r) => r.fullName === e.target.value.trim());
                if (hit) setBranch(hit.defaultBranch);
              }}
              placeholder="owner/repo or https://github.com/owner/repo"
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
            />
            <datalist id="wb-repos">
              {repos.map((r) => (
                <option key={r.fullName} value={r.fullName} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 mb-1 font-medium">Default Branch</label>
              <input
                type="text"
                required
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 mb-1 font-medium">Flutter SDK Channel</label>
              <select
                value={flutterVersion}
                onChange={(e) => setFlutterVersion(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="3.29.0">Flutter 3.29.0 (Stable)</option>
                <option value="3.27.4">Flutter 3.27.4 (Stable)</option>
                <option value="3.24.5">Flutter 3.24.5 (LTS)</option>
                <option value="beta">Flutter Beta</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 mb-1 font-medium">Target Binary Format</label>
              <select
                value={target}
                onChange={(e) => setTarget(e.target.value as BuildTarget)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="apk">Android APK (Universal)</option>
                <option value="split-per-abi">Split APK per ABI (arm64/v7a)</option>
                <option value="appbundle">Android App Bundle (.aab)</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-300 mb-1 font-medium">Build Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as BuildMode)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
              >
                <option value="release">Release (Production)</option>
                <option value="debug">Debug (Fast Unsigned)</option>
                <option value="profile">Profile (Benchmark)</option>
              </select>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={obfuscate}
                onChange={(e) => setObfuscate(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-cyan-600 focus:ring-0"
              />
              <span className="text-slate-300">Enable R8 & ProGuard code obfuscation</span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={runTests}
                onChange={(e) => setRunTests(e.target.checked)}
                className="rounded bg-slate-950 border-slate-700 text-cyan-600 focus:ring-0"
              />
              <span className="text-slate-300">Run automated unit & widget tests before compile</span>
            </label>
          </div>

          {errorMsg && <p className="text-xs text-rose-400">{errorMsg}</p>}

          <div className="pt-4 border-t border-slate-800 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isAtLimit}
              className="px-4 py-2 font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-sm"
            >
              <Plus className="w-4 h-4" />
              <span>Connect & Save Project</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
