import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCompatibility } from '../workflow/wybuild/compat-analyzer.mjs';
import { consumeHandoff, pkceChallenge, handoffKey } from '../api/native-handoff.mjs';

function memoryKv() {
  const data = new Map();
  return { data, async get(k) { return data.get(k) ?? null; }, async set(k,v,opts={}) { if(opts.nx && data.has(k)) return null; data.set(k,v); return 'OK'; }, async del(k) { return data.delete(k) ? 1 : 0; } };
}
const verifier = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const code = 'abcdefghijklmnopqrstuvwxyz_0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ';

test('PKCE handoff accepts matching verifier once', async () => {
  const kv=memoryKv(); await kv.set(handoffKey(code), {challenge:pkceChallenge(verifier),session:{login:'tester'},createdAt:1000});
  const rec=await consumeHandoff({kv,code,verifier,now:2000}); assert.equal(rec.session.login,'tester');
  await assert.rejects(()=>consumeHandoff({kv,code,verifier,now:2100}), e=>e.code==='HANDOFF_EXPIRED' || e.code==='HANDOFF_REPLAY');
});
test('PKCE handoff rejects mismatched verifier without consuming code', async () => {
  const kv=memoryKv(); await kv.set(handoffKey(code), {challenge:pkceChallenge(verifier),session:{login:'tester'},createdAt:1000});
  await assert.rejects(()=>consumeHandoff({kv,code,verifier:verifier.slice(1)+'x',now:2000}), e=>e.code==='HANDOFF_PKCE_MISMATCH');
  assert.ok(await kv.get(handoffKey(code)));
});
test('PKCE handoff rejects expired code', async () => {
  const kv=memoryKv(); await kv.set(handoffKey(code), {challenge:pkceChallenge(verifier),session:{login:'tester'},createdAt:1000});
  await assert.rejects(()=>consumeHandoff({kv,code,verifier,now:121001}), e=>e.code==='HANDOFF_EXPIRED');
});
test('compatibility analyzer reports blocking relative API and popup OAuth with file and line', () => {
  const report=analyzeCompatibility([{path:'src/main.tsx',content:"fetch('/api/users');\nconst x = signInWithPopup(auth, provider);"}]);
  assert.equal(report.summary.status,'red'); assert.ok(report.findings.some(f=>f.id==='same-origin-api'&&f.file==='src/main.tsx'&&f.line===1)); assert.ok(report.findings.some(f=>f.id==='oauth-popup'&&f.line===2));
});

test('Capacitor finalizer keeps a working MainActivity matcher and share-target insertion', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../.github/wybuild/capacitor-finalize.py', import.meta.url), 'utf8');
  assert.ok(source.includes("re.search(r'<activity\\b(?=[^>]*android:name=\"[^\"]*MainActivity\")[^>]*>', manifest_text)"));
  assert.ok(!source.includes("r'<activity\\\\b"), 'the matcher must not be over-escaped');
  const mock = '<manifest><application><activity android:name="com.example.MainActivity"></activity></application></manifest>';
  const activity = /<activity\b(?=[^>]*android:name="[^"]*MainActivity")[^>]*>/;
  assert.ok(activity.test(mock), 'mock MainActivity should match');
  const patched = mock.replace(activity, '$&\n<intent-filter><action android:name="android.intent.action.SEND"/><category android:name="android.intent.category.DEFAULT"/><data android:mimeType="text/plain"/></intent-filter>');
  assert.match(patched, /android\.intent\.action\.SEND/);
});

test('workflow templates and server version marker are aligned at v51', async () => {
  const fs = await import('node:fs');
  const api = fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  const live = fs.readFileSync(new URL('../.github/workflows/wybuild-twa.yml', import.meta.url), 'utf8');
  const template = fs.readFileSync(new URL('../workflow/wybuild-twa.yml', import.meta.url), 'utf8');
  assert.match(api, /const TWA_WORKFLOW_VERSION = 51;/);
  assert.match(live, /wybuild-twa-workflow-version: 51/);
  assert.match(template, /wybuild-twa-workflow-version: 51/);
  assert.equal(live.replaceAll('https://wybuild-black.vercel.app', '__WYBUILD_APP_URL__'), template);
});


