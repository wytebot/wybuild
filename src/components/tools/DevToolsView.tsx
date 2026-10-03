import React, { useState, useRef, useEffect } from 'react';
import {
  Wrench,
  Image as ImageIcon,
  FileCode,
  ShieldCheck,
  Key,
  Download,
  Copy,
  Check,
  Sparkles,
  Layers,
  AlertTriangle,
  Github,
  FolderArchive,
} from 'lucide-react';
import { generateAndroidIconZip } from '../../services/iconGenerator';
import {
  analyzePubspec,
  analyzeAndroidManifest,
  generateKeystoreCommand,
  generateProGuardRules,
  generateGitHubActionsWorkflow,
} from '../../services/analyzer';

interface DevToolsViewProps {
  onOpenExportZip?: () => void;
}

export const DevToolsView: React.FC<DevToolsViewProps> = ({ onOpenExportZip }) => {
  const [activeTool, setActiveTool] = useState<
    'icon' | 'pubspec' | 'manifest' | 'keystore' | 'proguard' | 'github_actions'
  >('icon');

  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const tool = (event as CustomEvent<{ tool?: typeof activeTool }>).detail?.tool;
      if (tool) setActiveTool(tool);
    };
    window.addEventListener('wybuild:tool-open', handler);
    return () => window.removeEventListener('wybuild:tool-open', handler);
  }, []);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // --- Tool 1: Icon Generator State ---
  const [iconBgColor, setIconBgColor] = useState('#0284c7');
  const [iconPadding, setIconPadding] = useState(10);
  const [iconRounded, setIconRounded] = useState(false);
  const [isGeneratingIcon, setIsGeneratingIcon] = useState(false);
  const [iconSuccessMsg, setIconSuccessMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const handleIconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setPreviewSrc(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateIcons = async () => {
    setIsGeneratingIcon(true);
    setIconSuccessMsg(null);

    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src =
        previewSrc ||
        'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="20" fill="%230284c7"/><path d="M25 50 L50 25 L75 50 L50 75 Z" fill="%23ffffff"/></svg>';

      await new Promise((resolve) => {
        img.onload = resolve;
      });

      const { zipBlob, fileCount } = await generateAndroidIconZip(
        img,
        iconPadding,
        iconBgColor,
        iconRounded
      );

      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'flutter-android-icons.zip';
      a.click();
      URL.revokeObjectURL(url);

      setIconSuccessMsg(`Successfully generated and downloaded ${fileCount} Android icon assets (.zip)!`);
    } catch (err) {
      console.error(err);
      setIconSuccessMsg('Icon generation failed. Please check image.');
    } finally {
      setIsGeneratingIcon(false);
    }
  };

  // --- Tool 2: Pubspec Analyzer State ---
  const [pubspecText, setPubspecText] = useState(`name: my_flutter_app
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: '>=3.2.0 <4.0.0'

dependencies:
  flutter:
    sdk: flutter
  flutter_bloc: ^8.1.6
  dio: any
  shared_preferences: ^2.2.3
  google_fonts: ^6.2.1

dev_dependencies:
  flutter_test:
    sdk: flutter
  flutter_lints: ^4.0.0
`);
  const pubspecResult = analyzePubspec(pubspecText);

  // --- Tool 3: AndroidManifest Inspector State ---
  const [manifestText, setManifestText] = useState(`<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.example.flutterapp">

    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.CAMERA"/>
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
    <uses-permission android:name="android.permission.MANAGE_EXTERNAL_STORAGE"/>

    <application
        android:label="My App"
        android:allowBackup="true"
        android:usesCleartextTraffic="false">
    </application>
</manifest>`);
  const manifestResult = analyzeAndroidManifest(manifestText);

  // --- Tool 4: Keystore Generator State ---
  const [keystoreParams, setKeystoreParams] = useState({
    keystoreName: 'upload-keystore',
    alias: 'upload',
    validityYears: 25,
    commonName: 'Ilemobayo Tolulope',
    organization: 'FinFlow Tech',
    city: 'Lagos',
    state: 'Lagos',
    countryCode: 'NG',
  });
  const keystoreOutput = generateKeystoreCommand(keystoreParams);

  // --- Tool 5: ProGuard Builder State ---
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([
    'firebase',
    'sqflite',
    'flutterwave',
    'webview',
  ]);
  const proGuardRules = generateProGuardRules(selectedPlugins);

  // --- Tool 6: GitHub Actions Exporter ---
  const ghWorkflow = generateGitHubActionsWorkflow('My Flutter App', '3.29.0');

  const tools = [
    { id: 'icon', label: 'App Icon Generator', icon: ImageIcon },
    { id: 'pubspec', label: 'Pubspec Linter', icon: FileCode },
    { id: 'manifest', label: 'Manifest & Permissions', icon: ShieldCheck },
    { id: 'keystore', label: 'Keystore Command Helper', icon: Key },
    { id: 'proguard', label: 'ProGuard/R8 Rules', icon: Layers },
    { id: 'github_actions', label: 'GitHub Actions Export', icon: Github },
  ];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div className="pb-6 border-b border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-white">Free Developer Utilities Suite</h1>
            <span className="text-xs font-mono text-emerald-400 bg-emerald-950/60 border border-emerald-800/50 px-2 py-0.5 rounded">
              100% Client-Side · $0 Cost
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Zero-cost open-source tools running right inside your browser. No server overhead, protecting platform resources.
          </p>
        </div>

        {onOpenExportZip && (
          <button
            onClick={onOpenExportZip}
            className="px-4 py-2 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-2 shadow-sm cursor-pointer self-start md:self-auto"
          >
            <FolderArchive className="w-4 h-4" />
            <span>Export Flutter Project (.zip)</span>
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 p-1.5 bg-slate-900 border border-slate-800 rounded-lg">
        {tools.map((t) => {
          const Icon = t.icon;
          const isActive = activeTool === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTool(t.id as any)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded text-xs font-semibold transition cursor-pointer ${
                isActive
                  ? 'bg-cyan-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* TOOL 1: ICON GENERATOR */}
      {activeTool === 'icon' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-5">
            <div>
              <h2 className="text-base font-bold text-white">Android App Icon & Splash Suite</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Upload 1 image and generate complete <code className="text-cyan-400">res/mipmap-*/</code> folder tree with Adaptive Icons and 512x512 Google Play icon.
              </p>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1.5">Upload Logo or Icon (PNG / SVG / JPG)</label>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/*"
                  onChange={handleIconUpload}
                  className="w-full text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-cyan-400 hover:file:bg-slate-700 cursor-pointer"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-slate-300 font-medium mb-1.5">Background Fill Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={iconBgColor}
                      onChange={(e) => setIconBgColor(e.target.value)}
                      className="w-8 h-8 rounded border border-slate-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={iconBgColor}
                      onChange={(e) => setIconBgColor(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1.5">Inner Padding ({iconPadding}%)</label>
                  <input
                    type="range"
                    min="0"
                    max="30"
                    value={iconPadding}
                    onChange={(e) => setIconPadding(parseInt(e.target.value, 10))}
                    className="w-full accent-cyan-500 cursor-pointer mt-2"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1.5">Round Corner Style</label>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={iconRounded}
                      onChange={(e) => setIconRounded(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-cyan-600 focus:ring-0"
                    />
                    <span className="text-slate-300">Circular badge</span>
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center gap-3">
                <button
                  onClick={handleGenerateIcons}
                  disabled={isGeneratingIcon}
                  className="px-5 py-2.5 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{isGeneratingIcon ? 'Processing Canvas...' : 'Generate & Download Icons (.zip)'}</span>
                </button>
              </div>

              {iconSuccessMsg && (
                <div className="p-3 rounded bg-emerald-950/40 border border-emerald-800/40 text-xs text-emerald-300 flex items-center gap-2">
                  <Check className="w-4 h-4" />
                  <span>{iconSuccessMsg}</span>
                </div>
              )}
            </div>
          </div>

          {/* Preview Box */}
          <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4 flex flex-col items-center justify-center text-center">
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Real-Time Android Preview
            </span>

            <div
              className={`w-32 h-32 flex items-center justify-center shadow-2xl transition-all ${
                iconRounded ? 'rounded-full' : 'rounded-2xl'
              }`}
              style={{ backgroundColor: iconBgColor, padding: `${iconPadding}%` }}
            >
              {previewSrc ? (
                <img src={previewSrc} alt="App Icon Preview" className="w-full h-full object-contain" />
              ) : (
                <div className="w-full h-full bg-white/20 rounded flex items-center justify-center text-white font-bold text-2xl font-mono">
                  FL
                </div>
              )}
            </div>

            <p className="text-xs text-slate-400 font-mono">
              Auto-scales to mdpi, hdpi, xhdpi, xxhdpi, xxxhdpi & Play Store 512px.
            </p>
          </div>
        </div>
      )}

      {/* TOOL 2: PUBSPEC ANALYZER */}
      {activeTool === 'pubspec' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-white">pubspec.yaml Content</h2>
              <button
                onClick={() => copyToClipboard(pubspecText, 'pubspec')}
                className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
              >
                {copiedKey === 'pubspec' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy</span>
              </button>
            </div>
            <textarea
              rows={16}
              value={pubspecText}
              onChange={(e) => setPubspecText(e.target.value)}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-5">
            <h2 className="text-sm font-bold text-white">Pubspec Audit Results</h2>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400">Dependencies</span>
                <p className="text-xl font-bold font-mono text-white mt-1">{pubspecResult.dependenciesCount}</p>
              </div>
              <div className="p-3 rounded bg-slate-950 border border-slate-800">
                <span className="text-slate-400">Dev Dependencies</span>
                <p className="text-xl font-bold font-mono text-white mt-1">{pubspecResult.devDependenciesCount}</p>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300">Lint Warnings</h3>
              {pubspecResult.warnings.length === 0 ? (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> No syntax or version warnings!
                </p>
              ) : (
                pubspecResult.warnings.map((w, idx) => (
                  <div
                    key={idx}
                    className={`p-2.5 rounded text-xs border ${
                      w.type === 'error'
                        ? 'bg-rose-950/40 border-rose-800/40 text-rose-300'
                        : 'bg-amber-950/40 border-amber-800/40 text-amber-300'
                    }`}
                  >
                    <span className="font-mono font-bold mr-1">Line {w.line || '—'}:</span>
                    {w.message}
                  </div>
                ))
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-slate-300">Build Optimizations</h3>
              <ul className="text-xs space-y-1.5 text-slate-300 list-disc list-inside">
                {pubspecResult.optimizations.map((opt, i) => (
                  <li key={i}>{opt}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* TOOL 3: ANDROID MANIFEST INSPECTOR */}
      {activeTool === 'manifest' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <h2 className="text-sm font-bold text-white">AndroidManifest.xml</h2>
            <textarea
              rows={16}
              value={manifestText}
              onChange={(e) => setManifestText(e.target.value)}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>

          <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Google Play Compliance Audit</h2>
              <div className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                Score: {manifestResult.securityScore} / 100
              </div>
            </div>

            <div className="space-y-2.5">
              {manifestResult.permissions.map((p, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded bg-slate-950 border border-slate-800 text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-white">{p.permission}</span>
                    <span
                      className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded font-semibold ${
                        p.level === 'restricted'
                          ? 'bg-rose-950 text-rose-300 border border-rose-800'
                          : p.level === 'dangerous'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {p.level}
                    </span>
                  </div>
                  <p className="text-slate-400">{p.description}</p>
                  {p.playStoreDeclarationRequired && (
                    <div className="text-amber-400 text-[11px] font-medium flex items-center gap-1 pt-1">
                      <AlertTriangle className="w-3 h-3" />
                      Requires Google Play Policy Declaration form during submission!
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TOOL 4: KEYSTORE GENERATOR */}
      {activeTool === 'keystore' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4 text-xs">
            <h2 className="text-sm font-bold text-white">Keystore Parameters</h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1">Keystore Filename</label>
                <input
                  type="text"
                  value={keystoreParams.keystoreName}
                  onChange={(e) => setKeystoreParams({ ...keystoreParams, keystoreName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Key Alias</label>
                <input
                  type="text"
                  value={keystoreParams.alias}
                  onChange={(e) => setKeystoreParams({ ...keystoreParams, alias: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1">Developer Full Name</label>
                <input
                  type="text"
                  value={keystoreParams.commonName}
                  onChange={(e) => setKeystoreParams({ ...keystoreParams, commonName: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Organization</label>
                <input
                  type="text"
                  value={keystoreParams.organization}
                  onChange={(e) => setKeystoreParams({ ...keystoreParams, organization: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-300 mb-1">City</label>
                <input
                  type="text"
                  value={keystoreParams.city}
                  onChange={(e) => setKeystoreParams({ ...keystoreParams, city: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">State</label>
                <input
                  type="text"
                  value={keystoreParams.state}
                  onChange={(e) => setKeystoreParams({ ...keystoreParams, state: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white"
                />
              </div>
              <div>
                <label className="block text-slate-300 mb-1">Country Code (2 letters)</label>
                <input
                  type="text"
                  value={keystoreParams.countryCode}
                  onChange={(e) => setKeystoreParams({ ...keystoreParams, countryCode: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-white font-mono uppercase"
                />
              </div>
            </div>
          </div>

          <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">keytool Command</h3>
                <button
                  onClick={() => copyToClipboard(keystoreOutput.command, 'keytool')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'keytool' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy Command</span>
                </button>
              </div>
              <pre className="p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-cyan-300 whitespace-pre-wrap break-all">
                {keystoreOutput.command}
              </pre>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">android/key.properties</h3>
                <button
                  onClick={() => copyToClipboard(keystoreOutput.keyProperties, 'keyprop')}
                  className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'keyprop' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy</span>
                </button>
              </div>
              <pre className="p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-300 whitespace-pre-wrap">
                {keystoreOutput.keyProperties}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* TOOL 5: PROGUARD RULES */}
      {activeTool === 'proguard' && (
        <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-5">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-bold text-white">ProGuard & R8 Optimization Rules</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Keep rules to prevent Flutter plugin crashes during release bytecode shrinking and obfuscation.
              </p>
            </div>
            <button
              onClick={() => copyToClipboard(proGuardRules, 'proguard')}
              className="px-3.5 py-1.5 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              {copiedKey === 'proguard' ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>Copy proguard-rules.pro</span>
            </button>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            {['firebase', 'sqflite', 'flutterwave', 'webview'].map((plugin) => {
              const isSelected = selectedPlugins.includes(plugin);
              return (
                <button
                  key={plugin}
                  onClick={() => {
                    if (isSelected) setSelectedPlugins(selectedPlugins.filter((p) => p !== plugin));
                    else setSelectedPlugins([...selectedPlugins, plugin]);
                  }}
                  className={`px-3 py-1.5 rounded transition cursor-pointer font-medium ${
                    isSelected ? 'bg-cyan-950 text-cyan-300 border border-cyan-700' : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  {plugin === 'flutterwave' ? 'Flutterwave v4 SDK' : plugin.toUpperCase()}
                </button>
              );
            })}
          </div>

          <pre className="p-4 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-200 overflow-x-auto max-h-96">
            {proGuardRules}
          </pre>
        </div>
      )}

      {/* TOOL 6: GITHUB ACTIONS EXPORT */}
      {activeTool === 'github_actions' && (
        <div className="p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-bold text-white">Self-Hosted GitHub Actions Mirror</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Deploy this workflow to <code className="text-cyan-400">.github/workflows/flutter.yml</code> to run on GitHub's free 2,000 monthly runner minutes.
              </p>
            </div>
            <button
              onClick={() => copyToClipboard(ghWorkflow, 'gh_workflow')}
              className="px-3.5 py-1.5 text-xs font-semibold rounded bg-cyan-600 hover:bg-cyan-500 text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              {copiedKey === 'gh_workflow' ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>Copy Workflow YAML</span>
            </button>
          </div>

          <pre className="p-4 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-cyan-300 overflow-x-auto max-h-96">
            {ghWorkflow}
          </pre>
        </div>
      )}
    </div>
  );
};
