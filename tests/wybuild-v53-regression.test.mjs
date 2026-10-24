import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');

test('API workflow version matches both committed workflow copies', () => {
  const api = read('../api/index.js');
  const version = Number(api.match(/const TWA_WORKFLOW_VERSION = (\d+);/)?.[1]);
  assert.ok(version > 0);
  for (const file of ['../.github/workflows/wybuild-twa.yml', '../workflow/wybuild-twa.yml']) {
    assert.equal(Number(read(file).match(/wybuild-twa-workflow-version:\s*(\d+)/)?.[1]), version, file);
  }
});

test('selected pull-to-refresh is bootstrapped into the generated Capacitor bridge', () => {
  const workflow = read('../.github/workflows/wybuild-twa.yml');
  const bridge = read('../workflow/wybuild/capacitor-bridge.entry.js');
  assert.match(workflow, /selected\.has\('pulltorefresh'\)/);
  assert.match(workflow, /WyBuildNative\?\.pullToRefresh\?\.enable/);
  assert.match(bridge, /const onRefresh = typeof options\.onRefresh === 'function' \? options\.onRefresh : \(\) => location\.reload\(\)/);
});

test('help does not incorrectly claim that pull-to-refresh requires site code', () => {
  const help = read('../src/components/help/HowItWorksView.tsx');
  assert.match(help, /selecting Pull to refresh installs and enables a built-in reload gesture/);
  assert.match(help, /The server charges setup\/integration credits only when a feature or permission is new/);
  assert.match(help, /not when you tap a checkbox/);
});
