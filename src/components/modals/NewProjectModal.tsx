import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { RepoPicker } from '../RepoPicker';
import { AlertCircle, X } from 'lucide-react';

interface Props { isOpen: boolean; onClose: () => void; }

/** Pick a repo from the list. One tap discovers it and opens the right screen. */
export const NewProjectModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const { openRepo } = useApp();
  const [busyRepo, setBusyRepo] = useState('');
  const [error, setError] = useState('');
  if (!isOpen) return null;

  const pick = async (repo: string) => {
    setBusyRepo(repo);
    setError('');
    const r = await openRepo(repo);
    setBusyRepo('');
    if (r.ok) onClose();
    else setError(r.error || 'Could not open that repository.');
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center">
      <div className="w-full sm:max-w-lg max-h-[94dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-[#07100d] border border-emerald-400/15 p-5 space-y-4 shadow-2xl">
        <div className="flex justify-between items-center">
          <div><h2 className="font-bold text-white">Choose a repository</h2><p className="text-xs text-slate-500 mt-1">Tap one. WyBuild discovers everything else.</p></div>
          <button onClick={onClose} className="p-2 text-slate-400" aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <RepoPicker onPick={pick} busyRepo={busyRepo} />
        {error && <div className="flex gap-2 text-xs text-rose-300 p-3 rounded-lg bg-rose-500/[.06] border border-rose-500/20"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
      </div>
    </div>
  );
};
