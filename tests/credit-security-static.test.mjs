import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const api = fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
const apiBase = fs.readFileSync(new URL('../src/services/apiBase.ts', import.meta.url), 'utf8');
const twaView = fs.readFileSync(new URL('../src/components/twa/TwaView.tsx', import.meta.url), 'utf8');

test('server owns build and configuration pricing', () => {
  assert.match(api, /const BUILD_BASE_CREDITS = 5/);
  assert.match(api, /function configChangeCharge\(previous, current\)/);
  assert.match(api, /wb:build-config:\$\{session\.login\}:\$\{repo\.toLowerCase\(\)\}/);
  assert.match(api, /wb:build-config-lock:/);
  assert.match(api, /totalReserved = BUILD_CREDITS \+ configPricing\.total/);
  assert.match(api, /configCredits: configPricing\.total, configChanges: configPricing\.changes/);
  assert.match(api, /build_dispatch_failed_refund/);
});

test('native APK uses deployed HTTPS API and server-issued bearer token', () => {
  assert.match(apiBase, /https:\/\/wybuild-black\.vercel\.app/);
  assert.match(apiBase, /Preferences\.get\(\{ key: 'wybuild:nativeAccessToken' \}\)/);
  assert.match(apiBase, /headers\.Authorization = `Bearer \$\{value\}`/);
  assert.match(api, /wb:native-session:\$\{native\.jti\}/);
});

test('UI does not locally decide or charge new build features', () => {
  assert.match(twaView, /server compares this configuration with the last accepted build/);
  assert.doesNotMatch(twaView, /api\.chargeAction\(/);
});
