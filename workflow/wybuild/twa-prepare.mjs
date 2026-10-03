// WyBuild TWA - step 1: resolve the final TWA configuration.
// Zero dependencies (Node 20+). Reads TWA_CONFIG (JSON) from the environment, merges it with
//   (a) values auto-detected from the site's Web App Manifest, and
//   (b) the optional repo-level override file  wybuild/twa.json  (manual control, wins last),
// then writes  <OUT>/twa-resolved.json  and  <OUT>/prepare-report.json.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.env.WB_OUT || '.wybuild-out';
fs.mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(m);
const warn = (m) => console.log(`::warning::${m}`);
const fail = (m) => {
  console.log(`::error::${m}`);
  process.exit(1);
};

let cfg;
try {
  cfg = JSON.parse(process.env.TWA_CONFIG || '{}');
} catch {
  fail('twa_config input is not valid JSON');
}

// (b) repo-level manual overrides
const overridePath = 'wybuild/twa.json';
if (fs.existsSync(overridePath)) {
  try {
    const o = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
    Object.assign(cfg, o);
    log(`Applied manual overrides from ${overridePath}: ${Object.keys(o).join(', ')}`);
  } catch (e) {
    fail(`${overridePath} is not valid JSON: ${e.message}`);
  }
}

if (!cfg.webUrl) fail('webUrl is required');
let site;
try {
  site = new URL(cfg.webUrl);
} catch {
  fail(`Invalid webUrl: ${cfg.webUrl}`);
}
if (site.protocol !== 'https:') fail('A Trusted Web Activity requires an https:// site.');

const report = { checks: [], detected: {} };
const check = (id, ok, msg, level = 'warn') => {
  report.checks.push({ id, ok, level: ok ? 'ok' : level, msg });
  log(`${ok ? 'PASS' : level === 'error' ? 'FAIL' : 'WARN'}  ${id}: ${msg}`);
};

async function get(url, as = 'text') {
  const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'WyBuild-TWA/1.0' }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return as === 'json' ? r.json() : r.text();
}

