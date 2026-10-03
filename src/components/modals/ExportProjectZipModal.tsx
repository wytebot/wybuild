import React, { useState } from 'react';
import {
  Download,
  X,
  Plus,
  Trash2,
  FileCode,
  Check,
  FolderArchive,
  Terminal,
  Sparkles,
  Loader2,
} from 'lucide-react';
import { generateFlutterProjectZip, FlutterEnvVariable } from '../../services/projectZipExporter';

interface ExportProjectZipModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportProjectZipModal: React.FC<ExportProjectZipModalProps> = ({ isOpen, onClose }) => {
  const [appName, setAppName] = useState('FinTrack Mobile');
  const [packageName, setPackageName] = useState('com.example.fintrack');
  const [target, setTarget] = useState<'apk' | 'appbundle' | 'split-per-abi'>('apk');
  const [enableObfuscation, setEnableObfuscation] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const [envVars, setEnvVars] = useState<FlutterEnvVariable[]>([
    { key: 'API_BASE_URL', value: 'https://api.fintrack.io/v2' },
    { key: 'APP_ENV', value: 'production' },
    { key: 'FLUTTERWAVE_PUBLIC_KEY', value: 'FLWPUBK_TEST-938b8120e98129038a83-X' },
    { key: 'API_TIMEOUT_SECONDS', value: '30' },
    { key: 'ENABLE_BIOMETRICS', value: 'true' },
  ]);

  const [newKey, setNewKey] = useState('');
  const [newVal, setNewVal] = useState('');

  if (!isOpen) return null;

  const handleAddEnvVar = () => {
    if (!newKey.trim()) return;
    const formattedKey = newKey.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    setEnvVars([...envVars, { key: formattedKey, value: newVal.trim() }]);
    setNewKey('');
    setNewVal('');
  };

  const handleRemoveEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const handleUpdateEnvVar = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...envVars];
    updated[index] = { ...updated[index], [field]: value };
    setEnvVars(updated);
  };

  const handleDownloadZip = async () => {
    setIsExporting(true);
    setDownloadSuccess(false);

    try {
      const zipBlob = await generateFlutterProjectZip({
        appName,
        packageName,
        envVariables: envVars,
        target,
        enableObfuscation,
      });

      const fileName = `${appName.toLowerCase().replace(/[^a-z0-9]/g, '_')}_flutter_project.zip`;
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);

      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 4000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between sticky top-0 bg-slate-900/95 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Export Flutter Project with Environment Variables</h2>
              <p className="text-xs text-slate-400">
                Download a complete, runnable Flutter app zip bundle configured for APK generation.
              </p>
            </div>
          </div>

          <button onClick={onClose} className="text-slate-400 hover:text-white cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6 text-xs">
          {/* Project Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-medium mb-1">App Name</label>
              <input
                type="text"
                value={appName}
                onChange={(e) => setAppName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-medium focus:border-cyan-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-medium mb-1">Android Package Name (namespace) <span className="text-[9px] text-emerald-400 font-mono ml-1">FREE</span></label>
              <input
                type="text"
                value={packageName}
                onChange={(e) => setPackageName(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white font-mono focus:border-cyan-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Environment Variables Manager */}
          <div className="p-4 rounded-lg bg-slate-950 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                  Environment Variables (.env & --dart-define)
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  These variables will be embedded into <code className="text-cyan-400">.env</code> and <code className="text-cyan-400">lib/env_config.dart</code>.
                </p>
              </div>
              <span className="text-[11px] font-mono text-cyan-400 font-semibold">{envVars.length} variables</span>
            </div>

            {/* Variable Rows */}
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {envVars.map((v, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={v.key}
                    onChange={(e) => handleUpdateEnvVar(idx, 'key', e.target.value)}
                    placeholder="KEY"
                    className="w-2/5 bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono text-[11px] focus:border-cyan-500 focus:outline-none"
                  />
                  <span className="text-slate-500 font-mono">=</span>
                  <input
                    type="text"
                    value={v.value}
                    onChange={(e) => handleUpdateEnvVar(idx, 'value', e.target.value)}
                    placeholder="VALUE"
                    className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono text-[11px] focus:border-cyan-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveEnvVar(idx)}
                    className="p-1.5 text-slate-500 hover:text-rose-400 transition cursor-pointer"
                    title="Remove variable"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add New Variable */}
            <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="ADD_NEW_KEY"
                className="w-2/5 bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono text-[11px] uppercase focus:border-cyan-500 focus:outline-none"
              />
              <span className="text-slate-500 font-mono">=</span>
              <input
                type="text"
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                placeholder="Value..."
                className="flex-1 bg-slate-900 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono text-[11px] focus:border-cyan-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddEnvVar}
                className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 font-semibold flex items-center gap-1 transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>
          </div>

          {/* Build Command Preview */}
          <div className="space-y-2">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-emerald-400" />
              <span>How To Generate APK With These Variables</span>
            </h3>
            <pre className="p-3 bg-slate-950 border border-slate-800 rounded font-mono text-[11px] text-cyan-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
{`# 1. Unzip the downloaded folder and install packages:
flutter pub get

# 2. Build release APK using .env file:
flutter build apk --release

# 3. Or pass variables directly at compile time (--dart-define):
flutter build apk --release \\
${envVars.map((v) => `  --dart-define=${v.key}="${v.value}" \\`).join('\n')}`}
            </pre>
          </div>

          {/* Download Success Notice */}
          {downloadSuccess && (
            <div className="p-3 rounded bg-emerald-950/40 border border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Project zip downloaded successfully! Extract it, customize .env, and run flutter build apk.</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/95 sticky bottom-0 flex items-center justify-between">
          <div className="text-slate-400 text-xs">
            Includes <code className="text-slate-200">pubspec.yaml</code>, <code className="text-slate-200">.env</code>, <code className="text-slate-200">build.gradle</code>, and <code className="text-slate-200">BUILD_APK_GUIDE.md</code>.
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 transition cursor-pointer"
            >
              Close
            </button>

            <button
              onClick={handleDownloadZip}
              disabled={isExporting}
              className="px-5 py-2 font-bold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-2 shadow-lg cursor-pointer disabled:opacity-50"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Packaging .zip...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Flutter Project (.zip)</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
