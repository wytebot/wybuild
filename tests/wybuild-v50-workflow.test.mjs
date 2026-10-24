import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { analyzeCompatibility } from '../.github/wybuild/compat-analyzer.mjs';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const workflows = ['../.github/workflows/wybuild-twa.yml', '../workflow/wybuild-twa.yml'];

test('both workflow copies pull Vercel Production config and expose Vite aliases', () => {
  for (const f of workflows) {
    const s = read(f);
    assert.match(s, /vercel@latest env pull .*--environment=production/);
    assert.match(s, /VERCEL_TOKEN/);
    assert.match(s, /VERCEL_ORG_ID/);
    assert.match(s, /VERCEL_PROJECT_ID/);
    assert.ok(s.includes(`trap 'rm -f "$VERCEL_ENV_FILE" .vercel/.env.production.local' EXIT`));
    assert.ok(s.includes(`rm -f "$VERCEL_ENV_FILE" .vercel/.env.production.local`));
    assert.match(s, /VITE_API_BASE_URL/);
    assert.match(s, /VITE_GOOGLE_WEB_CLIENT_ID/);
    assert.match(s, /REPO_API_SECRET: \$\{\{ secrets\.NEXT_PUBLIC_API_BASE_URL \|\| secrets\.VITE_API_BASE_URL \|\| secrets\.API_BASE_URL \}\}/);
    assert.match(s, /REPO_GOOGLE_CLIENT_SECRET: \$\{\{ secrets\.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID \|\| secrets\.VITE_GOOGLE_WEB_CLIENT_ID \|\| secrets\.GOOGLE_WEB_CLIENT_ID \}\}/);
    assert.match(s, /API_VALUE=\"\$\{VERCEL_API_FROM_PROJECT:-\$\{REPO_API_SECRET:-\$\{REPO_API_VARIABLE/);
    assert.match(s, /CLIENT_VALUE=\"\$\{VERCEL_CLIENT_FROM_PROJECT:-\$\{REPO_GOOGLE_CLIENT_SECRET:-\$\{REPO_GOOGLE_CLIENT_VARIABLE/);
  }
});

test('runtime config is injected with a root-absolute URL and checked in packaged assets', () => {
  for (const f of workflows) {
    const s = read(f);
    assert.match(s, /<script src="\/wybuild-runtime-config\.js"><\/script>/);
    assert.doesNotMatch(s, /<script src="\.\/wybuild-runtime-config\.js"><\/script>/);
    assert.match(s, /wybuild-runtime-config\.js into \$\{packaged\}/);
    assert.match(s, /must load \/wybuild-runtime-config\.js using a root-absolute path/);
  }
});

test('Vercel runtime config does not remove WyBuild native API/auth handoff', () => {
  const apiBase = read('../src/services/apiBase.ts');
  const login = read('../src/components/LoginScreen.tsx');
  assert.match(apiBase, /runtimeConfig\(\)\.apiBaseUrl/);
  assert.match(apiBase, /CANONICAL_API/);
  assert.match(login, /Browser\.open\(\{ url/);
  assert.match(login, /return=wybuild/);
  assert.match(login, /exchangeNativeCode/);
});

test('compatibility analyzer no longer filters the workspace merely because its path contains wybuild', () => {
  const analyzer = read('../.github/wybuild/compat-analyzer.mjs');
  assert.match(analyzer, /const ignored=\/\^\(\?:node_modules\|\\\.git\|dist\|build\|\\\.next\)\$\//);
  assert.doesNotMatch(analyzer, /const ignored=\/node_modules\|\\\.git\|dist\|build\|\\\.next\//);
  const empty = analyzeCompatibility([]);
  assert.equal(empty.summary.filesScanned, 0);
  assert.equal(empty.summary.status, 'amber');
  assert.ok(empty.findings.some((f) => f.id === 'analyzer-no-files'));
});
