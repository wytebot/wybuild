// WyBuild TWA - step 2: generate the Android project from the resolved config WITHOUT any prompts.
// `bubblewrap init` is interactive, so we call the same generator the CLI uses (@bubblewrap/core)
// and then write the manifest checksum that `bubblewrap build` expects, so it never asks to "update".
// This file must be run from inside the directory that has node_modules/@bubblewrap/core.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as core from '@bubblewrap/core';

const OUT = path.resolve(process.env.WB_OUT || '../.wybuild-out');
const r = JSON.parse(fs.readFileSync(path.join(OUT, 'twa-resolved.json'), 'utf8'));
const projectDir = path.join(OUT, 'project');
fs.mkdirSync(projectDir, { recursive: true });

const features = {};
if (r.locationDelegation) features.locationDelegation = { enabled: true };
if (r.playBilling) features.playBilling = { enabled: true };

const manifestJson = {
  packageId: r.packageId,
  host: r.host,
  name: r.name,
  launcherName: r.launcherName,
  display: r.display,
  orientation: r.orientation,
  themeColor: r.themeColor,
  themeColorDark: r.themeColorDark,
  navigationColor: r.navigationColor,
  navigationColorDark: r.navigationColor,
  navigationDividerColor: r.navigationColor,
  navigationDividerColorDark: r.navigationColor,
  backgroundColor: r.backgroundColor,
  enableNotifications: r.enableNotifications,
  startUrl: r.startUrl,
  iconUrl: r.iconUrl,
  maskableIconUrl: r.maskableIconUrl || undefined,
  monochromeIconUrl: r.monochromeIconUrl || undefined,
  splashScreenFadeOutDuration: r.splashScreenFadeOutDuration,
  signingKey: { path: process.env.WB_KEYSTORE_PATH, alias: process.env.WB_KEY_ALIAS },
  appVersionName: r.versionName,
  appVersionCode: r.versionCode,
  shortcuts: r.shortcuts,
  generatorApp: 'WyBuild',
  webManifestUrl: r.webManifestUrl,
  fallbackType: r.fallbackType,
  features,
  alphaDependencies: { enabled: false },
  enableSiteSettingsShortcut: r.enableSiteSettingsShortcut,
  isChromeOSOnly: r.isChromeOSOnly,
  isMetaQuest: false,
  fullScopeUrl: r.webUrl,
  minSdkVersion: r.minSdkVersion,
  additionalTrustedOrigins: r.additionalTrustedOrigins,
  retainedBundles: [],
};
for (const k of Object.keys(manifestJson)) if (manifestJson[k] === undefined) delete manifestJson[k];

const manifestFile = path.join(projectDir, 'twa-manifest.json');
fs.writeFileSync(manifestFile, JSON.stringify(manifestJson, null, 2));

const { TwaManifest, TwaGenerator, ConsoleLog } = core;
const manifest = typeof TwaManifest.fromJson === 'function' ? TwaManifest.fromJson(manifestJson) : new TwaManifest(manifestJson);
const errs = typeof manifest.validate === 'function' ? manifest.validate() : null;
if (errs && errs.length) throw new Error(`Invalid TWA manifest: ${JSON.stringify(errs)}`);
await new TwaGenerator().createTwaProject(projectDir, manifest, new ConsoleLog('wybuild-generate'));

// bubblewrap compares sha1(twa-manifest.json) with manifest-checksum.txt before building
const sha1 = crypto.createHash('sha1').update(fs.readFileSync(manifestFile)).digest('hex');
fs.writeFileSync(path.join(projectDir, 'manifest-checksum.txt'), sha1);
console.log(`Android project generated at ${projectDir}`);
