import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const out = process.env.WB_OUT || `${process.cwd()}/.wybuild-out`;
const raw = JSON.parse(process.env.TWA_CONFIG || '{}');
if (!raw.webUrl) throw new Error('Web app URL is missing.');
await fs.mkdir(out, { recursive: true });

const pageUrl = new URL(raw.webUrl);
if (pageUrl.protocol !== 'https:') throw new Error('Web app URL must use HTTPS.');

const page = await fetch(pageUrl, { redirect: 'follow' });
if (!page.ok) throw new Error(`Web app returned HTTP ${page.status}.`);
const html = await page.text();
const manifestTag = html.match(/<link[^>]+rel=["'][^"']*manifest[^"']*["'][^>]+href=["']([^"']+)["']/i) || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'][^"']*manifest[^"']*["']/i);
const manifestUrl = raw.webManifestUrl || (manifestTag ? new URL(manifestTag[1], page.url || pageUrl).href : '');
if (!manifestUrl) throw new Error('No Web App Manifest was found. A quality TWA needs a valid manifest.');
const mr = await fetch(manifestUrl, { redirect: 'follow', headers: { Accept: 'application/manifest+json,application/json' } });
if (!mr.ok) throw new Error(`Web App Manifest returned HTTP ${mr.status}.`);
const web = await mr.json();

const abs = v => v ? new URL(v, manifestUrl).href : '';
const icons = Array.isArray(web.icons) ? web.icons : [];
const size = i => Math.max(...String(i?.sizes || '').split(/\s+/).map(x => Number.parseInt(x, 10) || 0), 0);
const best = [...icons].filter(i => !String(i.purpose || '').includes('maskable')).sort((a,b) => size(b)-size(a))[0] || [...icons].sort((a,b)=>size(b)-size(a))[0];
const maskable = icons.find(i => String(i.purpose || '').includes('maskable'));
const mono = icons.find(i => String(i.purpose || '').includes('monochrome'));
if (!best?.src || size(best) < 192) throw new Error('The web manifest needs an app icon. Add a PNG icon of at least 192px; 512px is recommended.');

const host = new URL(page.url || pageUrl).hostname.replace(/^www\./, '').toLowerCase();
const generatedPackage = host.split('.').filter(Boolean).reverse().map(x => x.replace(/[^a-z0-9_]/g, '')).filter(Boolean).map(x => /^[a-z]/.test(x) ? x : `a${x}`).join('.');
const packageId = raw.packageId || generatedPackage;
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageId)) throw new Error(`Could not generate a valid free package ID from ${host}.`);

const start = new URL(raw.startUrl || web.start_url || '/', manifestUrl);
const display = ['standalone','fullscreen','minimal-ui','fullscreen-sticky'].includes(raw.display || web.display) ? (raw.display || web.display) : 'standalone';
const orientation = raw.orientation || web.orientation || 'default';
const themeColor = /^#[0-9a-f]{6}$/i.test(raw.themeColor || web.theme_color || '') ? (raw.themeColor || web.theme_color) : '#FFFFFF';
const backgroundColor = /^#[0-9a-f]{6}$/i.test(raw.backgroundColor || web.background_color || '') ? (raw.backgroundColor || web.background_color) : '#FFFFFF';
const shortcuts = Array.isArray(web.shortcuts) ? web.shortcuts.slice(0,4).filter(s => s?.name && s?.url).map(s => ({ name: s.name, shortName: (s.short_name || s.name).slice(0,12), url: new URL(s.url, manifestUrl).pathname + new URL(s.url, manifestUrl).search, chosenIconUrl: s.icons?.[0]?.src ? abs(s.icons[0].src) : undefined })) : [];
const features = {};
if (raw.locationDelegation) features.locationDelegation = { enabled: true };
if (raw.playBilling) features.playBilling = { enabled: true };
const perms = Array.isArray(raw.androidPermissions) ? raw.androidPermissions : [];
const json = {
  packageId,
  host: new URL(page.url || pageUrl).host,
  name: String(raw.name || web.name || web.short_name || host).slice(0,50),
  launcherName: String(raw.launcherName || web.short_name || web.name || host).slice(0,12),
  display,
  themeColor,
  themeColorDark: themeColor,
  navigationColor: themeColor,
  backgroundColor,
  enableNotifications: raw.enableNotifications !== false,
  enableSiteSettingsShortcut: raw.enableSiteSettingsShortcut !== false,
  startUrl: start.pathname + start.search,
  iconUrl: abs(raw.iconUrl || best.src),
  maskableIconUrl: abs(raw.maskableIconUrl || maskable?.src),
  monochromeIconUrl: abs(raw.monochromeIconUrl || mono?.src),
  appVersionCode: Number(raw.versionCode) || Number(process.env.GITHUB_RUN_NUMBER) || 1,
  appVersion: String(raw.versionName || '1.0.0'),
  splashScreenFadeOutDuration: 300,
  signingKey: { path: `${out}/wybuild-release.jks`, alias: process.env.WB_KEY_ALIAS_SECRET || 'wybuild' },
  shortcuts,
  webManifestUrl: manifestUrl,
  fallbackType: 'customtabs',
  features,
  minSdkVersion: Math.max(21, Number(raw.minSdkVersion) || 21),
  orientation,
  additionalTrustedOrigins: Array.isArray(raw.additionalTrustedOrigins) ? raw.additionalTrustedOrigins : [],
  fingerprints: raw.expectedFingerprint ? [{ value: String(raw.expectedFingerprint).replace(/:/g,'').toUpperCase() }] : [],
  fileHandlers: web.file_handlers || [],
  protocolHandlers: web.protocol_handlers || [],
  launchHandlerClientMode: web.launch_handler?.client_mode || '',
  generatorApp: 'WyBuild',
  androidPermissions: perms,
};
await fs.writeFile(`${out}/twa-resolved.json`, JSON.stringify(json, null, 2));
await fs.writeFile(`${out}/twa-manifest.json`, JSON.stringify(json, null, 2));
const snapshot = crypto.createHash('sha256').update(JSON.stringify({ web, json })).digest('hex');
await fs.writeFile(`${out}/snapshot.txt`, snapshot);
console.log(`WYBUILD_PACKAGE=${packageId}`);
console.log(`WYBUILD_VERSION=${json.appVersion}`);
console.log(`WYBUILD_VERSION_CODE=${json.appVersionCode}`);
console.log(`WYBUILD_WEB_MANIFEST=${manifestUrl}`);
console.log(`WYBUILD_SNAPSHOT=${snapshot}`);
console.log(`WYBUILD_SOURCE_HOST=${host}`);
