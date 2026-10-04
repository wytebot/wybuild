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
  FileJson,
  Hash,
  PackageCheck,
  SearchCheck,
} from 'lucide-react';
import { generateAndroidIconZip } from '../../services/iconGenerator';
import JSZip from 'jszip';
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
    'icon' | 'pubspec' | 'manifest' | 'keystore' | 'proguard' | 'github_actions' | 'json' | 'checksum' | 'package' | 'build_audit'
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


  // --- Tool 7: JSON Formatter / Validator ---
  const [jsonText, setJsonText] = useState(`{
  "name": "my_flutter_app",
  "version": "1.0.0",
  "android": {
    "minSdk": 23,
    "targetSdk": 35
  }
}`);
  const [jsonError, setJsonError] = useState('');
  const [formattedJson, setFormattedJson] = useState('');

  const formatJson = () => {
    try {
      const value = JSON.parse(jsonText);
      const out = JSON.stringify(value, null, 2);
      setFormattedJson(out);
      setJsonError('');
    } catch (e) {
      setFormattedJson('');
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  };

  // --- Tool 8: SHA-256 Checksum ---
  const [checksum, setChecksum] = useState('');
  const [checksumFile, setChecksumFile] = useState('');
  const handleChecksum = async (file?: File) => {
    if (!file) return;
    setChecksumFile(file.name);
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    setChecksum(Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join(''));
  };

  // --- Tool 9: APK/AAB Package Inspector ---
  const [packageReport, setPackageReport] = useState<{
    name: string; size: number; files: number; dex: number; native: number; assets: number;
    hasMapping: boolean; hasDebugSymbols: boolean; hasSignature: boolean; hasManifest: boolean;
  } | null>(null);

  const inspectPackage = async (file?: File) => {
    if (!file) return;
    try {
      const zip = await JSZip.loadAsync(file);
      const entries = Object.values(zip.files).filter((f) => !f.dir);
      const names = entries.map((e) => e.name);
      setPackageReport({
        name: file.name,
        size: file.size,
        files: entries.length,
        dex: names.filter((n) => /^classes\d*\.dex$/.test(n)).length,
        native: names.filter((n) => /\.(so)$/.test(n)).length,
        assets: names.filter((n) => n.startsWith('assets/')).length,
        hasMapping: names.some((n) => /(^|\/)mapping\.txt$/.test(n)),
        hasDebugSymbols: names.some((n) => /(^|\/)(symbols|native-debug-symbols)/i.test(n)),
        hasSignature: names.some((n) => /^META-INF\/.*\.(RSA|DSA|EC)$/.test(n)),
        hasManifest: names.some((n) => n === 'AndroidManifest.xml'),
      });
    } catch {
      setPackageReport(null);
    }
  };

  // --- Tool 10: Flutter/Android Build Audit ---
  const [buildAuditText, setBuildAuditText] = useState(`android {
    compileSdk 35
    defaultConfig {
        minSdk 23
        targetSdk 35
    }
}
android {
    buildTypes {
        release {
            minifyEnabled true
            shrinkResources true
        }
    }
}`);
  const buildAudit = (() => {
    const t = buildAuditText;
    const checks = [
      { label: 'compileSdk 35+', ok: /compileSdk(?:Version)?\s*[\s:=]+(3[5-9]|\d{3,})/.test(t) },
      { label: 'targetSdk 35+', ok: /targetSdk(?:Version)?\s*[\s:=]+(3[5-9]|\d{3,})/.test(t) },
      { label: 'Release minification enabled', ok: /minifyEnabled\s+true/.test(t) },
      { label: 'Release resource shrinking enabled', ok: /shrinkResources\s+true/.test(t) },
      { label: 'Debug signing not used for release', ok: !/signingConfig\s+signingConfigs\.debug/.test(t) },
    ];
    return checks;
  })();

  const tools = [
    { id: 'icon', label: 'App Icon Generator', icon: ImageIcon },
    { id: 'pubspec', label: 'Pubspec Linter', icon: FileCode },
    { id: 'manifest', label: 'Manifest & Permissions', icon: ShieldCheck },
    { id: 'keystore', label: 'Keystore Command Helper', icon: Key },
    { id: 'proguard', label: 'ProGuard/R8 Rules', icon: Layers },
    { id: 'github_actions', label: 'GitHub Actions Export', icon: Github },
    { id: 'json', label: 'JSON Formatter', icon: FileJson },
    { id: 'checksum', label: 'SHA-256 Checksum', icon: Hash },
    { id: 'package', label: 'APK/AAB Inspector', icon: PackageCheck },
    { id: 'build_audit', label: 'Build Config Audit', icon: SearchCheck },
  ];

  return (
    <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-5 sm:space-y-8">
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
            className="px-4 py-2 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-2 shadow-sm cursor-pointer self-start md:self-auto"
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
                  ? 'bg-emerald-600 text-white shadow-sm'
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
                Upload 1 image and generate complete <code className="text-emerald-400">res/mipmap-*/</code> folder tree with Adaptive Icons and 512x512 Google Play icon.
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
                  className="w-full text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-emerald-400 hover:file:bg-slate-700 cursor-pointer"
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
                    className="w-full accent-emerald-500 cursor-pointer mt-2"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1.5">Round Corner Style</label>
                  <label className="flex items-center gap-2 mt-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={iconRounded}
                      onChange={(e) => setIconRounded(e.target.checked)}
                      className="rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-0"
                    />
                    <span className="text-slate-300">Circular badge</span>
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center gap-3">
                <button
                  onClick={handleGenerateIcons}
                  disabled={isGeneratingIcon}
                  className="px-5 py-2.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer"
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
          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4 flex flex-col items-center justify-center text-center">
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
          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-white">pubspec.yaml Content</h2>
              <button
                onClick={() => copyToClipboard(pubspecText, 'pubspec')}
                className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
              >
                {copiedKey === 'pubspec' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>Copy</span>
              </button>
            </div>
            <textarea
              rows={16}
              value={pubspecText}
              onChange={(e) => setPubspecText(e.target.value)}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-5">
            <h2 className="text-sm font-bold text-white">Pubspec Audit Results</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
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
          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <h2 className="text-sm font-bold text-white">AndroidManifest.xml</h2>
            <textarea
              rows={16}
              value={manifestText}
              onChange={(e) => setManifestText(e.target.value)}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Google Play Compliance Audit</h2>
              <div className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800">
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
          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4 text-xs">
            <h2 className="text-sm font-bold text-white">Keystore Parameters</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
            <div>
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">keytool Command</h3>
                <button
                  onClick={() => copyToClipboard(keystoreOutput.command, 'keytool')}
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
                >
                  {copiedKey === 'keytool' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>Copy Command</span>
                </button>
              </div>
              <pre className="p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-emerald-300 whitespace-pre-wrap break-all">
                {keystoreOutput.command}
              </pre>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">android/key.properties</h3>
                <button
                  onClick={() => copyToClipboard(keystoreOutput.keyProperties, 'keyprop')}
                  className="text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1 cursor-pointer"
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
        <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-5">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-bold text-white">ProGuard & R8 Optimization Rules</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Keep rules to prevent Flutter plugin crashes during release bytecode shrinking and obfuscation.
              </p>
            </div>
            <button
              onClick={() => copyToClipboard(proGuardRules, 'proguard')}
              className="px-3.5 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
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
                    isSelected ? 'bg-emerald-950 text-emerald-300 border border-emerald-700' : 'bg-slate-800 text-slate-400'
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
        <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-base font-bold text-white">Self-Hosted GitHub Actions Mirror</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Deploy this workflow to <code className="text-emerald-400">.github/workflows/flutter.yml</code> to run on GitHub's free 2,000 monthly runner minutes.
              </p>
            </div>
            <button
              onClick={() => copyToClipboard(ghWorkflow, 'gh_workflow')}
              className="px-3.5 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-500 text-white transition flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              {copiedKey === 'gh_workflow' ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
              <span>Copy Workflow YAML</span>
            </button>
          </div>

          <pre className="p-4 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-emerald-300 overflow-x-auto max-h-96">
            {ghWorkflow}
          </pre>
        </div>

      )}

      {/* TOOL 7: JSON FORMATTER */}
      {activeTool === 'json' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">JSON Formatter & Validator</h2>
              <button onClick={formatJson} className="px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 text-white">Format & Validate</button>
            </div>
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={20}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none" />
            {jsonError && <p className="text-xs text-rose-300">{jsonError}</p>}
          </div>
          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex justify-between"><h2 className="text-sm font-bold text-white">Formatted output</h2>
              <button disabled={!formattedJson} onClick={() => copyToClipboard(formattedJson, 'json')} className="text-xs text-emerald-400">{copiedKey === 'json' ? 'Copied' : 'Copy'}</button></div>
            <pre className="p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-emerald-300 whitespace-pre-wrap overflow-auto max-h-[520px]">{formattedJson || 'Paste JSON and validate it.'}</pre>
          </div>
        </div>
      )}

      {/* TOOL 8: CHECKSUM */}
      {activeTool === 'checksum' && (
        <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-5">
          <h2 className="text-base font-bold text-white">SHA-256 File Checksum</h2>
          <p className="text-xs text-slate-400">Compute a cryptographic checksum locally. The file is never uploaded to WyBuild.</p>
          <input type="file" onChange={(e) => handleChecksum(e.target.files?.[0])}
            className="w-full text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-slate-800 file:text-emerald-400 text-xs" />
          {checksum && <div className="p-4 bg-slate-950 border border-slate-800 rounded space-y-2">
            <div className="text-xs text-slate-400">{checksumFile}</div>
            <code className="block break-all text-xs text-emerald-300">{checksum}</code>
            <button onClick={() => copyToClipboard(checksum, 'checksum')} className="text-xs text-emerald-400">{copiedKey === 'checksum' ? 'Copied' : 'Copy SHA-256'}</button>
          </div>}
        </div>
      )}

      {/* TOOL 9: APK/AAB INSPECTOR */}
      {activeTool === 'package' && (
        <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-5">
          <div>
            <h2 className="text-base font-bold text-white">APK / AAB Package Inspector</h2>
            <p className="text-xs text-slate-400 mt-1">Inspect package structure locally without uploading the build.</p>
          </div>
          <input type="file" accept=".apk,.aab" onChange={(e) => inspectPackage(e.target.files?.[0])}
            className="w-full text-slate-400 file:mr-3 file:py-2 file:px-3 file:rounded file:border-0 file:bg-slate-800 file:text-emerald-400 text-xs" />
          {packageReport && <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 bg-slate-950 border border-slate-800 rounded"><span className="text-slate-400">Size</span><b className="block text-white mt-1">{(packageReport.size / 1048576).toFixed(2)} MB</b></div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded"><span className="text-slate-400">Files</span><b className="block text-white mt-1">{packageReport.files}</b></div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded"><span className="text-slate-400">DEX files</span><b className="block text-white mt-1">{packageReport.dex}</b></div>
            <div className="p-3 bg-slate-950 border border-slate-800 rounded"><span className="text-slate-400">Native .so</span><b className="block text-white mt-1">{packageReport.native}</b></div>
          </div>}
          {packageReport && <div className="space-y-2 text-xs">
            {[
              ['Android manifest present', packageReport.hasManifest],
              ['Release signature found', packageReport.hasSignature],
              ['R8 mapping file present', packageReport.hasMapping],
              ['Native debug symbols included', packageReport.hasDebugSymbols],
            ].map(([label, ok]) => <div key={String(label)} className={`p-3 rounded border ${ok ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300' : 'border-amber-800/50 bg-amber-950/30 text-amber-300'}`}>{ok ? '✓' : '•'} {label}</div>)}
          </div>}
        </div>
      )}

      {/* TOOL 10: BUILD CONFIG AUDIT */}
      {activeTool === 'build_audit' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <h2 className="text-sm font-bold text-white">Gradle / Android Build Configuration</h2>
            <textarea value={buildAuditText} onChange={(e) => setBuildAuditText(e.target.value)} rows={20}
              className="w-full p-3 bg-slate-950 border border-slate-800 rounded font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none" />
          </div>
          <div className="p-4 sm:p-6 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
            <h2 className="text-sm font-bold text-white">Release Readiness Checks</h2>
            {buildAudit.map((c) => <div key={c.label} className={`p-3 rounded border text-xs ${c.ok ? 'border-emerald-800/50 bg-emerald-950/30 text-emerald-300' : 'border-amber-800/50 bg-amber-950/30 text-amber-300'}`}>
              <b>{c.ok ? '✓ PASS' : '⚠ REVIEW'}</b><span className="ml-2">{c.label}</span>
            </div>)}
            <p className="text-[11px] text-slate-500 pt-2">These checks are deterministic browser-side heuristics, not a replacement for a real Gradle build.</p>
          </div>
        </div>
      )}
    </div>
  );
};
