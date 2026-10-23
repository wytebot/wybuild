import React, { useState } from 'react';
import { useApp } from '../context/AppContext';

interface Props {
  /** repos the key can be attached to; when only one is given it is fixed */
  repos: string[];
  defaultRepo?: string;
  onDone: (repo: string) => void;
  onCancel?: () => void;
}

const field = 'w-full h-11 px-3 rounded-lg bg-black/30 border border-white/10 text-white';

export const KeystoreForm: React.FC<Props> = ({ repos, defaultRepo, onDone, onCancel }) => {
  const { addKeystore } = useApp();
  const [repo, setRepo] = useState(defaultRepo && repos.includes(defaultRepo) ? defaultRepo : repos[0] || '');
  const [name, setName] = useState('');
  const [alias, setAlias] = useState('');
  const [storePassword, setStorePassword] = useState('');
  const [keyPassword, setKeyPassword] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repo || !alias || !file) return;
    setSaving(true);
    const ok = await addKeystore({ repo, name: name || `${repo} signing key`, alias, storePassword, keyPassword: keyPassword || storePassword, file });
    setSaving(false);
    if (ok) onDone(repo);
  };

  return (
    <form onSubmit={save} className="space-y-3">
      {repos.length > 1 && (
        <select required value={repo} onChange={(e) => setRepo(e.target.value)} className={field}>
          {repos.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      )}
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name (optional)" className={field} />
      <input required value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="Alias" className={`${field} font-mono`} />
      <input required type="file" accept=".jks,.keystore,.p12" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm text-slate-400" />
      <input required type="password" value={storePassword} onChange={(e) => setStorePassword(e.target.value)} placeholder="Store password" className={field} />
      <input type="password" value={keyPassword} onChange={(e) => setKeyPassword(e.target.value)} placeholder="Key password (optional)" className={field} />
      <div className="flex gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="flex-1 h-11 rounded-lg border border-white/10 text-slate-300">Cancel</button>}
        <button disabled={saving || !repo} type="submit" className="flex-1 h-11 rounded-lg bg-emerald-400 text-black font-bold disabled:opacity-50">{saving ? 'Saving…' : 'Save key'}</button>
      </div>
    </form>
  );
};
