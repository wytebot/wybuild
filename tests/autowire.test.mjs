import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const copies = ['../.github/wybuild/wybuild-autowire.js', '../workflow/wybuild/wybuild-autowire.js'];

test('both template copies of the auto-wire layer are identical and syntactically valid', () => {
  assert.equal(read(copies[0]), read(copies[1]));
  execFileSync('node', ['--check', new URL(copies[0], import.meta.url).pathname]);
});

test('workflow appends the auto-wire layer to the bridge bundle, passes selected features to runtime config, and checks the helper exists', () => {
  for (const f of ['../.github/workflows/wybuild-twa.yml', '../workflow/wybuild-twa.yml']) {
    const y = read(f);
    assert.match(y, /cat \.github\/wybuild\/wybuild-autowire\.js >> "\$WYBUILD_WEB_DIR\/wybuild-native-bridge\.js"/, f);
    assert.match(y, /nativeFeatures: Array\.isArray\(cfg\.nativeFeatures\)/, f);
    assert.match(y, /capacitor-finalize\.py wybuild-autowire\.js; do/, f);
    // appended before the generated bundle is syntax-checked
    assert.ok(y.indexOf('wybuild-autowire.js >>') < y.indexOf('node --check "$WYBUILD_WEB_DIR/wybuild-native-bridge.js"'), f);
  }
});

test('API installs the auto-wire helper into user repositories', () => {
  assert.match(read('../api/index.js'), /\['\.github\/wybuild\/wybuild-autowire\.js', 'wybuild\/wybuild-autowire\.js'\]/);
});

test('every auto-wired feature is gated on its selected feature id and only runs in the native app', () => {
  const s = read(copies[0]);
  assert.match(s, /N\.isNative\(\)/);
  for (const id of ['shareout', 'downloads', 'localnotifications', 'reminders', 'haptics', 'networkstatus', 'deviceinfo', 'deeplinks', 'swipeback']) {
    assert.match(s, new RegExp(`has\\([^)]*'${id}'`), id);
  }
});

test('auto-wire ids exist in the server allow-list so a ticked feature actually reaches the build', () => {
  const api = read('../api/index.js');
  const list = api.match(/const NATIVE_OPTIN = \[([^\]]+)\]/)[1];
  for (const id of ['shareout', 'downloads', 'localnotifications', 'reminders', 'haptics', 'networkstatus', 'deviceinfo', 'deeplinks', 'swipeback']) assert.ok(list.includes(`'${id}'`), id);
});

test('bundle + auto-wire concatenation is valid ESM (what the workflow produces)', () => {
  const tmp = fs.mkdtempSync('/tmp/wy-aw-') + '/bundle.mjs';
  fs.writeFileSync(tmp, 'window.WyBuildNative = {};\nexport {};\n\n' + read(copies[0]));
  execFileSync('node', ['--check', tmp]);
});

test('help and feature hints no longer say swipe-back or share/downloads need site code', () => {
  const help = read('../src/components/help/HowItWorksView.tsx');
  assert.doesNotMatch(help, /Edge swipe back still needs your site/);
  assert.match(help, /Auto-wired features \(v49\)/);
  const twa = read('../src/components/twa/TwaView.tsx');
  assert.match(twa, /navigator\.share\(\) opens Android/);
  assert.match(twa, /download links/);
});