// (a) auto-detect the Web App Manifest
let manifest = {};
let manifestUrl = cfg.webManifestUrl || '';
try {
  if (!manifestUrl) {
    const html = await get(site.href);
    const tag = /<link[^>]+rel=["']?[^"'>]*manifest[^"'>]*["']?[^>]*>/i.exec(html);
    const href = tag && /href=["']?([^"'\s>]+)/i.exec(tag[0]);
    if (href) manifestUrl = new URL(href[1].replace(/&amp;/g, '&'), site.href).href;
  }
  if (manifestUrl) {
    manifest = await get(manifestUrl, 'json');
    report.detected.manifestUrl = manifestUrl;
  }
} catch (e) {
  warn(`Could not read the site/manifest (${e.message}); falling back to the values you supplied.`);
}
check('manifest', !!manifestUrl && !!manifest.name, manifestUrl ? `Web App Manifest found at ${manifestUrl}` : 'No <link rel="manifest"> found on the start page');

const abs = (u) => (u ? new URL(u, manifestUrl || site.href).href : '');
const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
const sizeOf = (i) => Math.max(0, ...String(i.sizes || '').split(/\s+/).map((s) => parseInt(s, 10) || 0));
const pick = (pred) => icons.filter(pred).sort((a, b) => sizeOf(b) - sizeOf(a))[0];
const anyIcon = pick((i) => !/maskable|monochrome/.test(i.purpose || '') && sizeOf(i) >= 192) || pick((i) => sizeOf(i) >= 192);
const maskable = pick((i) => /maskable/.test(i.purpose || ''));
const mono = pick((i) => /monochrome/.test(i.purpose || ''));

const host = site.host;
const reversed = host.replace(/^www\./, '').split('.').reverse().map((s) => s.replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean);
const derivedPkg = reversed.map((s) => (/^[a-z]/.test(s) ? s : `a${s}`)).join('.');

const resolved = {
  webUrl: site.href,
  webManifestUrl: manifestUrl || undefined,
  host,
  packageId: cfg.packageId || derivedPkg,
  name: cfg.name || manifest.name || host,
  launcherName: (cfg.launcherName || manifest.short_name || manifest.name || host).slice(0, 30),
  versionName: cfg.versionName || '1.0.0',
  versionCode: Number(cfg.versionCode) > 0 ? Number(cfg.versionCode) : Number(process.env.GITHUB_RUN_NUMBER || 1),
  themeColor: cfg.themeColor || manifest.theme_color || '#000000',
  themeColorDark: cfg.themeColorDark || cfg.themeColor || manifest.theme_color || '#000000',
  backgroundColor: cfg.backgroundColor || manifest.background_color || '#FFFFFF',
  navigationColor: cfg.navigationColor || cfg.themeColor || manifest.theme_color || '#000000',
  startUrl: cfg.startUrl || (manifest.start_url ? new URL(manifest.start_url, manifestUrl || site.href).pathname + new URL(manifest.start_url, manifestUrl || site.href).search : '/'),
  iconUrl: cfg.iconUrl || (anyIcon ? abs(anyIcon.src) : ''),
  maskableIconUrl: cfg.maskableIconUrl || (maskable ? abs(maskable.src) : ''),
  monochromeIconUrl: cfg.monochromeIconUrl || (mono ? abs(mono.src) : ''),
  display: cfg.display || (['fullscreen', 'minimal-ui'].includes(manifest.display) ? manifest.display : 'standalone'),
  orientation: cfg.orientation || (/portrait/.test(manifest.orientation || '') ? 'portrait' : /landscape/.test(manifest.orientation || '') ? 'landscape' : 'default'),
  fallbackType: cfg.fallbackType || 'customtabs',
  enableNotifications: !!cfg.enableNotifications,
  enableSiteSettingsShortcut: cfg.enableSiteSettingsShortcut !== false,
  locationDelegation: !!cfg.locationDelegation,
  playBilling: !!cfg.playBilling,
  additionalTrustedOrigins: Array.isArray(cfg.additionalTrustedOrigins) ? cfg.additionalTrustedOrigins : [],
  shortcuts: Array.isArray(cfg.shortcuts) && cfg.shortcuts.length ? cfg.shortcuts : (manifest.shortcuts || []).slice(0, 4).map((s) => ({
    name: s.name,
    shortName: s.short_name || s.name,
    url: s.url,
    ...(s.icons?.[0] ? { icon: abs(s.icons[0].src) } : {}),
  })),
  minSdkVersion: Number(cfg.minSdkVersion) || 21,
  splashScreenFadeOutDuration: Number(cfg.splashScreenFadeOutDuration) || 300,
  androidPermissions: Array.isArray(cfg.androidPermissions) ? cfg.androidPermissions : [],
  expectedFingerprint: cfg.expectedFingerprint || '',
  isChromeOSOnly: !!cfg.isChromeOSOnly,
};

if (!resolved.iconUrl) fail('No app icon: set iconUrl (512x512 PNG) or add a 512x512 icon to the site\'s Web App Manifest.');
if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(resolved.packageId)) fail(`Invalid Android package id "${resolved.packageId}" (example: com.mycompany.myapp)`);

check('https', true, 'Site is served over HTTPS');
check('icon-512', icons.length === 0 ? true : icons.some((i) => sizeOf(i) >= 512) || !!cfg.iconUrl, 'A 512x512 icon is available (needed for store listings and a sharp launcher icon)');
check('maskable', !!resolved.maskableIconUrl, 'A maskable icon exists (otherwise Android shows a white-padded icon)');
check('package-reserved', !/^(com\.example|com\.android|android|com\.google|org\.chromium)(\.|$)/.test(resolved.packageId), `Package id "${resolved.packageId}" is not a reserved/placeholder namespace`, 'error');
check('launcher-length', resolved.launcherName.length <= 12, `Launcher name "${resolved.launcherName}" fits under launcher icons (12 chars or fewer recommended)`);
check('start-url', resolved.startUrl.startsWith('/'), `Start URL is ${resolved.startUrl}`);

fs.writeFileSync(path.join(OUT, 'twa-resolved.json'), JSON.stringify(resolved, null, 2));
report.resolved = { packageId: resolved.packageId, name: resolved.name, versionName: resolved.versionName, versionCode: resolved.versionCode };
fs.writeFileSync(path.join(OUT, 'prepare-report.json'), JSON.stringify(report, null, 2));

if (process.env.GITHUB_ENV) {
  fs.appendFileSync(process.env.GITHUB_ENV, `WB_PACKAGE=${resolved.packageId}\nWB_VERSION_NAME=${resolved.versionName}\nWB_VERSION_CODE=${resolved.versionCode}\nWB_HOST=${host}\nWB_EXPECTED_FP=${resolved.expectedFingerprint}\n`);
}
if (report.checks.some((c) => c.level === 'error')) fail('Preflight found blocking problems (see above).');
log(`Resolved ${resolved.packageId} v${resolved.versionName} (${resolved.versionCode})`);
