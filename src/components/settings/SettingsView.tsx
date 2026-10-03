import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { GitHubWebhooksSection } from './GitHubWebhooksSection';
import { repoFromUrl } from '../../services/api';
import {
  Key,
  Plus,
  Trash2,
  CheckCircle2,
  ShieldCheck,
  CreditCard,
  Github,
  Server,
  Save,
  RotateCw,
  Webhook,
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { keystores, addKeystore, deleteKeystore, projects, user, logout } = useApp();
  const [activeSection, setActiveSection] = useState<'webhooks' | 'keystores'>('webhooks');
  const [showAddKeystore, setShowAddKeystore] = useState(false);
  const [newKsName, setNewKsName] = useState('');
  const [newKsAlias, setNewKsAlias] = useState('');
  const [newKsRepo, setNewKsRepo] = useState('');
  const [newKsKeyPassword, setNewKsKeyPassword] = useState('');
  const [newKsPassword, setNewKsPassword] = useState('');
  const [newKsFile, setNewKsFile] = useState<File | null>(null);
  const [savingKs, setSavingKs] = useState(false);

  const projectRepos = Array.from(new Set(projects.map((p) => repoFromUrl(p.repoUrl)).filter((r): r is string => !!r)));

  const handleSaveKeystore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKsName || !newKsAlias || !newKsRepo || !newKsFile) return;
    setSavingKs(true);
    const ok = await addKeystore({
      repo: newKsRepo,
      name: newKsName,
      alias: newKsAlias,
      storePassword: newKsPassword,
      keyPassword: newKsKeyPassword || newKsPassword,
      file: newKsFile,
    });
    setSavingKs(false);
    if (!ok) return;
    setNewKsName('');
    setNewKsAlias('');
    setNewKsPassword('');
    setNewKsKeyPassword('');
    setNewKsFile(null);
    setShowAddKeystore(false);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="pb-6 border-b border-slate-800">
        <h1 className="text-2xl font-bold tracking-tight text-white">Settings & Credentials</h1>
        <p className="text-sm text-slate-400 mt-1">
          Android release keystores are stored in your repository as encrypted GitHub Actions secrets.
        </p>
        {user && (
          <p className="text-xs text-slate-500 mt-2">
            Signed in as <span className="text-slate-300 font-mono">{user.login}</span> ·{' '}
            <button onClick={logout} className="text-cyan-400 hover:text-cyan-300 cursor-pointer">Sign out</button>
          </p>
        )}

        {/* Section Tabs */}
        <div className="flex flex-wrap gap-2 mt-5">
          <button
            onClick={() => setActiveSection('webhooks')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeSection === 'webhooks'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Webhook className="w-4 h-4" />
            <span>GitHub Webhooks & Push Automation</span>
          </button>

          <button
            onClick={() => setActiveSection('keystores')}
            className={`flex items-center gap-2 px-3.5 py-2 rounded-md text-xs font-semibold transition cursor-pointer ${
              activeSection === 'keystores'
                ? 'bg-cyan-600 text-white shadow-sm'
                : 'bg-slate-900 border border-slate-800 text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Key className="w-4 h-4" />
            <span>Android Signing Keystores ({keystores.length})</span>
          </button>

        </div>
      </div>

      {/* SECTION 1: GITHUB WEBHOOKS */}
      {activeSection === 'webhooks' && <GitHubWebhooksSection />}

      {/* SECTION 2: KEYSTORE MANAGEMENT */}
      {activeSection === 'keystores' && (
      <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Key className="w-4 h-4 text-cyan-400" />
              <span>Android Signing Keystores (.jks)</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Securely inject release keystore credentials into cloud runners for APK and AAB signing.
            </p>
          </div>

          <button
            onClick={() => setShowAddKeystore(true)}
            className="px-3.5 py-1.5 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-1.5 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Add Keystore</span>
          </button>
        </div>

        <div className="space-y-3">
          {keystores.map((k) => (
            <div
              key={k.id}
              className="p-4 rounded bg-slate-950 border border-slate-800 flex items-center justify-between text-xs"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-white text-sm">{k.name}</span>
                  {k.isDefault && (
                    <span className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-slate-400 font-mono space-x-3 text-[11px]">
                  <span>Alias: <strong className="text-slate-200">{k.alias}</strong></span>
                  <span>·</span>
                  <span>Validity: {k.validityYears} years</span>
                </div>
                <div className="text-slate-500 font-mono text-[10px] truncate max-w-xl">
                  {k.fingerprintSha256}
                </div>
              </div>

              <div>
                <button
                  onClick={() => deleteKeystore(k.id)}
                  className="p-1.5 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition cursor-pointer"
                  title="Delete Keystore"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}

      {/* Modal: Add Keystore */}
      {showAddKeystore && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full space-y-4 shadow-2xl">
            <h3 className="text-base font-bold text-white">Upload / Register Release Keystore</h3>

            <form onSubmit={handleSaveKeystore} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1">Keystore Profile Name</label>
                <input
                  type="text"
                  required
                  value={newKsName}
                  onChange={(e) => setNewKsName(e.target.value)}
                  placeholder="e.g. Google Play Production Key"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Key Alias</label>
                <input
                  type="text"
                  required
                  value={newKsAlias}
                  onChange={(e) => setNewKsAlias(e.target.value)}
                  placeholder="e.g. key0 or release"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Repository</label>
                <select
                  required
                  value={newKsRepo}
                  onChange={(e) => setNewKsRepo(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                >
                  <option value="">Select a project repository</option>
                  {projectRepos.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Keystore file (.jks / .keystore)</label>
                <input
                  type="file"
                  required
                  accept=".jks,.keystore,.p12"
                  onChange={(e) => setNewKsFile(e.target.files?.[0] ?? null)}
                  className="w-full text-slate-300"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Store password</label>
                <input
                  type="password"
                  required
                  value={newKsPassword}
                  onChange={(e) => setNewKsPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Key password (blank = same as store)</label>
                <input
                  type="password"
                  value={newKsKeyPassword}
                  onChange={(e) => setNewKsKeyPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
                />
              </div>

              <div className="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowAddKeystore(false)}
                  className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition cursor-pointer"
                >
                  {savingKs ? 'Saving...' : 'Save Keystore'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
