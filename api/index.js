import crypto from 'node:crypto';
import fs from 'node:fs';
import { kv } from '../lib/kv.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import nacl from 'tweetnacl';
import blake from 'blakejs';

const WORKFLOW_FILE = 'wybuild.yml';
const WORKFLOW_PATH = `.github/workflows/${WORKFLOW_FILE}`;
const WORKFLOW_VERSION = 2;
const TWA_WORKFLOW_FILE = 'wybuild-twa.yml';
const TWA_WORKFLOW_PATH = `.github/workflows/${TWA_WORKFLOW_FILE}`;
const TWA_WORKFLOW_VERSION = 4;
// every file committed to a repo for each workflow kind: [path in repo, path in ./workflow]
const WORKFLOW_KINDS = {
  flutter: { file: WORKFLOW_FILE, path: WORKFLOW_PATH, version: WORKFLOW_VERSION, files: [[WORKFLOW_PATH, 'wybuild.yml']] },
  twa: {
    file: TWA_WORKFLOW_FILE,
    path: TWA_WORKFLOW_PATH,
    version: TWA_WORKFLOW_VERSION,
    files: [
      [TWA_WORKFLOW_PATH, 'wybuild-twa.yml'],
      ['.github/wybuild/twa-prepare.mjs', 'wybuild/twa-prepare.mjs'],
      ['.github/wybuild/twa-generate.mjs', 'wybuild/twa-generate.mjs'],
      ['.github/wybuild/twa-verify.sh', 'wybuild/twa-verify.sh'],
    ],
  },
};
const kindOf = (v) => (v === 'twa' ? 'twa' : 'flutter');
const SESSION_COOKIE = 'wb_session';
const STATE_COOKIE = 'wb_state';
const STALE_ACTIVE_MS = 3 * 60 * 60 * 1000;
const PLANS = {
  // Free users get 5 SUCCESSFUL builds per calendar month. Failed/cancelled
  // runs never consume this allowance. Pro has no monthly build cap.
  free: { monthlyLimit: 5, concurrentLimit: 1 },
  pro: { monthlyLimit: Number.MAX_SAFE_INTEGER, concurrentLimit: 5 },
};
const PRICING = { monthly: 10, yearly: 100 };
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SECRET_NAMES = ['WB_KEYSTORE_BASE64', 'WB_KEYSTORE_PASSWORD', 'WB_KEY_ALIAS', 'WB_KEY_PASSWORD'];

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ---------------------------------- utils --------------------------------- */

const env = (k) => process.env[k] || '';
const appUrl = (req) =>
  env('APP_URL').replace(/\/$/, '') ||
  `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers['x-forwarded-host'] || req.headers.host}`;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function redirect(res, location, cookies = []) {
  res.statusCode = 302;
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const cookie = (name, value, maxAge) =>
  `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

const key32 = () => {
  if (env('SESSION_SECRET').length < 16) throw new HttpError(500, 'SESSION_SECRET is not configured');
  return crypto.createHash('sha256').update(env('SESSION_SECRET')).digest();
};

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key32(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

function unseal(str) {
  try {
    const buf = Buffer.from(str, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key32(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

function oauthState(secret) {
  const payload = {
    n: crypto.randomBytes(16).toString('hex'),
    iat: Date.now(),
  };
  const raw = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', key32()).update(raw).digest('base64url');
  return `${raw}.${sig}`;
}

function verifyOAuthState(state) {
  try {
    const [raw, sig] = String(state || '').split('.');
    if (!raw || !sig) return false;
    const expected = crypto.createHmac('sha256', key32()).update(raw).digest('base64url');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    return Number.isFinite(payload.iat) && Date.now() - payload.iat >= 0 && Date.now() - payload.iat <= 10 * 60 * 1000;
  } catch {
    return false;
  }
}

function getSession(req) {
  const raw = parseCookies(req)[SESSION_COOKIE];
  const s = raw && unseal(raw);
  return s && s.exp > Date.now() ? s : null;
}

function requireSession(req) {
  const s = getSession(req);
  if (!s) throw new HttpError(401, 'Not signed in');
  return s;
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers['x-forwarded-host'] || req.headers.host);
  } catch {
    return false;
  }
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body || '{}');
  } catch {
    return {};
  }
}

function checkRepo(repo) {
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) throw new HttpError(400, 'Invalid repository');
  return repo;
}

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);

/* --------------------------------- GitHub --------------------------------- */

async function gh(session, path, init = {}) {
  const r = await fetch(path.startsWith('http') ? path : `https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${session.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wybuild',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  return r;
}

async function ghJson(session, path, init) {
  const r = await gh(session, path, init);
  if (r.status === 401) throw new HttpError(401, 'GitHub session expired, sign in again');
  const text = await r.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text };
  }
  if (!r.ok) throw new HttpError(r.status === 404 ? 404 : 502, data.message || `GitHub error ${r.status}`, 'GITHUB');
  return data;
}

/* --------------------------------- billing -------------------------------- */
/*
 * Flutterwave v4 billing.
 *
 * v4 uses OAuth2 access tokens and the v4 charge/payment-method APIs.
 * Never trust the browser to grant Pro: activation happens only after a
 * server-side charge lookup confirms reference, amount, currency and status.
 */
const FLW_V4_BASE = () => env('FLW_V4_BASE_URL') || 'https://f4bexperience.flutterwave.com';
let flwToken = null;
let flwTokenExpiresAt = 0;