test('PKCE handoff allows only one concurrent exchange', async () => {
  const kv = memoryKv();
  await kv.set(handoffKey(code), { challenge: pkceChallenge(verifier), session: { login: 'tester' }, createdAt: 1000 });
  const results = await Promise.allSettled([
    consumeHandoff({ kv, code, verifier, now: 2000 }),
    consumeHandoff({ kv, code, verifier, now: 2000 }),
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
});


test('native bearer origin relaxation requires a valid active session and no session cookie', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../api/index.js', import.meta.url), 'utf8');
  assert.match(source, /const hasSessionCookie = !!parseCookies\(req\)\[SESSION_COOKIE\]/);
  assert.match(source, /native\?\.aud === 'native' && native\.jti && Number\(native\.exp\) > Date\.now\(\)/);
  assert.match(source, /kv\.get\(`wb:native-session:\$\{native\.jti\}`\)/);
  assert.match(source, /bearerRequest = !revoked && !!active/);
});

test('native fetch wrapper preserves Request semantics when rewriting API URLs', async () => {
  const fs = await import('node:fs');
  const source = fs.readFileSync(new URL('../.github/wybuild/capacitor-bridge.entry.js', import.meta.url), 'utf8');
  assert.match(source, /new Request\(rewritten, input\)/);
  assert.match(source, /originalFetch\(requestInput, nextInit\)/);
  assert.match(source, /wybuild-native-auth/);
  assert.match(source, /wybuild-native-billing/);
});

test('bundled WebView cannot be stranded on a same-origin /api path', async () => {
  const fs = await import('node:fs'); const vm = await import('node:vm');
  const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  assert.match(read('vite.config.ts'), /base:\s*'\/'/, 'assets must be root-absolute');
  for (const d of ['.github/wybuild', 'workflow/wybuild']) {
    const diag = read(d + '/android-startup-diagnostics.js');
    const run = (pathname) => {
      const calls = []; const win = { addEventListener() {}, setTimeout() {} };
      const ctx = { window: win, location: { pathname, origin: 'https://localhost', replace: (u) => calls.push(u) }, document: { addEventListener() {}, getElementById() { return null; } }, navigator: { userAgent: 't' }, localStorage: { setItem() {} }, sessionStorage: { getItem() {}, setItem() {} }, console, Date, Array, String, Number, URL };
      vm.runInNewContext(diag, ctx); return { calls, installed: win.__WYBUILD_STARTUP_DIAGNOSTICS__ === true };
    };
    assert.deepEqual(run('/api/auth/login').calls, ['/'], d + ' must leave /api paths immediately');
    assert.deepEqual(run('/api').calls, ['/']);
    assert.deepEqual(run('/apiary').calls, [], '/apiary is not an API path');
    assert.deepEqual(run('/').calls, []);
    assert.ok(run('/').installed);
  }
  const bridge = read('.github/wybuild/capacitor-bridge.entry.js');
  assert.equal(bridge, read('workflow/wybuild/capacitor-bridge.entry.js'));
  assert.match(bridge, /isApiPath\(u\.pathname\)/);
});

test('APK verification gate rejects relative or missing packaged assets', async () => {
  const fs = await import('node:fs');
  const wf = fs.readFileSync(new URL('../.github/workflows/wybuild-twa.yml', import.meta.url), 'utf8');
  assert.match(wf, /references a relative asset/);
  assert.match(wf, /does not contain it/);
  assert.match(wf, /loads no JavaScript/);
});

test('push registration is refused (not crashed) when no Firebase config was packaged', async () => {
  const fs = await import('node:fs');
  const bridge = fs.readFileSync(new URL('../.github/wybuild/capacitor-bridge.entry.js', import.meta.url), 'utf8');
  const gate = bridge.indexOf('runtimeConfig.firebaseConfigured !== true');
  assert.ok(gate > 0 && gate < bridge.indexOf('PushNotifications.register()'), 'gate must precede the native register call');
  for (const f of ['.github/workflows/wybuild-twa.yml', 'workflow/wybuild-twa.yml']) assert.match(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'), /firebaseConfigured:/);
});
