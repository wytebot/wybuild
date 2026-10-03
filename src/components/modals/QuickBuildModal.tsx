import React, { useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Play, X, Zap, GitBranch, AlertCircle } from 'lucide-react';

interface QuickBuildModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QuickBuildModal: React.FC<QuickBuildModalProps> = ({ isOpen, onClose }) => {
  const { projects, triggerBuild, subscription, rateLimits, openFlutterwaveCheckout } = useApp();
  const [selectedProjectId, setSelectedProjectId] = useState<string>(projects[0]?.id || '');
  const [branchOverride, setBranchOverride] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const isPro = subscription.plan === 'pro';
  const selectedProj = projects.find((p) => p.id === selectedProjectId) || projects[0];

  const handleTrigger = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProj) return;

    setIsSubmitting(true);
    const res = await triggerBuild(selectedProj.id, branchOverride || selectedProj.branch);
    setIsSubmitting(false);

    if (res.success) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full space-y-5 shadow-2xl">
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Play className="w-4 h-4 text-emerald-400 fill-emerald-400" />
            <h2 className="text-base font-bold text-white">Trigger Cloud CI/CD Pipeline</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Rate limit warning if on Free tier */}
        {!isPro ? (
          <div className="p-3 rounded bg-slate-950 border border-slate-800 text-xs flex items-center justify-between">
            <span className="text-slate-400">Monthly Successful Builds:</span>
            <span className="font-mono text-cyan-400 font-bold">
              {rateLimits.monthlyBuildsUsed} of {rateLimits.monthlyLimit} builds used
            </span>
          </div>
        ) : (
          <div className="p-3 rounded bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400 fill-amber-400" />
            <span>Dedicated Priority Server · Zero Queue Wait</span>
          </div>
        )}

        <form onSubmit={handleTrigger} className="space-y-4 text-xs">
          <div>
            <label className="block text-slate-300 font-medium mb-1">Select Target Project</label>
            <select
              value={selectedProjectId}
              onChange={(e) => {
                setSelectedProjectId(e.target.value);
                setBranchOverride('');
              }}
              className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-medium focus:border-cyan-500 focus:outline-none"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.branch})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-slate-300 font-medium mb-1">Branch / Tag (Optional Override)</label>
            <div className="relative">
              <GitBranch className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder={selectedProj?.branch || 'main'}
                value={branchOverride}
                onChange={(e) => setBranchOverride(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded pl-8 pr-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {selectedProj && (
            <div className="p-3 rounded bg-slate-950 border border-slate-800/80 space-y-1 text-slate-400 font-mono text-[11px]">
              <div className="flex justify-between">
                <span>Output target:</span>
                <span className="text-white font-semibold uppercase">{selectedProj.config.target}</span>
              </div>
              <div className="flex justify-between">
                <span>Flutter version:</span>
                <span className="text-white">v{selectedProj.config.flutterVersion}</span>
              </div>
              <div className="flex justify-between">
                <span>Mode:</span>
                <span className="text-white uppercase">{selectedProj.config.mode}</span>
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-800 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5 fill-white" />
              <span>{isSubmitting ? 'Starting Runner...' : 'Start Build Now'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