async function flw4Token() {
  if (flwToken && Date.now() < flwTokenExpiresAt - 60_000) return flwToken;
  const clientId = env('FLW_CLIENT_ID');
  const clientSecret = env('FLW_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new HttpError(500, 'Flutterwave v4 credentials are not configured');
  const r = await fetch('https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new HttpError(502, data.error_description || data.message || 'Could not authenticate with Flutterwave v4');
  flwToken = data.access_token;
  flwTokenExpiresAt = Date.now() + Number(data.expires_in || 600) * 1000;
  return flwToken;
}

function traceId() {
  return crypto.randomUUID();
}
function idempotencyKey(prefix = 'wybuild') {
  return `${prefix}-${crypto.randomUUID()}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 120);
}

async function flw4(path, init = {}, opts = {}) {
  const token = await flw4Token();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Trace-Id': traceId(),
    'X-Idempotency-Key': idempotencyKey(opts.idempotencyPrefix || 'wybuild'),
    ...(init.headers || {}),
  };
  const r = await fetch(`${FLW_V4_BASE()}${path}`, { ...init, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = data?.error?.message || data?.message || `Flutterwave v4 error (${r.status})`;
    throw new HttpError(502, msg, 'FLW4');
  }
  return data;
}

function publicBillingConfig() {
  const key = env('FLW_ENCRYPTION_KEY');
  if (!key) throw new HttpError(500, 'FLW_ENCRYPTION_KEY is not configured');
  return { encryptionKey: key, currency: 'USD', pricing: PRICING };
}

async function getSubscription(login) {
  const sub = (await kv.get(`wb:sub:${login}`)) || (await kv.get(`ff:sub:${login}`));
  if (!sub || sub.plan !== 'pro') return null;
  const until = new Date(sub.nextBillingDate || 0).getTime();
  const grace = new Date(sub.graceUntil || 0).getTime();
  if ((sub.status === 'active' && until > Date.now()) || (sub.status === 'past_due' && grace > Date.now())) return sub;
  return null;
}

const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7);

async function usageFor(login) {
  const sub = await getSubscription(login);
  const plan = sub ? PLANS.pro : PLANS.free;
  const used = Number((await kv.get(`wb:month:${login}:${utcMonth()}`)) || 0);
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { sub, plan, usage: { monthlyBuildsUsed: used, monthlyLimit: plan.monthlyLimit, concurrentLimit: plan.concurrentLimit, resetsAt: next.toISOString() } };
}

async function getCharge(chargeId) {
  if (!/^chg_[A-Za-z0-9_-]+$/.test(String(chargeId || ''))) throw new HttpError(400, 'Invalid charge id');
  const r = await flw4(`/charges/${encodeURIComponent(chargeId)}`, { method: 'GET' });
  return r.data;
}

async function activateFromCharge(charge, expected, fallbackLogin) {
  if (!charge || charge.status !== 'succeeded') return false;
  const ref = String(charge.reference || '');
  const pending = await kv.get(`wb:tx:${ref}`);
  if (!pending || pending.login !== fallbackLogin && fallbackLogin) return false;
  if (!expected || Number(charge.amount) < Number(expected.amount) || String(charge.currency) !== String(expected.currency)) return false;
  const pmd = charge.payment_method_details || charge.payment_method || {};
  const customerId = charge.customer_id || charge.customer?.id || pending.customerId || '';
  const paymentMethodId = pmd.id || pending.paymentMethodId || '';
  if (!customerId || !paymentMethodId) throw new HttpError(502, 'Payment succeeded but recurring billing details were not returned');

  // Only mark the charge as processed once we know we can activate it, otherwise a retry/webhook would be skipped forever.
  const first = await kv.set(`wb:txdone:${ref}`, 1, { nx: true, ex: 60 * 60 * 24 * 90 });
  if (!first) return true;
  try {
  const existing = await kv.get(`wb:sub:${pending.login}`);
  const base = existing && new Date(existing.nextBillingDate).getTime() > Date.now()
    ? new Date(existing.nextBillingDate) : new Date();
  if (pending.cycle === 'yearly') base.setUTCFullYear(base.getUTCFullYear() + 1);
  else base.setUTCMonth(base.getUTCMonth() + 1);

  const sub = {
    plan: 'pro',
    billingCycle: pending.cycle,
    status: 'active',
    nextBillingDate: base.toISOString(),
    graceUntil: '',
    amount: Number(charge.amount),
    currency: String(charge.currency),
    flwTransactionRef: ref,
    flwChargeId: String(charge.id || ''),
    customerEmail: pending.customerEmail || '',
    customerId,
    paymentMethodId,
    cardLast4: pmd.card?.last4 || pmd.card?.last_4digits,
    cardBrand: pmd.card?.network || pmd.card?.type,
  };
  await kv.set(`wb:sub:${pending.login}`, sub);
  await kv.sadd(`wb:subscribers`, pending.login);
  await kv.set(`wb:cust:${pending.login}`, customerId);
  return true;
  } catch (e) {
    await kv.del(`wb:txdone:${ref}`).catch(() => {}); // let the webhook / status poll retry
    throw e;
  }
}

async function reconcileCharge(chargeId, login) {
  const charge = await getCharge(chargeId);
  const ref = String(charge.reference || '');
  const pending = await kv.get(`wb:tx:${ref}`);
  if (!pending || pending.login !== login) throw new HttpError(403, 'Payment does not belong to this account');
  if (charge.status === 'succeeded') {
    await activateFromCharge(charge, pending, login);
  }
  return {
    id: charge.id,
    reference: ref,
    status: charge.status,
    nextAction: charge.next_action || null,
    redirectUrl: charge.next_action?.redirect_url?.url || charge.redirect_url || null,
  };
}

async function createV4Checkout(session, body, base) {
  const cycle = body.cycle;
  if (!PRICING[cycle]) throw new HttpError(400, 'Invalid billing cycle');
  const card = body.card || {};
  for (const k of ['nonce', 'encrypted_card_number', 'encrypted_expiry_month', 'encrypted_expiry_year', 'encrypted_cvv']) {
    if (!card[k] || typeof card[k] !== 'string') throw new HttpError(400, `Missing encrypted card field: ${k}`);
  }
  if (String(card.nonce).length !== 12) throw new HttpError(400, 'Invalid card encryption nonce');

  const email = session.email || `${session.login}@users.noreply.github.com`;
  // Flutterwave rejects a second customer with the same email, so reuse the one we already created for this user.
  let customerId = (await kv.get(`wb:cust:${session.login}`)) || (await kv.get(`wb:sub:${session.login}`))?.customerId || '';
  if (!customerId) {
    const customer = await flw4('/customers', {
      method: 'POST',
      body: JSON.stringify({
        email,
        name: { first: String(session.name || session.login).split(/\s+/)[0].slice(0, 60), last: String(session.name || '').split(/\s+/).slice(1).join(' ').slice(0, 60) || undefined },
        meta: { wybuild_login: session.login },
      }),
    }, { idempotencyPrefix: `customer-${session.login}` });
    customerId = customer.data?.id;
    if (!customerId) throw new HttpError(502, 'Flutterwave did not return a customer id');
    await kv.set(`wb:cust:${session.login}`, customerId);
  }

  const paymentMethod = await flw4('/payment-methods', {
    method: 'POST',
    body: JSON.stringify({
      type: 'card',
      card: {
        nonce: card.nonce,
        encrypted_card_number: card.encrypted_card_number,
        encrypted_expiry_month: card.encrypted_expiry_month,
        encrypted_expiry_year: card.encrypted_expiry_year,
        encrypted_cvv: card.encrypted_cvv,
      },
    }),
  }, { idempotencyPrefix: `payment-method-${session.login}` });

  const paymentMethodId = paymentMethod.data?.id;
  if (!paymentMethodId) throw new HttpError(502, 'Flutterwave did not return a payment method id');

  const reference = `wb-${session.login}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 42);
  await kv.set(`wb:tx:${reference}`, {
    login: session.login,
    cycle,
    amount: PRICING[cycle],
    currency: 'USD',
    customerId,
    paymentMethodId,
    customerEmail: email,
  }, { ex: 60 * 60 * 24 * 3 });

  const charge = await flw4('/charges', {
    method: 'POST',
    body: JSON.stringify({
      reference,
      amount: PRICING[cycle],
      currency: 'USD',
      customer_id: customerId,
      payment_method_id: paymentMethodId,
      redirect_url: `${base}/api/billing/callback`,
      meta: { wybuild_login: session.login, cycle },
    }),
  }, { idempotencyPrefix: `charge-${reference}` });

  const d = charge.data;
  if (!d?.id) throw new HttpError(502, 'Flutterwave did not return a charge id');
  await kv.set(`wb:charge:${d.id}`, { login: session.login, reference }, { ex: 60 * 60 * 24 * 3 });

  if (d.status === 'succeeded') await activateFromCharge(d, { amount: PRICING[cycle], currency: 'USD' }, session.login);
  return {
    chargeId: d.id,
    reference,
    status: d.status,
    nextAction: d.next_action || null,
    redirectUrl: d.next_action?.redirect_url?.url || d.redirect_url || null,
  };
}

function appUrlFromEnv() {
  return (env('APP_URL') || 'https://wybuild.app').replace(/\/$/, '');
}

async function renewDueSubscriptions() {
  const logins = await kv.smembers('wb:subscribers');
  let processed = 0;
  for (const login of logins || []) {
    const sub = await kv.get(`wb:sub:${login}`);
    if (!sub || !sub.customerId || !sub.paymentMethodId) continue;
    if (new Date(sub.nextBillingDate).getTime() > Date.now()) continue;
    const ref = `wb-renew-${login}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 42);
    try {
      const charge = await flw4('/charges', {
        method: 'POST',
        body: JSON.stringify({
          reference: ref,
          amount: Number(sub.amount),
          currency: sub.currency || 'USD',
          customer_id: sub.customerId,
          payment_method_id: sub.paymentMethodId,
          recurring: true,
          redirect_url: `${appUrlFromEnv()}/api/billing/callback`,
          meta: { wybuild_login: login, renewal: true, cycle: sub.billingCycle },
        }),
      }, { idempotencyPrefix: `renew-${login}-${utcDay()}` });
      const d = charge.data;
      if (d?.status === 'succeeded') {
        const next = new Date(sub.nextBillingDate);
        if (sub.billingCycle === 'yearly') next.setUTCFullYear(next.getUTCFullYear() + 1);
        else next.setUTCMonth(next.getUTCMonth() + 1);
        await kv.set(`wb:sub:${login}`, { ...sub, status: 'active', nextBillingDate: next.toISOString(), graceUntil: '', flwTransactionRef: ref, flwChargeId: d.id });
      } else {
        const grace = new Date(Date.now() + 3 * 24 * 3600 * 1000);
        await kv.set(`wb:sub:${login}`, { ...sub, status: 'past_due', graceUntil: grace.toISOString(), flwTransactionRef: ref, flwChargeId: d?.id || '' });
      }
      processed++;
    } catch {
      const grace = new Date(Date.now() + 3 * 24 * 3600 * 1000);
      await kv.set(`wb:sub:${login}`, { ...sub, status: 'past_due', graceUntil: grace.toISOString() });
    }
  }
  return processed;
}

/* --------------------------------- runs ----------------------------------- */

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

function mapStatus(run) {
  if (run.status !== 'completed') return run.status === 'in_progress' ? 'running' : 'queued';
  if (run.conclusion === 'success') return 'success';
  if (run.conclusion === 'cancelled') return 'cancelled';
  return 'failed';
}

function mapRun(run, repo) {
  const title = run.display_title || run.name || '';
  const t = /^WyBuild TWA (\S+)\/(\S+) on /.exec(title);
  const m = t ? null : /^WyBuild (\S+)\/(\S+)\/(\S+) on /.exec(title);
  const started = run.run_started_at || run.created_at;
  const done = run.status === 'completed';
  return {
    id: String(run.id),
    runId: run.id,
    repo,
    htmlUrl: run.html_url,
    projectId: '',
    projectName: repo.split('/')[1],
    branch: run.head_branch || '',
    commitHash: (run.head_sha || '').slice(0, 7),
    commitMessage: (run.head_commit?.message || '').split('\n')[0],
    author: run.triggering_actor?.login || run.actor?.login || '',
    status: mapStatus(run),
    startedAt: started,
    finishedAt: done ? run.updated_at : undefined,
    durationSeconds: Math.max(0, Math.round(((done ? Date.parse(run.updated_at) : Date.now()) - Date.parse(started)) / 1000)),
    kind: t ? 'twa' : 'flutter',
    target: t ? (t[2] === 'aab' ? 'appbundle' : 'apk') : m ? m[1] : 'apk',
    mode: m ? m[2] : 'release',
    flutterVersion: m ? m[3] : 'stable',
    ...(t ? { twa: { packageId: t[1], output: t[2] } } : {}),
    runnerType: 'shared-standard',
    steps: [],
    artifacts: [],
  };
}

async function refundIfNeeded(session, repo, run) {
  if ((run.triggering_actor?.login || '').toLowerCase() !== session.login.toLowerCase()) return;
  if (run.status !== 'completed') return;

  // Every terminal run releases one server-side concurrency reservation.
  const released = await kv.set(`wb:release-inflight:${repo}:${run.id}`, 1, { nx: true, ex: 60 * 60 * 24 * 3 });
  if (released) {
    const ik = `wb:inflight:${session.login}`;
    const inFlight = await kv.decr(ik);
    if (inFlight < 0) await kv.set(ik, 0);
  }

  // Only successful terminal runs consume the Free monthly allowance.
  if (run.conclusion !== 'success') return;
  const first = await kv.set(`wb:success-counted:${repo}:${run.id}`, 1, { nx: true, ex: 60 * 60 * 24 * 370 });
  if (!first) return;
  const monthKey = `wb:month:${session.login}:${utcMonth(new Date(run.updated_at || run.created_at))}`;
  await kv.incr(monthKey);
  await kv.expire(monthKey, 60 * 60 * 24 * 370);
}

async function workflowRuns(session, repo, file, perPage) {
  try {
    return (await ghJson(session, `/repos/${repo}/actions/workflows/${file}/runs?per_page=${perPage}`)).workflow_runs || [];
  } catch (e) {
    if (e.status === 404) return []; // workflow not installed in this repo yet
    throw e;
  }
}

async function listRuns(session, repo) {
  const runs = (await Promise.all([WORKFLOW_FILE, TWA_WORKFLOW_FILE].map((f) => workflowRuns(session, repo, f, 15)))).flat();
  await Promise.all(runs.map((r) => refundIfNeeded(session, repo, r).catch(() => {})));
  return runs;
}

const STEP_STATUS = (s) => {
  if (s.status === 'completed') return s.conclusion === 'success' ? 'success' : s.conclusion === 'skipped' ? 'skipped' : 'failed';
  return s.status === 'in_progress' ? 'running' : 'pending';
};

const DIAGNOSES = [
  { re: /Store-ready mode|store-readiness|WB_KEYSTORE_BASE64 secret is missing|Signed with the Android debug|key-continuity/i, category: 'keystore', title: 'Not ready for APKMirror / Uptodown', fix: 'Open the store-readiness report in the artifact or job summary. Typical fixes: upload your own release keystore, keep the same key as earlier releases, and avoid com.example-style package ids.' },
  { re: /No app icon|icon.*manifest|bubblewrap build failed|Invalid TWA manifest|Invalid Android package id/i, category: 'twa_config', title: 'TWA setup is incomplete', fix: 'The website needs a valid Web App Manifest, a usable app icon (512px recommended), and a stable package ID. WyBuild now generates the package ID from the domain for free.' },
  { re: /key\.properties|keystore|Keystore was tampered|WB_KEYSTORE/i, category: 'keystore', title: 'Release signing problem', fix: 'Use the same release keystore as the previous APK and confirm the four WB_KEYSTORE_* GitHub Actions secrets are present.' },
  { re: /version solving failed|Could not resolve|pub get failed/i, category: 'dependency', title: 'Dependency resolution failed', fix: 'Run flutter pub get locally, commit pubspec.lock, and check SDK constraints in pubspec.yaml.' },
  { re: /compileSdk|Android SDK|NDK|Unsupported class file major version/i, category: 'gradle', title: 'Android Gradle / SDK mismatch', fix: 'Align compileSdk, AGP and Gradle versions with the Flutter version used for the build.' },
  { re: /Flutter SDK|requires Dart SDK|Dart SDK version/i, category: 'flutter_sdk', title: 'Flutter / Dart SDK version mismatch', fix: 'Pin a Flutter version that satisfies the sdk constraint in pubspec.yaml.' },
];

function splitLogsIntoSteps(text, steps) {
  const lines = String(text || '').split('\n');
  const bucket = steps.map(() => []);
  let cur = 0;
  for (const line of lines) {
    const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?)Z\s?(.*)$/.exec(line);
    if (!m) {
      if (line.trim()) bucket[cur].push(line.trim());
      continue;
    }
    const ts = Date.parse(`${m[1].slice(0, 23)}Z`);
    while (cur + 1 < steps.length && steps[cur + 1].started_at && Date.parse(steps[cur + 1].started_at) - 1000 <= ts) cur++;
    bucket[cur].push(m[2].replace(/^##\[group\]/, '▸ ').replace(/^##\[endgroup\]$/, ''));
  }
  return bucket.map((b) => b.filter(Boolean).slice(-300));
}

async function runDetail(session, repo, id) {
  const [run, jobs, arts] = await Promise.all([
    ghJson(session, `/repos/${repo}/actions/runs/${id}`),
    ghJson(session, `/repos/${repo}/actions/runs/${id}/jobs`),
    ghJson(session, `/repos/${repo}/actions/runs/${id}/artifacts`),
  ]);
  const build = mapRun(run, repo);
  const job = (jobs.jobs || [])[0];
  if (job) {
    const ghSteps = job.steps || [];
    let buckets = ghSteps.map(() => []);
    if (job.status !== 'queued') {
      const lr = await gh(session, `/repos/${repo}/actions/jobs/${job.id}/logs`).catch(() => null);
      if (lr && lr.ok) {
        const rawLogs = await lr.text();
        buckets = splitLogsIntoSteps(rawLogs, ghSteps);
        if (ghSteps.length && buckets.every((b) => b.length === 0) && rawLogs.trim()) buckets[0] = rawLogs.split('\n').filter(Boolean).slice(-500);
      }
    }
    build.steps = ghSteps.map((s, i) => {
      const errLine = buckets[i].filter((l) => l.startsWith('##[error]')).pop();
      return {
        id: `step-${s.number}`,
        name: s.name,
        status: STEP_STATUS(s),
        durationMs: s.started_at && s.completed_at ? Math.max(0, Date.parse(s.completed_at) - Date.parse(s.started_at)) : 0,
        logs: buckets[i],
        ...(errLine ? { error: errLine.replace('##[error]', '') } : {}),
      };
    });
    if (build.status === 'failed') {
      const all = build.steps.flatMap((s) => s.logs).join('\n');
      const hit = DIAGNOSES.find((d) => d.re.test(all));
      const failedStep = build.steps.find((s) => s.status === 'failed');
      if (hit || failedStep) {
        build.errorDiagnosis = {
          id: `diag-${id}`,
          title: hit ? hit.title : `Step failed: ${failedStep.name}`,
          category: hit ? hit.category : 'gradle',
          severity: 'critical',
          matchedPattern: failedStep?.error || failedStep?.name || '',
          description: failedStep?.error || 'The build failed. Open the failed step logs for details.',
          suggestedFix: hit ? hit.fix : 'Inspect the failing step logs; re-run once fixed.',
          autoFixAvailable: false,
        };
      }
    }
  }
  if (build.kind === 'twa') {
    const all = build.steps.flatMap((s) => s.logs).join('\n');
    const pick = (k) => ((new RegExp(`WYBUILD_${k}=(.+)`).exec(all) || [])[1] || '').trim();
    build.twa = { ...build.twa, versionName: pick('VERSION'), fingerprint: pick('FINGERPRINT') };
    if (pick('PACKAGE')) build.twa.packageId = pick('PACKAGE');
  }
  const aab = build.target === 'appbundle';
  build.artifacts = (arts.artifacts || [])
    .filter((a) => !a.expired)
    .map((a) => ({
      name: `${a.name}.zip`,
      type: build.kind === 'twa' ? 'bundle' : aab ? 'aab' : 'apk',
      sizeBytes: a.size_in_bytes,
      sizeFormatted: `${(a.size_in_bytes / 1048576).toFixed(1)} MB`,
      downloadUrl: `/api/artifact?repo=${encodeURIComponent(repo)}&id=${a.id}`,
      sha256: String(a.digest || '').replace('sha256:', ''),
    }));
  return build;
}

/* -------------------------------- keystores ------------------------------- */

function sealedBox(message, publicKeyB64) {
  const pk = Buffer.from(publicKeyB64, 'base64');
  const eph = nacl.box.keyPair();
  const nonce = Buffer.from(blake.blake2b(Buffer.concat([Buffer.from(eph.publicKey), pk]), undefined, 24));
  const ct = nacl.box(Buffer.from(message, 'utf8'), nonce, pk, eph.secretKey);
  return Buffer.concat([Buffer.from(eph.publicKey), Buffer.from(ct)]).toString('base64');
}

async function putSecret(session, repo, pub, name, value) {
  const r = await gh(session, `/repos/${repo}/actions/secrets/${name}`, {
    method: 'PUT',
    body: JSON.stringify({ encrypted_value: sealedBox(value, pub.key), key_id: pub.key_id }),
  });
  if (!r.ok) throw new HttpError(502, `Could not store secret ${name} (GitHub ${r.status})`);
}

async function keystoresFor(session, repos) {
  const out = [];
  for (const repo of repos) {
    try {
      const data = await ghJson(session, `/repos/${repo}/actions/secrets?per_page=100`);
      if (!(data.secrets || []).some((s) => s.name === 'WB_KEYSTORE_BASE64')) continue;
      const meta = (await kv.get(`wb:ks:${session.login}:${repo}`)) || {};
      out.push({
        id: repo,
        repo,
        name: meta.name || `${repo} signing key`,
        alias: meta.alias || 'unknown',
        storePasswordMasked: '••••••••••••',
        keyPasswordMasked: '••••••••••••',
        validityYears: 25,
        fingerprintSha256: meta.sha256 || '',
        createdAt: meta.createdAt || new Date().toISOString(),
        isDefault: false,
      });
    } catch {
      /* repo not accessible: skip */
    }
  }
  return out;
}

/* ---------------------------- quota + TWA helpers --------------------------- */

// Checks successful-monthly + concurrent limits and reserves only concurrency.
// A build is counted against the Free allowance only after GitHub reports a successful run.
async function reserveBuildSlot(session, repo) {
  const { plan, usage } = await usageFor(session.login);
  const inflightKey = `wb:inflight:${session.login}`;
  if (usage.monthlyBuildsUsed >= plan.monthlyLimit) {
    throw new HttpError(402, `Free build allowance reached (${plan.monthlyLimit} successful builds this month). Upgrade to Pro for unlimited builds.`, 'LIMIT');
  }

  const inflight = await kv.incr(inflightKey);
  await kv.expire(inflightKey, 60 * 60 * 24 * 3);
  if (inflight > plan.concurrentLimit) {
    await kv.decr(inflightKey);
    throw new HttpError(429, `Concurrent build limit reached (${plan.concurrentLimit}). Wait for a running build or upgrade to Pro.`, 'CONCURRENCY');
  }

  await kv.sadd(`wb:repos:${session.login}`, repo);
  return { inflightKey };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const PERM_RE = /^[A-Za-z][A-Za-z0-9_.]*$/;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

function cleanHttps(v, what, required = false) {
  const t = str(v, 500);
  if (!t) {
    if (required) throw new HttpError(400, `${what} is required`);
    return '';
  }
  let u;
  try {
    u = new URL(t);
  } catch {
    throw new HttpError(400, `${what} must be a full URL`);
  }
  if (u.protocol !== 'https:') throw new HttpError(400, `${what} must use https://`);
  return u.href;
}

// Validates the TWA form and returns the JSON handed to the workflow (one input, because GitHub caps dispatch inputs at 25)
function cleanTwaConfig(c = {}) {
  const out = { webUrl: cleanHttps(c.webUrl, 'Web app URL', true) };
  const host = new URL(out.webUrl).hostname.replace(/^www\./, '').toLowerCase();
  const parts = host.split('.').filter(Boolean).reverse().map((x) => x.replace(/[^a-z0-9_]/g, '')).filter(Boolean);
  const generatedPackage = parts.map((x) => /^[a-z]/.test(x) ? x : `a${x}`).join('.').slice(0, 140);
  if (c.packageId) {
    out.packageId = str(c.packageId, 150);
    if (!PKG_RE.test(out.packageId)) throw new HttpError(400, 'Package id must look like com.company.app (lowercase letters, digits, underscores)');
    if (/^(com\.example|com\.android|android|com\.google|org\.chromium)(\.|$)/.test(out.packageId)) throw new HttpError(400, 'That package namespace is reserved. Use your own, e.g. com.yourbrand.app');
  } else if (generatedPackage && PKG_RE.test(generatedPackage)) {
    out.packageId = generatedPackage;
  }
  for (const k of ['name', 'launcherName']) if (c[k]) out[k] = str(c[k], 60);
  if (c.versionName) {
    out.versionName = str(c.versionName, 30);
    if (!/^[0-9A-Za-z][0-9A-Za-z._+-]*$/.test(out.versionName)) throw new HttpError(400, 'Invalid version name');
  }
  if (c.versionCode) {
    out.versionCode = Number(c.versionCode);
    if (!Number.isInteger(out.versionCode) || out.versionCode < 1 || out.versionCode > 2100000000) throw new HttpError(400, 'Version code must be a positive integer');
  }
  for (const k of ['themeColor', 'themeColorDark', 'backgroundColor', 'navigationColor']) {
    if (c[k]) {
      if (!HEX.test(c[k])) throw new HttpError(400, `${k} must be a #RRGGBB colour`);
      out[k] = c[k];
    }
  }
  if (c.startUrl) {
    out.startUrl = str(c.startUrl, 300);
    if (!out.startUrl.startsWith('/')) throw new HttpError(400, 'Start URL must be a path such as /app/');
  }
  for (const k of ['iconUrl', 'maskableIconUrl', 'monochromeIconUrl', 'webManifestUrl']) if (c[k]) out[k] = cleanHttps(c[k], k);
  if (c.display) {
    if (!['standalone', 'fullscreen', 'minimal-ui'].includes(c.display)) throw new HttpError(400, 'Invalid display mode');
    out.display = c.display;
  }
  if (c.orientation) {
    if (!['default', 'portrait', 'landscape'].includes(c.orientation)) throw new HttpError(400, 'Invalid orientation');
    out.orientation = c.orientation;
  }
  // WyBuild web-to-Android is always a Trusted Web Activity. A WebView fallback is
  // deliberately not exposed because it changes the product into a WebView wrapper.
  out.fallbackType = 'customtabs';
  for (const k of ['enableNotifications', 'enableSiteSettingsShortcut', 'locationDelegation', 'playBilling', 'isChromeOSOnly']) if (k in c) out[k] = !!c[k];
  if (c.minSdkVersion) {
    out.minSdkVersion = Number(c.minSdkVersion);
    if (!Number.isInteger(out.minSdkVersion) || out.minSdkVersion < 21 || out.minSdkVersion > 35) throw new HttpError(400, 'minSdkVersion must be between 21 and 35');
  }
  out.additionalTrustedOrigins = (Array.isArray(c.additionalTrustedOrigins) ? c.additionalTrustedOrigins : []).slice(0, 20).map((o) => str(o, 200)).filter(Boolean);
  out.androidPermissions = (Array.isArray(c.androidPermissions) ? c.androidPermissions : []).slice(0, 30).map((p) => str(p, 120)).filter(Boolean);
  if (out.androidPermissions.some((p) => !PERM_RE.test(p))) throw new HttpError(400, 'Invalid Android permission name');
  out.shortcuts = (Array.isArray(c.shortcuts) ? c.shortcuts : []).slice(0, 4).map((s) => ({ name: str(s?.name, 40), shortName: str(s?.shortName || s?.name, 12), url: str(s?.url, 300) })).filter((s) => s.name && s.url.startsWith('/'));
  if (c.expectedFingerprint) {
    out.expectedFingerprint = str(c.expectedFingerprint, 120);
    if (!/^([0-9A-Fa-f]{2}:?){32}$/.test(out.expectedFingerprint)) throw new HttpError(400, 'Fingerprint must be a SHA-256 value (64 hex characters)');
  }
  return out;
}

/* ------------------------- SSRF-safe fetch for the inspector ------------------------- */

function isPrivateIp(ip) {
  if (net.isIPv6(ip)) {
    const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (v4) return isPrivateIp(v4[1]);
    return /^(::|f[cd]|fe[89ab])/i.test(ip); // loopback/unspecified, unique-local, link-local
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function safeFetch(url, { json = false, maxBytes = 1_000_000 } = {}) {
  let current = new URL(url);
  for (let hop = 0; hop < 4; hop++) {
    if (current.protocol !== 'https:') throw new HttpError(400, 'Only https:// sites can be inspected');
    if (current.port && current.port !== '443') throw new HttpError(400, 'Only the default HTTPS port is allowed');
    const addrs = await dns.lookup(current.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, 'That host is not reachable from the public internet');
    const r = await fetch(current.href, { redirect: 'manual', headers: { 'User-Agent': 'WyBuild-Inspector/1.0', Accept: json ? 'application/json' : 'text/html,*/*' }, signal: AbortSignal.timeout(10000) });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      current = new URL(r.headers.get('location'), current);
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > maxBytes) throw new HttpError(400, 'Response too large');
    return { status: r.status, finalUrl: current.href, text: buf.toString('utf8'), contentType: r.headers.get('content-type') || '' };
  }
  throw new HttpError(400, 'Too many redirects');
}

async function inspectSite(rawUrl) {
  const url = cleanHttps(rawUrl, 'Web app URL', true);
  const checks = [];
  const add = (id, ok, msg, level = 'warn') => checks.push({ id, ok, level: ok ? 'ok' : level, msg });
  const page = await safeFetch(url);
  add('reachable', page.status >= 200 && page.status < 300, `Start page responded with HTTP ${page.status}`, 'error');
  const finalUrl = new URL(page.finalUrl);
  const tag = /<link[^>]+rel=["']?[^"'>]*manifest[^"'>]*["']?[^>]*>/i.exec(page.text);
  const href = tag && /href=["']?([^"'\s>]+)/i.exec(tag[0]);
  let manifest = null;
  let manifestUrl = '';
  if (href) {
    manifestUrl = new URL(href[1].replace(/&amp;/g, '&'), finalUrl).href;
    try {
      manifest = JSON.parse((await safeFetch(manifestUrl, { json: true })).text);
    } catch {
      /* reported below */
    }
  }
  add('manifest', !!manifest, manifest ? 'Web App Manifest found and valid JSON' : 'No readable Web App Manifest; fill the form manually (Chrome needs a manifest for a good install experience)');
  const icons = Array.isArray(manifest?.icons) ? manifest.icons : [];
  const size = (i) => Math.max(0, ...String(i.sizes || '').split(/\s+/).map((x) => parseInt(x, 10) || 0));
  const abs = (u) => (u ? new URL(u, manifestUrl || finalUrl).href : '');
  const best = icons.filter((i) => !/maskable|monochrome/.test(i.purpose || '')).sort((a, b) => size(b) - size(a))[0] || icons.sort((a, b) => size(b) - size(a))[0];
  const maskable = icons.find((i) => /maskable/.test(i.purpose || ''));
  add('icon-512', !!best && size(best) >= 512, best ? `Largest icon is ${size(best) || '?'}px` : 'No icons in manifest');
  add('maskable', !!maskable, maskable ? 'Maskable icon present' : 'No maskable icon: Android will pad the icon on a white tile');
  let assetlinks = null;
  try {
    const al = await safeFetch(`${finalUrl.origin}/.well-known/assetlinks.json`, { json: true });
    assetlinks = al.status === 200 ? JSON.parse(al.text) : null;
  } catch {
    /* none yet */
  }
  const host = finalUrl.hostname.replace(/^www\./, '');
  const startUrl = manifest?.start_url ? new URL(manifest.start_url, manifestUrl || finalUrl) : null;
  return {
    detected: {
      webUrl: finalUrl.origin + (finalUrl.pathname === '/' ? '/' : finalUrl.pathname),
      webManifestUrl: manifestUrl || undefined,
      name: manifest?.name || '',
      launcherName: (manifest?.short_name || manifest?.name || '').slice(0, 30),
      themeColor: HEX.test(manifest?.theme_color || '') ? manifest.theme_color : '',
      backgroundColor: HEX.test(manifest?.background_color || '') ? manifest.background_color : '',
      startUrl: startUrl ? startUrl.pathname + startUrl.search : '/',
      display: ['fullscreen', 'minimal-ui'].includes(manifest?.display) ? manifest.display : 'standalone',
      orientation: /portrait/.test(manifest?.orientation || '') ? 'portrait' : /landscape/.test(manifest?.orientation || '') ? 'landscape' : 'default',
      iconUrl: best ? abs(best.src) : '',
      maskableIconUrl: maskable ? abs(maskable.src) : '',
      packageId: host.split('.').reverse().map((x) => x.replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean).map((x) => (/^[a-z]/.test(x) ? x : `a${x}`)).join('.'),
    },
    checks,
    assetlinks: assetlinks ? { present: true, packages: assetlinks.map((e) => e?.target?.package_name).filter(Boolean) } : { present: false, packages: [] },
  };
}

/* --------------------------------- routes --------------------------------- */

async function route(req, res, path, query) {
  const m = req.method;
  const post = m === 'POST';
  if (m !== 'GET' && !sameOrigin(req) && path !== 'billing/webhook') throw new HttpError(403, 'Bad origin');

  /* auth */
  if (path === 'auth/login') {
    if (!env('GITHUB_CLIENT_ID')) throw new HttpError(500, 'GitHub OAuth is not configured');
    // Stateless, signed OAuth state avoids Vercel/host cookie mismatches while
    // retaining CSRF protection. The signature is tied to SESSION_SECRET.
    const state = oauthState();
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', env('GITHUB_CLIENT_ID'));
    url.searchParams.set('redirect_uri', `${appUrl(req)}/api/auth/callback`);
    url.searchParams.set('scope', 'repo workflow');
    url.searchParams.set('state', state);
    return redirect(res, url.toString());
  }

  if (path === 'auth/callback') {
    if (!query.code || !query.state || !verifyOAuthState(query.state)) {
      throw new HttpError(400, 'Invalid or expired OAuth state. Please start GitHub sign-in again.');
    }

    // Exchange the code and set the session cookie right here. The browser is
    // then sent to a relative '/', so it stays on the exact host that received
    // the cookie. No KV store or second hop is involved, so a missing/unlinked
    // KV store can no longer break sign-in.
    const callbackUrl = `${appUrl(req)}/api/auth/callback`;
    const tr = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: env('GITHUB_CLIENT_ID'), client_secret: env('GITHUB_CLIENT_SECRET'), code: query.code, redirect_uri: callbackUrl }),
    });
    const t = await tr.json();
    if (!t.access_token) throw new HttpError(400, t.error_description || 'GitHub sign-in failed');
    const u = await ghJson({ token: t.access_token }, '/user');
    const session = { token: t.access_token, login: u.login, name: u.name || u.login, avatar: u.avatar_url, email: u.email || '', exp: Date.now() + 7 * 24 * 3600 * 1000 };
    return redirect(res, '/', [cookie(SESSION_COOKIE, seal(session), 7 * 24 * 3600)]);
  }

  if (path === 'auth/logout' && post) {
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, '', 0));
    return send(res, 200, { ok: true });
  }

  /* billing webhook + callback: authenticated by Flutterwave, not by session */
  if (path === 'billing/webhook' && post) {
    const want = env('FLW_SECRET_HASH');
    const safeEq = (a, b) => a.length === b.length && a.length > 0 && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
    const legacy = String(req.headers['verif-hash'] || '');
    const sig = String(req.headers['flutterwave-signature'] || '');
    const expectedSig = want ? crypto.createHmac('sha256', want).update(JSON.stringify(req.body ?? {})).digest('base64') : '';
    const ok = !!want && (safeEq(legacy, want) || safeEq(sig, expectedSig));
    if (!ok) throw new HttpError(401, 'Invalid signature');
    const id = bodyOf(req)?.data?.id;
    if (id) {
      try {
        const charge = await getCharge(String(id));
        const ref = String(charge.reference || bodyOf(req)?.data?.reference || '');
        const pending = await kv.get(`wb:tx:${ref}`);
        if (pending) await activateFromCharge(charge, pending, pending.login);
      } catch (e) {
        console.error('Flutterwave webhook reconciliation failed', e);
      }
    }
    return send(res, 200, { ok: true });
  }

  if (path === 'billing/callback') {
    const chargeId = query.charge_id || query.id || query.transaction_id;
    const ref = query.reference || query.tx_ref;
    let result = 'failed';
    try {
      if (chargeId) {
        const login = (await kv.get(`wb:charge:${chargeId}`))?.login;
        if (login) {
          const state = await reconcileCharge(String(chargeId), login);
          result = state.status === 'succeeded' ? 'success' : state.status === 'pending' ? 'pending' : 'failed';
        }
      } else if (ref) {
        const pending = await kv.get(`wb:tx:${ref}`);
        if (pending) {
          const sub = await getSubscription(pending.login);
          result = sub ? 'success' : 'pending';
        }
      }
    } catch {
      result = 'failed';
    }
    return redirect(res, `${appUrl(req)}/?billing=${result}`);
  }

  if (path === 'billing/renew' && m === 'GET') {
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const cron = env('CRON_SECRET');
    if (!cron || given !== cron) throw new HttpError(401, 'Unauthorized');
    const processed = await renewDueSubscriptions();
    return send(res, 200, { ok: true, processed });
  }

  /* everything below needs a session */
  const session = requireSession(req);

  if (path === 'billing/config' && m === 'GET') {
    return send(res, 200, publicBillingConfig());
  }

  if (path === 'billing/checkout' && post) {
    return send(res, 200, await createV4Checkout(session, bodyOf(req), appUrl(req)));
  }

  if (path === 'billing/authorize' && post) {
    const b = bodyOf(req);
    const chargeId = String(b.chargeId || '');
    const owner = await kv.get(`wb:charge:${chargeId}`);
    if (!owner || owner.login !== session.login) throw new HttpError(403, 'Payment does not belong to this account');
    if (!['pin', 'otp'].includes(b.type)) throw new HttpError(400, 'Authorization type must be pin or otp');
    let authorization;
    if (b.type === 'otp') {
      const otp = String(b.otp || '').trim();
      if (!/^\d{4,8}$/.test(otp)) throw new HttpError(400, 'OTP must be 4 to 8 digits');
      authorization = { type: 'otp', otp: { code: otp } };
    } else {
      const pin = b.pin || {};
      if (!pin.nonce || String(pin.nonce).length !== 12 || !pin.encrypted_pin) throw new HttpError(400, 'Encrypted PIN data is required');
      authorization = { type: 'pin', pin: { nonce: String(pin.nonce), encrypted_pin: String(pin.encrypted_pin) } };
    }
    const result = await flw4(`/charges/${encodeURIComponent(chargeId)}`, {
      method: 'PUT',
      body: JSON.stringify({ authorization }),
    }, { idempotencyPrefix: `authorize-${chargeId}-${b.type}` });
    const d = result.data;
    if (d?.status === 'succeeded') {
      const pending = await kv.get(`wb:tx:${owner.reference}`);
      if (pending) await activateFromCharge(d, pending, session.login);
    }
    return send(res, 200, {
      chargeId: d?.id || chargeId,
      status: d?.status || 'pending',
      nextAction: d?.next_action || null,
      redirectUrl: d?.next_action?.redirect_url?.url || d?.redirect_url || null,
    });
  }

  if (path === 'billing/status' && m === 'GET') {
    const chargeId = String(query.chargeId || '');
    const owner = await kv.get(`wb:charge:${chargeId}`);
    if (!owner || owner.login !== session.login) throw new HttpError(403, 'Payment does not belong to this account');
    return send(res, 200, await reconcileCharge(chargeId, session.login));
  }

  if (path === 'billing/cancel' && post) {
    const sub = await kv.get(`wb:sub:${session.login}`);
    if (!sub || sub.plan !== 'pro') throw new HttpError(404, 'No active subscription');
    await kv.set(`wb:sub:${session.login}`, { ...sub, autoRenew: false });
    await kv.srem('wb:subscribers', session.login);
    return send(res, 200, { ok: true, activeUntil: sub.nextBillingDate });
  }

  if (path === 'me' && m === 'GET') {
    // Identity comes from the session cookie, so a KV outage/missing KV store
    // must not look like "signed out". Degrade usage/subscription instead.
    let sub = null;
    let usage = null;
    try {
      ({ sub, usage } = await usageFor(session.login));
    } catch (e) {
      console.error('me: usage lookup failed', e);
      const now = new Date();
      usage = { monthlyBuildsUsed: 0, monthlyLimit: PLANS.free.monthlyLimit, concurrentLimit: PLANS.free.concurrentLimit, resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() };
    }
    return send(res, 200, { user: { login: session.login, name: session.name, avatar: session.avatar, email: session.email }, subscription: sub, usage, pricing: PRICING });
  }

  if (path === 'repos' && m === 'GET') {
    const list = await ghJson(session, '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member');
    return send(res, 200, { repos: list.map((r) => ({ fullName: r.full_name, private: r.private, defaultBranch: r.default_branch, canPush: !!r.permissions?.push })) });
  }

  if (path === 'inspect-repo' && m === 'GET') {
    const repo = checkRepo(query.repo);
    const kind = kindOf(query.kind);
    const info = await ghJson(session, `/repos/${repo}`);
    const branch = info.default_branch || 'main';
    const readFile = async (file) => {
      const r = await gh(session, `/repos/${repo}/contents/${file}?ref=${encodeURIComponent(branch)}`);
      if (!r.ok) return '';
      const f = await r.json();
      return Buffer.from(f.content || '', 'base64').toString('utf8');
    };
    const [pubspec, packageJson, gradle, manifest, workflow, latest] = await Promise.all([
      readFile('pubspec.yaml'), readFile('package.json'), readFile('android/app/build.gradle'),
      readFile('android/app/src/main/AndroidManifest.xml'), readFile(WORKFLOW_KINDS[kind].path),
      ghJson(session, `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`).catch(() => []),
    ]);
    let framework = 'unknown';
    let flutterVersion = 'stable';
    if (pubspec && /\bflutter:\s*(?:\r?\n)?/m.test(pubspec)) framework = 'flutter';
    else if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        framework = deps.expo ? 'expo' : deps['react-native'] ? 'react-native' : 'web';
      } catch { framework = 'web'; }
    }
    if (framework === 'flutter') {
      const sdk = /environment:\s*[\s\S]{0,180}?sdk:\s*["']?([^"'\n]+)/m.exec(pubspec)?.[1] || '';
      const exact = /(\d+\.\d+\.\d+)/.exec(sdk)?.[1];
      if (exact) flutterVersion = exact;
    }
    const packageId = /applicationId\s+["']([^"']+)/.exec(gradle)?.[1] || /package="([^"]+)"/.exec(manifest)?.[1] || undefined;
    const marker = kind === 'twa' ? /wybuild-twa-workflow-version:\s*(\d+)/ : /wybuild-workflow-version:\s*(\d+)/;
    const v = Number((marker.exec(workflow) || [])[1] || 0);
    const latestCommitSha = Array.isArray(latest) ? (latest[0]?.sha || '') : '';
    return send(res, 200, { repo, name: info.name, defaultBranch: branch, framework, flutterVersion, packageId, latestCommitSha, workflowInstalled: !!workflow, workflowUpToDate: v >= WORKFLOW_KINDS[kind].version });
  }

  if (path === 'branches' && m === 'GET') {
    const repo = checkRepo(query.repo);
    const list = await ghJson(session, `/repos/${repo}/branches?per_page=100`);
    return send(res, 200, { branches: list.map((b) => b.name) });
  }

  if (path === 'workflow' && m === 'GET') {
    const repo = checkRepo(query.repo);
    const k = WORKFLOW_KINDS[kindOf(query.kind)];
    const ref = query.branch ? `?ref=${encodeURIComponent(query.branch)}` : '';
    const r = await gh(session, `/repos/${repo}/contents/${k.path}${ref}`);
    if (r.status === 404) return send(res, 200, { installed: false, upToDate: false });
    const f = await r.json();
    const text = Buffer.from(f.content || '', 'base64').toString('utf8');
    const v = Number((/wybuild(?:-twa)?-workflow-version:\s*(\d+)/.exec(text) || [])[1] || 0);
    return send(res, 200, { installed: true, upToDate: v >= k.version });
  }

  if (path === 'install-workflow' && post) {
    const { repo, branch, kind } = bodyOf(req);
    checkRepo(repo);
    const k = WORKFLOW_KINDS[kindOf(kind)];
    const target = branch || (await ghJson(session, `/repos/${repo}`)).default_branch;
    // commit the workflow first, helper scripts after it; the contents API needs one request per file
    for (const [repoPath, localPath] of k.files) {
      const content = fs.readFileSync(new URL(`../workflow/${localPath}`, import.meta.url), 'utf8');
      const ex = await gh(session, `/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(target)}`);
      const sha = ex.ok ? (await ex.json()).sha : undefined;
      await ghJson(session, `/repos/${repo}/contents/${repoPath}`, {
        method: 'PUT',
        body: JSON.stringify({ message: `ci: ${sha ? 'update' : 'add'} WyBuild ${kindOf(kind) === 'twa' ? 'TWA ' : ''}workflow (${repoPath.split('/').pop()})`, content: Buffer.from(content).toString('base64'), branch: target, ...(sha ? { sha } : {}) }),
      });
    }
    return send(res, 200, { ok: true, branch: target });
  }

  if (path === 'build' && post) {
    const b = bodyOf(req);
    const repo = checkRepo(b.repo);
    const branch = String(b.branch || '').slice(0, 200);
    const c = b.config || {};
    if (!branch) throw new HttpError(400, 'Branch is required');
    if (!['apk', 'appbundle', 'split-per-abi'].includes(c.target)) throw new HttpError(400, 'Invalid target');
    if (!['debug', 'profile', 'release'].includes(c.mode)) throw new HttpError(400, 'Invalid mode');
    const flutterVersion = String(c.flutterVersion || 'stable');
    if (!/^(stable|beta|\d+\.\d+\.\d+)$/.test(flutterVersion)) throw new HttpError(400, 'Flutter version must be stable, beta, or like 3.29.0');

    const wf = await gh(session, `/repos/${repo}/contents/${WORKFLOW_PATH}?ref=${encodeURIComponent(branch)}`);
    if (wf.status === 404) throw new HttpError(409, 'WyBuild workflow is not installed on this branch', 'NO_WORKFLOW');

    if (c.useKeystore) {
      const sec = await ghJson(session, `/repos/${repo}/actions/secrets?per_page=100`);
      if (!(sec.secrets || []).some((s) => s.name === 'WB_KEYSTORE_BASE64')) throw new HttpError(400, 'No keystore uploaded for this repository', 'NO_KEYSTORE');
    }

    const reservation = await reserveBuildSlot(session, repo);
    const inflightKey = reservation.inflightKey;

    const defines = (Array.isArray(c.dartDefines) ? c.dartDefines : [])
      .filter((d) => d && /^[A-Za-z_][A-Za-z0-9_]*$/.test(d.key || ''))
      .map((d) => `${d.key}=${String(d.value ?? '')}`);
    const r = await gh(session, `/repos/${repo}/actions/workflows/${WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({
        ref: branch,
        inputs: {
          build_target: c.target,
          build_mode: c.mode,
          flutter_version: flutterVersion,
          dart_defines: JSON.stringify(defines),
          obfuscate: String(!!c.obfuscate),
          split_debug_info: String(!!c.splitDebugInfo),
          run_tests: String(!!c.runTests),
          custom_args: String(c.customArgs || '').slice(0, 500),
          use_keystore: String(!!c.useKeystore),
          timeout_minutes: String((await usageFor(session.login)).plan.monthlyLimit >= 9999 ? 60 : 15),
        },
      }),
    });
    if (r.status !== 204) {
      await kv.decr(inflightKey);
      const e = await r.json().catch(() => ({}));
      throw new HttpError(502, e.message || `GitHub refused the dispatch (${r.status})`);
    }
    return send(res, 200, { ok: true });
  }

  if (path === 'twa/inspect' && post) {
    return send(res, 200, await inspectSite(bodyOf(req).url));
  }

  if (path === 'twa/assetlinks' && post) {
    // Does the live site already authorise this package + signing key? (Without it the app shows a browser URL bar.)
    const { url, packageId, fingerprint } = bodyOf(req);
    const site = new URL(cleanHttps(url, 'Web app URL', true));
    if (!PKG_RE.test(String(packageId || ''))) throw new HttpError(400, 'Invalid package id');
    const norm = (f) => String(f || '').replace(/:/g, '').toLowerCase();
    let entries = [];
    try {
      const r = await safeFetch(`${site.origin}/.well-known/assetlinks.json`, { json: true });
      if (r.status === 200) entries = JSON.parse(r.text);
    } catch {
      /* treated as missing */
    }
    const mine = (Array.isArray(entries) ? entries : []).filter((e) => e?.target?.package_name === packageId);
    const fps = mine.flatMap((e) => e.target.sha256_cert_fingerprints || []);
    return send(res, 200, {
      published: mine.length > 0,
      fingerprintMatches: fingerprint ? fps.some((f) => norm(f) === norm(fingerprint)) : null,
      fingerprints: fps,
    });
  }

  if (path === 'twa-build' && post) {
    const b = bodyOf(req);
    const repo = checkRepo(b.repo);
    const branch = String(b.branch || '').slice(0, 200);
    if (!branch) throw new HttpError(400, 'Branch is required');
    const output = ['apk', 'aab', 'both'].includes(b.output) ? b.output : 'both';
    const twa = cleanTwaConfig(b.twa);
    const useKeystore = b.useKeystore !== false;
    const storeReady = b.storeReady !== false;
    if (storeReady && !useKeystore) throw new HttpError(400, 'Store-ready builds must be signed with your own release keystore');

    const wf = await gh(session, `/repos/${repo}/contents/${TWA_WORKFLOW_PATH}?ref=${encodeURIComponent(branch)}`);
    if (wf.status === 404) throw new HttpError(409, 'The WyBuild TWA workflow is not installed on this branch', 'NO_WORKFLOW');
    if (useKeystore) {
      const sec = await ghJson(session, `/repos/${repo}/actions/secrets?per_page=100`);
      if (!(sec.secrets || []).some((s) => s.name === 'WB_KEYSTORE_BASE64')) throw new HttpError(400, 'No keystore uploaded for this repository. Add one under Keystores & Config.', 'NO_KEYSTORE');
    }

    const reservation = await reserveBuildSlot(session, repo);
    const inflightKey = reservation.inflightKey;
    const r = await gh(session, `/repos/${repo}/actions/workflows/${TWA_WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({
        ref: branch,
        inputs: {
          twa_config: JSON.stringify(twa),
          output,
          use_keystore: String(useKeystore),
          store_ready: String(storeReady),
          timeout_minutes: String((await usageFor(session.login)).plan.monthlyLimit >= 9999 ? 60 : 15),
          bubblewrap_version: /^(latest|\d+\.\d+\.\d+)$/.test(String(b.bubblewrapVersion || '')) ? b.bubblewrapVersion : 'latest',
        },
      }),
    });
    if (r.status !== 204) {
      await kv.decr(inflightKey);
      const e = await r.json().catch(() => ({}));
      throw new HttpError(502, e.message || `GitHub refused the dispatch (${r.status})`);
    }
    return send(res, 200, { ok: true });
  }

  if (path === 'runs' && m === 'GET') {
    const repos = String(query.repos || '').split(',').filter(Boolean).slice(0, 10).map(checkRepo);
    const results = await Promise.all(repos.map(async (repo) => {
      try {
        return (await listRuns(session, repo)).map((r) => mapRun(r, repo));
      } catch (e) {
        return e.status === 404 ? [] : Promise.reject(e);
      }
    }));
    const builds = results.flat().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
    return send(res, 200, { builds });
  }

  if (path === 'run' && m === 'GET') {
    const repo = checkRepo(query.repo);
    if (!/^\d+$/.test(query.id || '')) throw new HttpError(400, 'Invalid run id');
    return send(res, 200, { build: await runDetail(session, repo, query.id) });
  }

  if (path === 'cancel' && post) {
    const { repo, runId } = bodyOf(req);
    checkRepo(repo);
    if (!/^\d+$/.test(String(runId))) throw new HttpError(400, 'Invalid run id');
    const r = await gh(session, `/repos/${repo}/actions/runs/${runId}/cancel`, { method: 'POST' });
    if (r.status !== 202) throw new HttpError(502, `Could not cancel (GitHub ${r.status})`);
    return send(res, 200, { ok: true });
  }

  if (path === 'artifact' && m === 'GET') {
    const repo = checkRepo(query.repo);
    if (!/^\d+$/.test(query.id || '')) throw new HttpError(400, 'Invalid artifact id');
    const r = await gh(session, `/repos/${repo}/actions/artifacts/${query.id}/zip`, { redirect: 'manual' });
    const loc = r.headers.get('location');
    if (!loc) throw new HttpError(404, 'Artifact not found or expired');
    return redirect(res, loc);
  }

  if (path === 'keystore' && m === 'GET') {
    const repos = String(query.repos || '').split(',').filter(Boolean).slice(0, 10).map(checkRepo);
    return send(res, 200, { keystores: await keystoresFor(session, repos) });
  }

  if (path === 'keystore' && post) {
    const { repo, name, alias, storePassword, keyPassword, fileBase64 } = bodyOf(req);
    checkRepo(repo);
    const billing = await usageFor(session.login);
    if (!billing.sub) {
      const allRepos = (await kv.smembers(`wb:repos:${session.login}`)).slice(0, 20);
      const allKeys = await keystoresFor(session, allRepos);
      if (allKeys.length >= 1) throw new HttpError(402, 'Free tier includes 1 release keystore. Upgrade to Pro for unlimited signing profiles.', 'PRO_REQUIRED');
    }
    if (!alias || !storePassword || !fileBase64) throw new HttpError(400, 'Keystore file, alias and password are required');
    const bytes = Buffer.from(String(fileBase64), 'base64');
    if (bytes.length < 100 || String(fileBase64).length > 48000) throw new HttpError(400, 'Keystore file is invalid or larger than GitHub\'s 48 KB secret limit');
    const pub = await ghJson(session, `/repos/${repo}/actions/secrets/public-key`);
    await putSecret(session, repo, pub, 'WB_KEYSTORE_BASE64', String(fileBase64));
    await putSecret(session, repo, pub, 'WB_KEYSTORE_PASSWORD', String(storePassword));
    await putSecret(session, repo, pub, 'WB_KEY_ALIAS', String(alias));
    await putSecret(session, repo, pub, 'WB_KEY_PASSWORD', String(keyPassword || storePassword));
    await kv.set(`wb:ks:${session.login}:${repo}`, { name: String(name || '').slice(0, 80), alias: String(alias).slice(0, 80), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), createdAt: new Date().toISOString() });
    return send(res, 200, { ok: true });
  }

  if (path === 'keystore' && m === 'DELETE') {
    const repo = checkRepo(query.repo);
    await Promise.all(SECRET_NAMES.map((n) => gh(session, `/repos/${repo}/actions/secrets/${n}`, { method: 'DELETE' })));
    await kv.del(`wb:ks:${session.login}:${repo}`);
    return send(res, 200, { ok: true });
  }

  throw new HttpError(404, 'Not found');
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
    await route(req, res, path, Object.fromEntries(url.searchParams));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.end();
    send(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Internal error', ...(e.code ? { code: e.code } : {}) });
  }
}
