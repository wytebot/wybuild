import crypto from 'node:crypto';
import fs from 'node:fs';
import { kv } from '../lib/kv.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import nacl from 'tweetnacl';
import blake from 'blakejs';

const TWA_WORKFLOW_FILE = 'wybuild-twa.yml';
const TWA_WORKFLOW_PATH = `.github/workflows/${TWA_WORKFLOW_FILE}`;
const TWA_WORKFLOW_VERSION = 13;
// every file committed to a repo for each workflow kind: [path in repo, path in ./workflow]
const WORKFLOW_KINDS = {
  twa: {
    file: TWA_WORKFLOW_FILE,
    path: TWA_WORKFLOW_PATH,
    version: TWA_WORKFLOW_VERSION,
    files: [
      [TWA_WORKFLOW_PATH, 'wybuild-twa.yml'],
      ['.github/wybuild/twa-prepare.mjs', 'wybuild/twa-prepare.mjs'],
      ['.github/wybuild/twa-generate.mjs', 'wybuild/twa-generate.mjs'],
      ['.github/wybuild/twa-verify.sh', 'wybuild/twa-verify.sh'],
      ['.github/wybuild/twa-native.py', 'wybuild/twa-native.py'],
    ],
  },
};
const kindOf = (v) => 'twa';
const SESSION_COOKIE = 'wb_session';
const STATE_COOKIE = 'wb_state';
const STALE_ACTIVE_MS = 3 * 60 * 60 * 1000;
const LIFETIME_FREE_LOGINS = new Set(['wytebot', 'wytzbot']);
const PLANS = {
  // Free users get 5 SUCCESSFUL builds per calendar month. Failed/cancelled
  // runs never consume this allowance. Projects are not capped.
  free: { monthlyLimit: 5, concurrentLimit: 1 },
  pro: { monthlyLimit: Number.MAX_SAFE_INTEGER, concurrentLimit: 5 },
  lifetimeFree: { monthlyLimit: Number.MAX_SAFE_INTEGER, concurrentLimit: 5 },
};
// USD is the billing currency. NGN values are display equivalents only;
// Flutterwave continues to charge/verify the configured USD amount.
const PRICING = { monthly: 9.99, yearly: 99 };
const PRICING_NGN = { monthly: 15000, yearly: 150000 };
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SECRET_NAMES = ['WB_KEYSTORE_BASE64', 'WB_KEYSTORE_PASSWORD', 'WB_KEY_ALIAS', 'WB_KEY_PASSWORD'];

class HttpError extends Error {
  // extra: { hint?: string, details?: object } shown to the user; never put tokens or secrets in here
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = extra.hint;
    this.details = extra.details;
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
  const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
  try {
    return await fetch(url, {
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
  } catch (e) {
    throw new HttpError(502, `Could not reach GitHub (${e?.cause?.code || e?.message || 'network error'}).`, 'GITHUB_UNREACHABLE', {
      hint: 'GitHub or the network between Vercel and GitHub is unavailable. Retry in a minute; check githubstatus.com if it keeps happening.',
      details: { request: `${init.method || 'GET'} ${new URL(url).pathname}` },
    });
  }
}

// Turns a failed GitHub response into a specific message, a fix hint and a stable error code.
function describeGithubFailure(r, data, ctx, request) {
  const status = r.status;
  const gm = String(data?.message || '').trim();
  const scopes = r.headers.get('x-oauth-scopes');
  const granted = scopes === null ? 'unknown' : scopes || 'none';
  const remaining = r.headers.get('x-ratelimit-remaining');
  const reset = r.headers.get('x-ratelimit-reset');
  const where = ctx ? ` while ${ctx}` : '';
  const writesWorkflow = /\/contents\/\.github\/workflows\//.test(request) && /^(PUT|DELETE)/.test(request);
  const lacksWorkflowScope = scopes !== null && !scopes.split(/,\s*/).includes('workflow');
  const details = { request, githubStatus: status, githubMessage: gm || undefined, oauthScopes: granted };
  if (status === 401) return { code: 'GITHUB_AUTH', message: `GitHub rejected your login${where} (401 ${gm || 'Bad credentials'}).`, hint: 'Sign out of WyBuild and sign in with GitHub again.', details, http: 401 };
  if (status === 403 && remaining === '0') {
    const when = reset ? new Date(Number(reset) * 1000).toISOString().slice(11, 16) + ' UTC' : 'shortly';
    return { code: 'GITHUB_RATE_LIMIT', message: `GitHub API rate limit reached${where}.`, hint: `Wait until about ${when} and retry.`, details, http: 429 };
  }
  if ((status === 403 || status === 404) && writesWorkflow && lacksWorkflowScope) {
    return { code: 'MISSING_WORKFLOW_SCOPE', message: `GitHub refused to write ${request.split('/contents/')[1].split('?')[0]} because your login does not have the "workflow" permission (granted: ${granted}). GitHub reports this as "${status} ${gm || 'Not Found'}".`, hint: 'Sign out of WyBuild and sign in again, approving the "repo" and "workflow" permissions. If you signed in before, also remove WyBuild at github.com/settings/applications and re-authorize.', details, http: 403 };
  }
  if (status === 403) return { code: 'GITHUB_FORBIDDEN', message: `GitHub denied access${where}: ${gm || 'forbidden'}.`, hint: /not accessible by integration|resource not accessible/i.test(gm) ? 'The token lacks permission for this action. Re-authorize WyBuild with the repo and workflow scopes.' : 'You need push/admin access to this repository (and its organization may restrict OAuth apps: github.com/settings/connections/applications).', details, http: 403 };
  if (status === 404) {
    const repoPart = (/^\w+ \/repos\/([^/]+\/[^/]+)/.exec(request) || [])[1];
    const what = /\/contents\//.test(request) ? `the file ${request.split('/contents/')[1].split('?')[0]}` : /\/actions\/workflows\//.test(request) ? 'that workflow' : /\/actions\/runs\//.test(request) ? 'that run' : /\/actions\/secrets/.test(request) ? 'the Actions secrets API' : repoPart ? `repository ${repoPart}` : 'the requested resource';
    return { code: 'GITHUB_NOT_FOUND', message: `GitHub returned 404 for ${what}${where}.`, hint: /\/actions\/secrets/.test(request) ? 'Writing secrets needs admin access to the repository, and the repository must exist under the account you signed in with.' : /\/actions\/workflows\//.test(request) ? 'The workflow file is not committed on that branch yet, or GitHub has not indexed it. Reinstall the workflow, wait a few seconds, and retry. Also check that Actions is enabled for the repository.' : repoPart ? `Either ${repoPart} does not exist, the branch/path is wrong, or your GitHub login cannot see it (private repositories and unauthorized organizations also return 404). Check the spelling and that you signed in as an account with access.` : 'Check the repository, branch and file names.', details, http: 404 };
  }
  if (status === 409) return { code: 'GITHUB_CONFLICT', message: `GitHub reported a conflict${where}: ${gm}.`, hint: 'The file or branch changed while WyBuild was writing. Retry; if it persists, the branch may be protected.', details, http: 409 };
  if (status === 422) {
    const errs = Array.isArray(data?.errors) ? data.errors.map((e) => (typeof e === 'string' ? e : e.message || e.code)).filter(Boolean).join('; ') : '';
    return { code: 'GITHUB_VALIDATION', message: `GitHub rejected the request${where}: ${gm}${errs ? ` (${errs})` : ''}.`, hint: /workflow_dispatch|inputs?/i.test(gm + errs) ? 'The workflow in the repo does not match this WyBuild version (missing/renamed inputs). Reinstall the workflow and retry.' : /protected|rule/i.test(gm) ? 'The branch is protected; install the workflow on an unprotected branch or allow the push.' : undefined, details, http: 422 };
  }
  return { code: 'GITHUB_ERROR', message: `GitHub error ${status}${where}: ${gm || 'no message'}.`, hint: status >= 500 ? 'GitHub is having trouble. Retry shortly.' : undefined, details, http: 502 };
}


// A bare 404/403 on a write tells you nothing. Probe the repo, the branch and the token to name the real cause.
async function diagnoseWriteFailure(session, repo, branch, original) {
  const tok = String(session.token || '');
  const kind = tok.startsWith('ghu_') ? 'github-app' : tok.startsWith('github_pat_') ? 'fine-grained' : 'oauth';
  const kindLabel = { 'github-app': 'GitHub App user token', 'fine-grained': 'fine-grained token', oauth: 'OAuth app token' }[kind];
  const facts = { repo, branch, tokenType: kindLabel, ...(original?.details || {}) };
  const fail = (code, message, hint) => new HttpError(original?.status === 403 ? 403 : 409, message, code, { hint, details: facts });

  const ri = await gh(session, `/repos/${repo}`);
  facts.repoVisible = ri.ok;
  if (ri.status === 404) {
    const hint = kind === 'github-app'
      ? `WyBuild's GitHub App is not installed on ${repo}. Open github.com/settings/installations, configure the app and add ${repo} (grant Contents and Workflows read & write), then retry.`
      : `Your login cannot see ${repo}. If it belongs to an organization, approve WyBuild at github.com/settings/connections/applications (Organization access → Grant), or confirm the owner/name spelling.`;
    return fail('REPO_NOT_VISIBLE', `GitHub says ${repo} does not exist for this login (404), so WyBuild cannot write to it.`, hint);
  }
  if (ri.ok) {
    const info = await ri.json();
    facts.private = !!info.private; facts.archived = !!info.archived; facts.canPush = info.permissions ? !!info.permissions.push : 'unknown'; facts.defaultBranch = info.default_branch; facts.empty = info.size === 0;
    if (info.archived) return fail('REPO_ARCHIVED', `${repo} is archived, so it is read-only.`, 'Unarchive it in the repository settings, then retry.');
    if (info.permissions && !info.permissions.push) return fail('NO_PUSH_ACCESS', `You are signed in to WyBuild as "${session.login}", and GitHub says that account only has read access to ${repo} (no push permission), so the workflow cannot be committed there.`, `A personal access token will not help unless it is created by an account that has write access. Use the menu → Sign out, then sign in with the GitHub account that owns ${repo} (it is under "${repo.split('/')[0]}"). Or ask that owner to add "${session.login}" as a collaborator with Write access, or fork the repo and connect your fork.`);
    const br = await gh(session, `/repos/${repo}/branches/${encodeURIComponent(branch)}`);
    facts.branchExists = br.ok;
    if (br.status === 404 && !facts.empty) return fail('BRANCH_NOT_FOUND', `Branch "${branch}" does not exist in ${repo} (default branch is "${info.default_branch}").`, `Create the branch first or reconnect the project on "${info.default_branch}".`);
    if (br.ok) { const b = await br.json(); facts.branchProtected = !!b.protected; }
  }
  const scopes = facts.oauthScopes;
  if (kind === 'oauth' && scopes && scopes !== 'unknown' && !scopes.split(/,\s*/).includes('workflow')) {
    return fail('MISSING_WORKFLOW_SCOPE', `Your sign-in is missing the "workflow" permission (granted: ${scopes}).`, 'Sign out, sign in again and approve "workflow", or remove WyBuild at github.com/settings/applications first.');
  }
  if (kind === 'github-app' || scopes === 'unknown') {
    return fail('APP_PERMISSION_MISSING', `Your token has no OAuth scopes (${kindLabel}), so GitHub is using the app's own permissions, and they do not include writing .github/workflows on ${repo}.`, 'In the GitHub App settings set Repository permissions → Contents: Read & write and Workflows: Read & write, then accept the update at github.com/settings/installations. Or switch WyBuild to an OAuth App (GITHUB_CLIENT_ID/SECRET) that requests the "repo workflow" scopes.');
  }
  return fail('WRITE_BLOCKED', `GitHub refused the commit to ${repo}@${branch} (${original?.status || 404}) although the repo, branch and "workflow" scope look fine${facts.branchProtected ? '; the branch is protected' : ''}.`, facts.branchProtected ? 'Branch protection or a ruleset blocks direct pushes. Install on an unprotected branch or allow WyBuild to bypass the rule.' : `The owning organization may restrict third-party OAuth apps: open github.com/settings/connections/applications and grant WyBuild access to the organization that owns ${repo}.`);
}

async function ghJson(session, path, init, ctx = '') {
  const r = await gh(session, path, init);
  const text = await r.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 300) };
  }
  if (!r.ok) {
    const request = `${(init && init.method) || 'GET'} ${path.replace(/^https:\/\/api\.github\.com/, '').split('?')[0]}`;
    const d = describeGithubFailure(r, data, ctx, request);
    throw new HttpError(d.http, d.message, d.code, { hint: d.hint, details: d.details });
  }
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
  return { encryptionKey: key, currency: 'USD', pricing: PRICING, pricingNgn: PRICING_NGN };
}

function isLifetimeFree(login) {
  return LIFETIME_FREE_LOGINS.has(String(login || '').trim().toLowerCase());
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
  const lifetimeFree = isLifetimeFree(login);
  const plan = lifetimeFree ? PLANS.lifetimeFree : sub ? PLANS.pro : PLANS.free;
  const used = Number((await kv.get(`wb:month:${login}:${utcMonth()}`)) || 0);
  const pending = Number((await kv.get(`wb:pending:${login}:${utcMonth()}`)) || 0);
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { sub, plan, lifetimeFree, usage: { monthlyBuildsUsed: used, pendingBuilds: pending, monthlyLimit: plan.monthlyLimit, concurrentLimit: plan.concurrentLimit, resetsAt: next.toISOString() } };
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
  const ik = `wb:inflight:${session.login}`;
  const released = await kv.set(`wb:release-inflight:${repo}:${run.id}`, 1, { nx: true, ex: 60 * 60 * 24 * 3 });
  if (released) {
    const inFlight = await kv.decr(ik);
    if (inFlight < 0) await kv.set(ik, 0);
  }
  const month = utcMonth(new Date(run.updated_at || run.created_at));
  const pendingKey = `wb:pending:${session.login}:${month}`;
  const first = await kv.set(`wb:finalized:${repo}:${run.id}`, 1, { nx: true, ex: 60 * 60 * 24 * 120 });
  if (!first) return;
  const pending = await kv.decr(pendingKey);
  if (pending < 0) await kv.set(pendingKey, 0);
  if (run.conclusion !== 'success') return;
  const monthKey = `wb:month:${session.login}:${month}`;
  await kv.incr(monthKey);
  await kv.expire(monthKey, 60 * 60 * 24 * 370);
  await kv.expire(pendingKey, 60 * 60 * 24 * 370);
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
  const runs = await workflowRuns(session, repo, TWA_WORKFLOW_FILE, 15);
  await Promise.all(runs.map((r) => refundIfNeeded(session, repo, r).catch(() => {})));
  return runs;
}

const STEP_STATUS = (s) => {
  if (s.status === 'completed') return s.conclusion === 'success' ? 'success' : s.conclusion === 'skipped' ? 'skipped' : 'failed';
  return s.status === 'in_progress' ? 'running' : 'pending';
};

const DIAGNOSES = [
  { re: /provided androidSdk isn'?t correct|given androidSdk isn'?t correct/i, category: 'twa_config', title: 'Bubblewrap rejected the Android SDK folder', fix: 'Bubblewrap needs an Android SDK folder with a top-level bin/ or tools/ directory, which the GitHub runner does not have. Reinstall the TWA workflow (v9 builds a compatible SDK folder automatically) and rebuild.' },
  { re: /Unexpected EOF|stdin|EOF.*prompt|Is a terminal|inquirer|Cannot read.*(?:password|input)/i, category: 'twa_config', title: 'Bubblewrap asked a question and nobody could answer', fix: 'Bubblewrap needed input (usually the keystore password or "update project?"). Check WB_KEYSTORE_PASSWORD and WB_KEY_PASSWORD and re-run the updated TWA workflow.' },
  { re: /exceeded the maximum execution time|timed out|The operation was canceled|timeout.*bubblewrap|Terminated/i, category: 'twa_config', title: 'Build hung and was stopped (timeout)', fix: 'The failed step ran out of time, most often while signing. Reinstall the TWA workflow (v5 closes stdin and times out with a clear error) and verify the keystore alias/passwords.' },
  { re: /Cannot open the keystore|java\.io\.EOFException|keystore was tampered|Keystore was tampered|password was incorrect|Cannot recover key|UnrecoverableKeyException|Invalid keystore format/i, category: 'keystore', title: 'Release keystore is invalid, truncated, or credentials are wrong', fix: 'WyBuild decoded the secret but Java could not read it. Replace WB_KEYSTORE_BASE64 with the complete raw .jks/.p12 Base64, then verify the exact case-sensitive alias and store password. WyBuild now checks the decoded file before Bubblewrap.' },
  { re: /alias.*does not exist|Alias <.*> does not exist/i, category: 'keystore', title: 'Key alias not found in keystore', fix: 'The alias saved in WB_KEY_ALIAS is not in your keystore. Run keytool -list -keystore <file> locally and re-upload with the exact alias.' },
  { re: /\.github\/wybuild\/[\w.-]+ is missing|cp: cannot stat '?[^\n]*\.github\/wybuild|Cannot find module[^\n]*\.github\/wybuild/i, category: 'twa_config', title: 'Workflow helper files are missing in the repo', fix: 'Use Update workflow so .github/wybuild/twa-prepare.mjs, twa-generate.mjs, twa-verify.sh and twa-native.py are committed alongside the workflow.' },
  { re: /unbound variable/i, category: 'twa_config', title: 'Workflow script used an undefined variable', fix: 'Your repo has an outdated WyBuild workflow. Use Update workflow and re-run.' },
  { re: /unknown option|too many arguments|error: missing required/i, category: 'twa_config', title: 'Bubblewrap command-line option rejected', fix: 'Your repo has an outdated WyBuild TWA workflow that passes options Bubblewrap does not accept. Use Update workflow.' },
  { re: /No such file or directory|ENOENT[^\n]*/i, category: 'twa_config', title: 'A required file was not found', fix: 'The error line names the missing path. If it is under .github/wybuild or twa-manifest.json, update the workflow; if it is under android/ or pubspec.yaml, check the branch contents.' },
  { re: /Store-ready mode|store-readiness|WB_KEYSTORE_BASE64 secret is missing|Signed with the Android debug|key-continuity/i, category: 'keystore', title: 'Not ready for APKMirror / Uptodown', fix: 'Open the store-readiness report in the artifact or job summary. Typical fixes: upload your own release keystore, keep the same key as earlier releases, and avoid com.example-style package ids.' },
  { re: /No app icon|app icon|Invalid TWA manifest|Invalid Android package id|No Web App Manifest|Web App Manifest returned HTTP|Web app returned HTTP|must use HTTPS/i, category: 'twa_config', title: 'The website or its manifest is not usable', fix: 'The site must be reachable over HTTPS, publish a Web App Manifest, and include a PNG icon of at least 192px (512px recommended).' },
  { re: /key\.properties|WB_KEYSTORE/i, category: 'keystore', title: 'Release signing problem', fix: 'Use the same release keystore as the previous APK and confirm the four WB_KEYSTORE_* GitHub Actions secrets are present.' },
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
      const failedStep = build.steps.find((s) => s.status === 'failed');
      // match against the failed step first so unrelated log lines from earlier steps cannot cause a wrong diagnosis
      const failedText = failedStep ? failedStep.logs.join('\n') : '';
      const all = build.steps.flatMap((s) => s.logs).join('\n');
      const hit = DIAGNOSES.find((d) => d.re.test(failedText)) || (failedStep ? undefined : DIAGNOSES.find((d) => d.re.test(all)));
      if (hit || failedStep) {
        build.errorDiagnosis = {
          id: `diag-${id}`,
          title: hit ? hit.title : `Step failed: ${failedStep.name}`,
          category: hit ? hit.category : 'gradle',
          severity: 'critical',
          matchedPattern: failedStep?.error || failedStep?.name || '',
          description: `${failedStep ? `Failed at step "${failedStep.name}". ` : ''}${failedStep?.error || [...(failedStep?.logs || [])].reverse().find((l) => /error|fail|denied|not found|no such|timed? ?out/i.test(l)) || 'Open the step logs for details.'}`.slice(0, 600),
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


/* ------------------------- keystore file validation ------------------------- */
// Reads a keystore the way Java would, WITHOUT needing Java: tells apart a complete keystore, a truncated one,
// a Base64-text file that was Base64-encoded a second time, and a wrong store password. Returns the canonical
// Base64 of the real keystore bytes so every copy WyBuild installs is clean.
const B64_TEXT = /^[A-Za-z0-9+/]+={0,2}$/;
function derTotalLength(b) {
  if (b.length < 4 || b[0] !== 0x30) return -1;
  let l = b[1];
  if (l & 0x80) {
    const n = l & 0x7f;
    if (n < 1 || n > 4 || b.length < 2 + n) return -1;
    l = 0;
    for (let i = 0; i < n; i++) l = l * 256 + b[2 + i];
    return 2 + n + l;
  }
  return 2 + l;
}
const hex4 = (b) => b.subarray(0, 4).toString('hex');
function jksDigestOk(bytes, password) {
  const pw = Buffer.alloc(password.length * 2);
  for (let i = 0; i < password.length; i++) pw.writeUInt16BE(password.charCodeAt(i), i * 2);
  const h = crypto.createHash('sha1').update(pw).update('Mighty Aphrodite', 'utf8').update(bytes.subarray(0, bytes.length - 20)).digest();
  return h.equals(bytes.subarray(bytes.length - 20));
}
function parseKeystore(input, storePassword) {
  const bad = (problem, code = 'KEYSTORE_INVALID') => ({ ok: false, problem, code });
  const text = String(input || '').trim().replace(/^["']|["']$/g, '').replace(/\s+/g, '');
  if (!text) return bad('is empty.');
  if (!B64_TEXT.test(text)) return bad('is not valid Base64 (it has characters Base64 never uses, such as quotes, a "data:" prefix or a copy-paste artefact). Re-create it with: base64 -w0 your.jks');
  let bytes = Buffer.from(text, 'base64');
  let wraps = 0;
  const kind = (b) => {
    if (b.length >= 24 && b.readUInt32BE(0) === 0xfeedfeed) return 'jks';
    if (b.length >= 24 && b.readUInt32BE(0) === 0xcececece) return 'jceks';
    if (b.length >= 100 && derTotalLength(b) === b.length) return 'pkcs12';
    return '';
  };
  // a Base64 TEXT file that got Base64-encoded again (e.g. ks.b64 uploaded as if it were the .jks)
  while (wraps < 2 && !kind(bytes) && bytes.length >= 100 && B64_TEXT.test(bytes.toString('latin1').replace(/\s+/g, ''))) {
    bytes = Buffer.from(bytes.toString('latin1').replace(/\s+/g, ''), 'base64');
    wraps++;
  }
  const type = kind(bytes);
  if (!type) {
    if (bytes[0] === 0x30) {
      const want = derTotalLength(bytes);
      if (want > bytes.length) return bad(`is incomplete: the keystore file should be ${want} bytes but only ${bytes.length} arrived (${want - bytes.length} bytes cut off the end). It was truncated while copying; re-create the Base64 and copy it again.`, 'KEYSTORE_TRUNCATED');
      if (want > 0 && want < bytes.length) return bad(`has ${bytes.length - want} unexpected extra bytes after the end of the keystore. Re-create the Base64 from the original .jks/.p12 file.`);
    }
    return bad(`does not contain a keystore (the decoded file starts with ${hex4(bytes) || 'nothing'}; a .jks starts with feedfeed and a .p12 with 30 82). Make sure you encoded the .jks/.p12 file itself.`);
  }
  if (storePassword) {
    if (type === 'jks' && !jksDigestOk(bytes, storePassword)) {
      return bad('failed its integrity check: either the store password is wrong or the file is damaged/incomplete.', 'KEYSTORE_BAD_PASSWORD');
    }
    if (type === 'pkcs12') {
      try {
        tls.createSecureContext({ pfx: bytes, passphrase: storePassword });
      } catch (e) {
        // only a definite MAC/password failure is reported; exotic-but-valid files (legacy ciphers) are left to Java
        if (/mac verify|invalid password|bad decrypt|wrong password/i.test(String(e?.message || ''))) {
          return bad('could not be opened with the store password: the password is wrong, or the file is damaged.', 'KEYSTORE_BAD_PASSWORD');
        }
      }
    }
  }
  return { ok: true, type, bytes, b64: bytes.toString('base64'), wraps };
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
  if (!r.ok) {
    throw new HttpError(502, `Could not store secret ${name} in ${repo} (GitHub ${r.status})`, 'SECRET_WRITE_FAILED', {
      hint: r.status === 403 || r.status === 404
        ? `Your GitHub account needs admin access to ${repo} (and the "repo" permission) so WyBuild can add its signing secrets. Ask the owner for admin access, or sign out and back in to WyBuild.`
        : 'GitHub refused the secret. Retry in a minute.',
    });
  }
}

/* A server-wide default keystore (Vercel env: same names as the repo secrets).
   GitHub secrets are write-only and are scoped to ONE repository, so a build running in
   another repo can never read secrets stored in the WyBuild repo. WyBuild therefore reads the
   default key from its own environment and copies it into a repo's Actions secrets
   automatically before every build (and when a workflow is installed), so nobody has to add
   keystore variables to a repo by hand. */
const stripEol = (v) => String(v || '').replace(/^\uFEFF/, '').replace(/[\r\n]+$/, '');

// Validates the Vercel env once and says exactly what is wrong, instead of letting GitHub fail later.
function defaultKeystoreState() {
  if (!SECRET_NAMES.some((n) => env(n))) return { state: 'absent' };
  const rawB64 = env('WB_KEYSTORE_BASE64');
  const storePassword = stripEol(env('WB_KEYSTORE_PASSWORD'));
  const alias = stripEol(env('WB_KEY_ALIAS'));
  const keyPassword = stripEol(env('WB_KEY_PASSWORD')) || storePassword;
  const missing = [['WB_KEYSTORE_BASE64', rawB64.trim()], ['WB_KEYSTORE_PASSWORD', storePassword], ['WB_KEY_ALIAS', alias]].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) return { state: 'incomplete', problem: `The WyBuild Vercel environment is missing ${missing.join(', ')}.` };
  const parsed = parseKeystore(rawB64, storePassword);
  if (!parsed.ok) return { state: 'invalid', problem: `WB_KEYSTORE_BASE64 in the Vercel environment ${parsed.problem}` };
  const b64 = parsed.b64;
  if (b64.length > 48000) return { state: 'invalid', problem: "WB_KEYSTORE_BASE64 in the Vercel environment is larger than GitHub's 48 KB secret limit." };
  // HMAC so the stored marker reveals nothing about the key or passwords
  const fingerprint = crypto.createHmac('sha256', env('SESSION_SECRET') || 'wybuild').update([b64, storePassword, alias, keyPassword].join('\0')).digest('hex').slice(0, 32);
  return { state: 'ok', ks: { b64, storePassword, alias, keyPassword }, fingerprint };
}

function defaultKeystore() {
  const s = defaultKeystoreState();
  return s.state === 'ok' ? s.ks : null;
}

// Set of secret names in the repo, or null when the list cannot be read (no admin access, etc.)
async function repoSecretNames(session, repo) {
  try {
    const names = new Set();
    for (let page = 1; page <= 5; page++) {
      const data = await ghJson(session, `/repos/${repo}/actions/secrets?per_page=100&page=${page}`);
      const list = data.secrets || [];
      list.forEach((s) => names.add(s.name));
      if (list.length < 100) break;
    }
    return names;
  } catch {
    return null;
  }
}

const CORE_SECRETS = ['WB_KEYSTORE_BASE64', 'WB_KEYSTORE_PASSWORD', 'WB_KEY_ALIAS'];
const hasCoreSecrets = (names) => !!names && CORE_SECRETS.every((n) => names.has(n));
const defaultMarkerKey = (repo) => `wb:dks:${String(repo).toLowerCase()}`;
// fingerprint of the default key WyBuild last copied into this repo (absent => the repo's key is the owner's own)
async function defaultMarker(repo) {
  try { return (await kv.get(defaultMarkerKey(repo))) || null; } catch { return null; }
}

async function repoHasKeystore(session, repo) {
  const names = await repoSecretNames(session, repo);
  return names ? hasCoreSecrets(names) : null;
}

async function signingStatus(session, repo) {
  const names = await repoSecretNames(session, repo);
  if (hasCoreSecrets(names)) return (await defaultMarker(repo)) ? 'default' : 'repo';
  if (names && names.has('WB_KEYSTORE_BASE64')) return 'none'; // someone's half-finished key: ask for a complete one
  return defaultKeystoreState().state === 'ok' ? 'default' : 'none';
}

async function installDefaultKeystore(session, repo, st) {
  const { ks, fingerprint } = st;
  const pub = await ghJson(session, `/repos/${repo}/actions/secrets/public-key`, undefined, `reading the Actions secret key of ${repo}`);
  // the keystore goes LAST: if anything fails midway, the repo still looks "not installed" and the next build retries cleanly
  await putSecret(session, repo, pub, 'WB_KEYSTORE_PASSWORD', ks.storePassword);
  await putSecret(session, repo, pub, 'WB_KEY_ALIAS', ks.alias);
  await putSecret(session, repo, pub, 'WB_KEY_PASSWORD', ks.keyPassword);
  await putSecret(session, repo, pub, 'WB_KEYSTORE_BASE64', ks.b64);
  try { await kv.set(defaultMarkerKey(repo), fingerprint); } catch { /* marker only enables rotation; the secrets are already in place */ }
}

// Guarantees the repo has signing secrets: its own, or a copy of the Vercel default
// (re-copied when the Vercel key is rotated, but only for repos where WyBuild installed the default).
async function ensureSigning(session, repo) {
  const st = defaultKeystoreState();
  const names = await repoSecretNames(session, repo);
  const marker = await defaultMarker(repo);

  if (hasCoreSecrets(names)) {
    if (marker && st.state === 'ok' && marker !== st.fingerprint) {
      await installDefaultKeystore(session, repo, st);
      return 'default';
    }
    return marker ? 'default' : 'repo';
  }
  if (names && names.has('WB_KEYSTORE_BASE64') && !marker) {
    throw new HttpError(409, `${repo} has a WB_KEYSTORE_BASE64 secret but is missing its password or alias secret.`, 'KEYSTORE_INCOMPLETE', {
      hint: 'WyBuild will not overwrite a key it did not install. Upload the complete keystore in WyBuild, or add WB_KEYSTORE_PASSWORD and WB_KEY_ALIAS to the repo secrets.',
    });
  }
  if (st.state === 'ok') {
    await installDefaultKeystore(session, repo, st);
    return 'default';
  }
  throw new HttpError(400, st.problem || `No release keystore is available for ${repo}.`, 'NO_KEYSTORE', {
    hint: st.problem
      ? 'Fix the WB_KEYSTORE_* variables in the WyBuild Vercel project settings and redeploy; every repo is then signed automatically.'
      : 'Upload a keystore for this repo, or set WB_KEYSTORE_BASE64, WB_KEYSTORE_PASSWORD, WB_KEY_ALIAS and WB_KEY_PASSWORD in the WyBuild Vercel environment so every repo is signed automatically.',
  });
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
  const month = utcMonth();
  const pendingKey = `wb:pending:${session.login}:${month}`;
  if (usage.monthlyBuildsUsed + usage.pendingBuilds >= plan.monthlyLimit) {
    throw new HttpError(402, `Free build allowance reached (${plan.monthlyLimit} builds reserved or completed this month). Upgrade to Pro for unlimited builds.`, 'LIMIT');
  }
  const reserved = await kv.incr(pendingKey);
  await kv.expire(pendingKey, 60 * 60 * 24 * 370);
  if (usage.monthlyBuildsUsed + reserved > plan.monthlyLimit) {
    await kv.decr(pendingKey);
    throw new HttpError(402, `Free build allowance reached (${plan.monthlyLimit} builds reserved or completed this month). Upgrade to Pro for unlimited builds.`, 'LIMIT');
  }
  const inflightKey = `wb:inflight:${session.login}`;
  const inflight = await kv.incr(inflightKey);
  await kv.expire(inflightKey, 60 * 60 * 24 * 3);
  if (inflight > plan.concurrentLimit) {
    await kv.decr(inflightKey);
    await kv.decr(pendingKey);
    throw new HttpError(429, `Concurrent build limit reached (${plan.concurrentLimit}). Wait for a running build or upgrade to Pro.`, 'CONCURRENCY');
  }
  await kv.del(`wb:repos:${session.login}`).catch(() => {});
  return { inflightKey, pendingKey };
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

// Link handling rules: internal (stay in the app), external (system browser), other (handed to Android).
// Mirrors src/services/links.ts. Returns [{ pattern, mode }] with patterns normalised.
const LINK_BLOCKED_SCHEMES = new Set(['http', 'https', 'javascript', 'data', 'file', 'blob', 'about', 'vbscript', 'content', 'intent']);
const LINK_HOST_RE = /^(\*\.)?([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const LINK_PATH_RE = /^\/[A-Za-z0-9\-._~%/]*$/;
function cleanLinkRules(list) {
  const rules = Array.isArray(list) ? list.slice(0, 30) : [];
  const out = [];
  const seen = new Set();
  for (const r of rules) {
    const mode = str(r?.mode, 20);
    if (!['internal', 'external', 'other'].includes(mode)) throw new HttpError(400, 'Link rule type must be internal, external or other');
    const orig = str(r?.pattern, 200);
    const t = orig.toLowerCase();
    if (!t) continue;
    const bare = t.replace(/:\/\/$/, ':').replace(/:$/, '');
    let pattern;
    if (!/[/.]/.test(bare) && /^[a-z][a-z0-9+.-]*$/.test(bare)) {
      if (LINK_BLOCKED_SCHEMES.has(bare)) throw new HttpError(400, `Link rule "${bare}:" is not allowed; enter a domain instead`);
      if (mode !== 'other') throw new HttpError(400, `"${bare}:" can only be set to "other" (hand to Android)`);
      pattern = `${bare}:`;
    } else {
      const rest = orig.replace(/^https?:\/\//i, '');
      const slash = rest.indexOf('/');
      const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
      let path = slash === -1 ? '' : rest.slice(slash).replace(/[?#].*$/, '').replace(/\*+$/, ''); // paths are case-sensitive
      if (path === '/') path = '';
      if (!LINK_HOST_RE.test(host)) throw new HttpError(400, `Link rule "${str(r?.pattern, 60)}" is not a valid domain (use shop.example.com or *.example.com)`);
      if (path && !LINK_PATH_RE.test(path)) throw new HttpError(400, `Link rule "${str(r?.pattern, 60)}" has an invalid path`);
      pattern = host + path;
    }
    if (seen.has(pattern)) continue;
    seen.add(pattern);
    out.push({ pattern, mode });
  }
  return out;
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
    if (!['standalone', 'fullscreen', 'fullscreen-sticky', 'minimal-ui'].includes(c.display)) throw new HttpError(400, 'Invalid display mode');
    out.display = c.display;
  }
  if (c.orientation) {
    if (!['default', 'portrait', 'landscape'].includes(c.orientation)) throw new HttpError(400, 'Invalid orientation');
    out.orientation = c.orientation;
  }
  // WyBuild web-to-Android is always a Trusted Web Activity. A WebView fallback is
  // deliberately not exposed because it changes the product into a WebView wrapper.
  out.fallbackType = 'customtabs';
  for (const k of ['enableNotifications', 'enableSiteSettingsShortcut', 'locationDelegation', 'playBilling', 'isChromeOSOnly', 'predictiveBack']) if (k in c) out[k] = !!c[k];
  if (c.minSdkVersion) {
    out.minSdkVersion = Number(c.minSdkVersion);
    if (!Number.isInteger(out.minSdkVersion) || out.minSdkVersion < 21 || out.minSdkVersion > 35) throw new HttpError(400, 'minSdkVersion must be between 21 and 35');
  }
  out.additionalTrustedOrigins = (Array.isArray(c.additionalTrustedOrigins) ? c.additionalTrustedOrigins : []).slice(0, 20).map((o) => str(o, 200)).filter(Boolean);
  out.linkRules = cleanLinkRules(c.linkRules);
  out.androidPermissions = (Array.isArray(c.androidPermissions) ? c.androidPermissions : []).slice(0, 30).map((p) => str(p, 120)).filter(Boolean);
  if (out.androidPermissions.some((p) => !PERM_RE.test(p))) throw new HttpError(400, 'Invalid Android permission name');
  out.shortcuts = (Array.isArray(c.shortcuts) ? c.shortcuts : []).slice(0, 4).map((s) => ({ name: str(s?.name, 40), shortName: str(s?.shortName || s?.name, 12), url: str(s?.url, 300) })).filter((s) => s.name && s.url.startsWith('/'));
  if (c.expectedFingerprint) {
    out.expectedFingerprint = str(c.expectedFingerprint, 120);
    if (!/^([0-9A-Fa-f]{2}:?){32}$/.test(out.expectedFingerprint)) throw new HttpError(400, 'Fingerprint must be a SHA-256 value (64 hex characters)');
  }
  if (c.playSigningFingerprint) {
    out.playSigningFingerprint = str(c.playSigningFingerprint, 120);
    if (!/^([0-9A-Fa-f]{2}:?){32}$/.test(out.playSigningFingerprint)) throw new HttpError(400, 'Play signing fingerprint must be a SHA-256 value (64 hex characters)');
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

/* ---- HTML helpers for the site inspector (no dependencies) ---- */
function htmlAttrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').replace(/&amp;/g, '&').trim();
  return out;
}
const htmlTags = (html, name) => (html.match(new RegExp(`<${name}\\b[^>]*>`, 'gi')) || []).map(htmlAttrs);
function normHex(v) {
  const s = String(v || '').trim();
  if (HEX.test(s)) return s.toLowerCase();
  const m = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(s);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}`.toLowerCase() : '';
}
const iconSize = (i) => Math.max(0, ...String(i?.sizes || '').split(/\s+/).map((x) => parseInt(x, 10) || 0));

async function fetchOk(url, opts) {
  try { return await safeFetch(url, opts); } catch { return null; }
}
async function isImage(url) {
  const r = await fetchOk(url, { maxBytes: 4_000_000 });
  return !!r && r.status >= 200 && r.status < 300 && /^image\//i.test(r.contentType);
}

async function inspectSite(rawUrl) {
  const url = cleanHttps(rawUrl, 'Web app URL', true);
  const checks = [];
  const add = (id, ok, msg, level = 'warn') => checks.push({ id, ok, level: ok ? 'ok' : level, msg });
  const page = await safeFetch(url);
  add('reachable', page.status >= 200 && page.status < 300, `Start page responded with HTTP ${page.status}`, 'error');
  const finalUrl = new URL(page.finalUrl);
  const html = page.text;
  const links = htmlTags(html, 'link');
  const metas = htmlTags(html, 'meta');
  const meta = (key) => metas.find((m) => (m.name || m.property || '').toLowerCase() === key)?.content || '';

  // 1) manifest: every <link rel=manifest>, then the usual file names
  const candidates = [
    ...links.filter((l) => /(^|\s)manifest(\s|$)/i.test(l.rel || '') && l.href).map((l) => new URL(l.href, finalUrl).href),
    ...['/manifest.webmanifest', '/manifest.json', '/site.webmanifest'].map((p) => finalUrl.origin + p),
  ];
  let manifest = null;
  let manifestUrl = '';
  for (const c of [...new Set(candidates)].slice(0, 5)) {
    const r = await fetchOk(c, { json: true });
    if (!r || r.status !== 200) continue;
    try {
      const j = JSON.parse(r.text.replace(/^﻿/, ''));
      if (j && typeof j === 'object' && !Array.isArray(j)) { manifest = j; manifestUrl = r.finalUrl; break; }
    } catch { /* try the next candidate */ }
  }
  add('manifest', !!manifest, manifest ? `Web App Manifest found (${new URL(manifestUrl).pathname})` : 'No readable Web App Manifest; WyBuild will use the page title, meta tags and favicons instead (Chrome needs a manifest for the best install experience)');
  const base = manifestUrl || finalUrl.href;
  const abs = (u) => { try { return u ? new URL(u, base).href : ''; } catch { return ''; } };

  // 2) icons: manifest first, then apple-touch-icon / <link rel=icon>, then well-known paths
  const icons = (Array.isArray(manifest?.icons) ? manifest.icons : []).filter((i) => i && i.src);
  const purposeOf = (i) => String(i.purpose || 'any').toLowerCase();
  const plain = icons.filter((i) => !/maskable|monochrome/.test(purposeOf(i))).sort((a, b) => iconSize(b) - iconSize(a));
  let best = plain[0] || [...icons].sort((a, b) => iconSize(b) - iconSize(a))[0];
  let iconUrl = best ? abs(best.src) : '';
  let iconPx = best ? iconSize(best) : 0;
  let iconFrom = best ? 'manifest' : '';
  if (!iconUrl) {
    const linkIcons = links
      .filter((l) => /(^|\s)(apple-touch-icon(-precomposed)?|icon|shortcut icon)(\s|$)/i.test(l.rel || '') && l.href && !/\.svg(\?|$)/i.test(l.href))
      .map((l) => ({ src: new URL(l.href, finalUrl).href, sizes: l.sizes, apple: /apple/i.test(l.rel) }))
      .sort((a, b) => iconSize(b) - iconSize(a) || Number(b.apple) - Number(a.apple));
    const wellKnown = ['/apple-touch-icon.png', '/icon-512.png', '/icon-192.png', '/favicon.png', '/favicon.ico'].map((p) => ({ src: finalUrl.origin + p, sizes: '' }));
    for (const c of [...linkIcons, ...wellKnown].slice(0, 6)) {
      if (await isImage(c.src)) { iconUrl = c.src; iconPx = iconSize(c); iconFrom = 'page'; break; }
    }
  }
  if (!iconUrl) { const og = meta('og:image'); if (og && (await isImage(abs(og)))) { iconUrl = abs(og); iconFrom = 'og'; } }
  const maskable = icons.find((i) => /maskable/.test(purposeOf(i)));
  const mono = icons.find((i) => /monochrome/.test(purposeOf(i)));
  const iconReachable = iconUrl ? await isImage(iconUrl) : false;
  if (iconUrl && !iconReachable) { add('icon-reachable', false, `The icon address does not return an image: ${iconUrl}`, 'error'); }
  add('icon-512', !!iconUrl && iconPx >= 512, iconUrl ? (iconPx ? `Largest icon is ${iconPx}px${iconFrom === 'page' ? ' (from page tags, not the manifest)' : ''}${iconPx < 512 ? '; 512px or larger is recommended' : ''}` : `Icon found from ${iconFrom === 'og' ? 'the social preview image' : 'the page'} (size unknown)`) : 'No icon found: add a 512×512 PNG to your manifest');
  add('maskable', !!maskable, maskable ? 'Maskable icon present' : 'No maskable icon: Android will pad the icon on a white tile');

  // 3) colors, names, start page, scope
  const metaTheme = normHex(metas.filter((m) => (m.name || '').toLowerCase() === 'theme-color').map((m) => m.content).find((c) => normHex(c)) || '');
  const themeColor = normHex(manifest?.theme_color) || metaTheme;
  const backgroundColor = normHex(manifest?.background_color);
  const titleTag = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() || '';
  const siteName = manifest?.name || meta('og:site_name') || meta('application-name') || meta('apple-mobile-web-app-title') || titleTag.split(/\s[|\-–—·]\s/)[0] || '';
  const shortName = manifest?.short_name || meta('apple-mobile-web-app-title') || meta('application-name') || siteName;
  add('viewport', /width=device-width/i.test(meta('viewport')), /width=device-width/i.test(meta('viewport')) ? 'Mobile viewport meta tag present' : 'No <meta name="viewport" content="width=device-width, initial-scale=1">: the app may render like a desktop page');
  let startUrl = null;
  try { startUrl = manifest?.start_url ? new URL(manifest.start_url, manifestUrl || finalUrl) : null; } catch { /* ignore */ }
  const crossOrigin = !!startUrl && startUrl.origin !== finalUrl.origin;
  if (crossOrigin) add('start-origin', false, `start_url is on ${startUrl.origin}, a different site. Add it as a trusted domain and publish assetlinks.json there too`);
  const display = ['fullscreen', 'minimal-ui', 'standalone'].includes(manifest?.display) ? manifest.display : (Array.isArray(manifest?.display_override) ? manifest.display_override.find((d) => ['fullscreen', 'standalone', 'minimal-ui'].includes(d)) : '') || 'standalone';
  const orientation = /portrait/.test(manifest?.orientation || '') ? 'portrait' : /landscape/.test(manifest?.orientation || '') ? 'landscape' : 'default';
  const shortcuts = (Array.isArray(manifest?.shortcuts) ? manifest.shortcuts : []).slice(0, 4).map((s) => {
    try {
      const u = new URL(s.url, manifestUrl || finalUrl);
      if (u.origin !== finalUrl.origin) return null;
      return { name: String(s.name || '').slice(0, 40), shortName: String(s.short_name || s.name || '').slice(0, 12), url: (u.pathname + u.search).slice(0, 300) };
    } catch { return null; }
  }).filter((s) => s && s.name && s.url.startsWith('/'));

  // 4) assetlinks (does the site already trust an Android package?)
  let assetlinks = null;
  const al = await fetchOk(`${finalUrl.origin}/.well-known/assetlinks.json`, { json: true });
  try { assetlinks = al && al.status === 200 ? JSON.parse(al.text) : null; } catch { assetlinks = null; }

  // 5) native features the site's own code appears to use (suggestions only; the user decides)
  const scriptUrls = [...new Set([
    ...htmlTags(html, 'script').map((s) => s.src),
    ...links.filter((l) => /modulepreload|preload/.test(l.rel || '') && /\.m?js(\?|$)/.test(l.href || '')).map((l) => l.href),
  ].filter(Boolean).map((s) => { try { return new URL(s, finalUrl); } catch { return null; } }).filter((u) => u && u.origin === finalUrl.origin).map((u) => u.href))].slice(0, 5);
  const code = [html, ...(await Promise.all(scriptUrls.map(async (u) => (await fetchOk(u, { maxBytes: 3_000_000 }))?.text || '')))].join('\n');
  const swSeen = /serviceWorker\s*\.\s*register|navigator\.serviceWorker/.test(code);
  const featureHints = [
    /Notification\s*\.\s*requestPermission|PushManager|pushManager\s*\.\s*subscribe|showNotification/.test(code) && 'notifications',
    /geolocation\s*\.\s*(getCurrentPosition|watchPosition)/.test(code) && 'location',
    /getUserMedia/.test(code) && /video\s*:/.test(code) && 'camera',
    /getUserMedia/.test(code) && /audio\s*:/.test(code) && 'microphone',
    /navigator\s*\.\s*vibrate/.test(code) && 'vibration',
  ].filter(Boolean);
  add('service-worker', swSeen, swSeen ? 'Service worker registered (offline support)' : 'No service worker found: the app needs a network connection to open', 'warn');
  if (featureHints.length) add('feature-hints', true, `Your site's code uses: ${featureHints.join(', ')}. Enable the matching Native features below.`);

  const host = finalUrl.hostname.replace(/^www\./, '');
  return {
    detected: {
      webUrl: finalUrl.origin + (finalUrl.pathname === '/' ? '/' : finalUrl.pathname),
      webManifestUrl: manifestUrl || undefined,
      name: String(siteName).slice(0, 50),
      launcherName: String(shortName || siteName).slice(0, 30),
      themeColor,
      backgroundColor,
      startUrl: startUrl ? startUrl.pathname + startUrl.search : '/',
      display,
      orientation,
      iconUrl: iconReachable ? iconUrl : '',
      maskableIconUrl: maskable ? abs(maskable.src) : '',
      monochromeIconUrl: mono ? abs(mono.src) : '',
      additionalTrustedOrigins: crossOrigin ? [startUrl.origin] : undefined,
      shortcuts: shortcuts.length ? shortcuts : undefined,
      packageId: host.split('.').reverse().map((x) => x.replace(/[^a-z0-9]/gi, '').toLowerCase()).filter(Boolean).map((x) => (/^[a-z]/.test(x) ? x : `a${x}`)).join('.'),
    },
    featureHints,
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

  if (path === 'auth/token' && post) {
    // Sign in with a GitHub personal access token (for accounts where OAuth cannot be granted enough access).
    // A token never gives more access than the account that created it; we verify it before creating a session.
    const raw = String(bodyOf(req).token || '').trim();
    if (!/^[A-Za-z0-9_]{20,255}$/.test(raw)) throw new HttpError(400, 'That does not look like a GitHub token.', 'BAD_TOKEN_FORMAT', { hint: 'Paste the whole token, starting with ghp_ (classic) or github_pat_ (fine-grained), with no spaces or quotes.' });
    const probe = await gh({ token: raw }, '/user');
    if (probe.status === 401) throw new HttpError(401, 'GitHub rejected this token (401 Bad credentials).', 'TOKEN_REJECTED', { hint: 'The token is mistyped, expired or revoked. Create a new one at github.com/settings/tokens.' });
    if (!probe.ok) throw new HttpError(502, `GitHub could not verify the token (HTTP ${probe.status}).`, 'TOKEN_UNVERIFIED', { hint: 'Retry in a moment.' });
    const u = await probe.json();
    const scopeHeader = probe.headers.get('x-oauth-scopes');
    const fine = raw.startsWith('github_pat_') || scopeHeader === null;
    if (!fine) {
      const have = scopeHeader.split(/,\s*/).filter(Boolean);
      const missing = ['repo', 'workflow'].filter((x) => !have.includes(x));
      if (missing.length) {
        throw new HttpError(400, `This token (for ${u.login}) is missing the ${missing.map((x) => `"${x}"`).join(' and ')} scope${missing.length > 1 ? 's' : ''}. It has: ${have.join(', ') || 'none'}.`, 'TOKEN_SCOPES', {
          hint: 'Create a classic token with both "repo" and "workflow" ticked: github.com/settings/tokens/new?scopes=repo,workflow&description=WyBuild',
          details: { login: u.login, scopes: have.join(', ') || 'none' },
        });
      }
    }
    const session = { token: raw, login: u.login, name: u.name || u.login, avatar: u.avatar_url, email: u.email || '', exp: Date.now() + 7 * 24 * 3600 * 1000 };
    res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, seal(session), 7 * 24 * 3600));
    return send(res, 200, { ok: true, login: u.login, tokenType: fine ? 'fine-grained' : 'classic' });
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
    if (isLifetimeFree(session.login)) {
      throw new HttpError(403, 'This GitHub account has WyBuild Free Forever access and does not need billing.', 'FREE_FOREVER');
    }
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
      usage = { monthlyBuildsUsed: 0, monthlyLimit: isLifetimeFree(session.login) ? PLANS.lifetimeFree.monthlyLimit : PLANS.free.monthlyLimit, concurrentLimit: isLifetimeFree(session.login) ? PLANS.lifetimeFree.concurrentLimit : PLANS.free.concurrentLimit, resetsAt: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString() };
    }
    return send(res, 200, { user: { login: session.login, name: session.name, avatar: session.avatar, email: session.email }, subscription: sub, usage, lifetimeFree: isLifetimeFree(session.login), pricing: PRICING, pricingNgn: PRICING_NGN, defaultKeystore: !!defaultKeystore(), defaultKeystoreProblem: defaultKeystoreState().problem || undefined });
  }

  if (path === 'repos' && m === 'GET') {
    // every repo the signed-in user can see, newest push first (up to 300)
    const list = [];
    for (let page = 1; page <= 3; page++) {
      const part = await ghJson(session, `/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`);
      list.push(...part);
      if (part.length < 100) break;
    }
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
    const MANIFEST_PATHS = ['public/manifest.webmanifest', 'public/manifest.json', 'manifest.webmanifest', 'manifest.json', 'static/manifest.json', 'src/manifest.json', 'docs/manifest.json'];
    const CNAME_PATHS = ['CNAME', 'public/CNAME', 'docs/CNAME', 'static/CNAME'];
    const [packageJson, gradle, manifest, twaWf, latest, signing, repoManifestFiles, cnameFiles] = await Promise.all([
      readFile('package.json'), readFile('android/app/build.gradle'),
      readFile('android/app/src/main/AndroidManifest.xml'), readFile(WORKFLOW_KINDS.twa.path),
      ghJson(session, `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`).catch(() => []),
      signingStatus(session, repo),
      Promise.all(MANIFEST_PATHS.map((f) => readFile(f).catch(() => ''))),
      Promise.all(CNAME_PATHS.map((f) => readFile(f).catch(() => ''))),
    ]);
    let framework = 'unknown';
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        framework = deps.expo ? 'expo' : deps['react-native'] ? 'react-native' : 'web';
      } catch { framework = 'web'; }
    }
    const packageId = /applicationId\s+["']([^"']+)/.exec(gradle)?.[1] || /package="([^"]+)"/.exec(manifest)?.[1] || undefined;
    const workflows = { twa: { installed: !!twaWf, upToDate: Number((/wybuild-twa-workflow-version:\s*(\d+)/.exec(twaWf) || [])[1] || 0) >= TWA_WORKFLOW_VERSION } };
    const latestCommitSha = Array.isArray(latest) ? (latest[0]?.sha || '') : '';
    // best guess at the live website for web repos: GitHub "Website" field, else GitHub Pages
    let homepage = String(info.homepage || '').trim();
    if (homepage && !/^https?:\/\//i.test(homepage)) homepage = `https://${homepage}`;
    // more places a live address hides: package.json "homepage", a CNAME file, then GitHub Pages
    let pkgMeta = {};
    try { pkgMeta = packageJson ? JSON.parse(packageJson) : {}; } catch { pkgMeta = {}; }
    if (!homepage && typeof pkgMeta.homepage === 'string' && /^https?:\/\/[^\s]+$/i.test(pkgMeta.homepage.trim()) && !/github\.com\//i.test(pkgMeta.homepage)) homepage = pkgMeta.homepage.trim();
    const cname = cnameFiles.map((t) => String(t).trim().split(/\s+/)[0]).find((t) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t || ''));
    if (!homepage && cname) homepage = `https://${cname.toLowerCase()}/`;
    // the web app manifest that lives in the repo (used to fill anything the live site does not publish)
    let repoWeb;
    for (let i = 0; i < repoManifestFiles.length && !repoWeb; i++) {
      try {
        const j = JSON.parse(String(repoManifestFiles[i]).replace(/^\uFEFF/, ''));
        if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
        const hex = (v) => (HEX.test(String(v || '')) ? String(v).toLowerCase() : '');
        repoWeb = {
          source: MANIFEST_PATHS[i],
          name: typeof j.name === 'string' ? j.name.slice(0, 50) : '',
          launcherName: typeof (j.short_name || j.name) === 'string' ? String(j.short_name || j.name).slice(0, 30) : '',
          themeColor: hex(j.theme_color), backgroundColor: hex(j.background_color),
          display: ['fullscreen', 'minimal-ui', 'standalone'].includes(j.display) ? j.display : '',
          orientation: /portrait/.test(j.orientation || '') ? 'portrait' : /landscape/.test(j.orientation || '') ? 'landscape' : '',
          startUrl: typeof j.start_url === 'string' && j.start_url.startsWith('/') ? j.start_url.slice(0, 300) : '',
        };
      } catch { /* not a manifest */ }
    }
    if (!repoWeb && (pkgMeta.name || info.description)) repoWeb = { source: 'package.json', name: String(pkgMeta.displayName || info.description || '').slice(0, 50), launcherName: '', themeColor: '', backgroundColor: '', display: '', orientation: '', startUrl: '' };
    if (!homepage && info.has_pages) homepage = /\.github\.io$/i.test(info.name) ? `https://${info.name.toLowerCase()}/` : `https://${info.owner.login.toLowerCase()}.github.io/${info.name}/`;
    return send(res, 200, {
      repo, name: info.name, defaultBranch: branch, framework, flutterVersion: 'n/a', packageId, latestCommitSha,
      workflowInstalled: workflows.twa.installed, workflowUpToDate: workflows.twa.upToDate, workflows,
      signing, signingProblem: signing === 'none' ? (defaultKeystoreState().problem || undefined) : undefined, homepage: homepage.startsWith('https://') ? homepage : '',
      canPush: !!info.permissions?.push, private: !!info.private, web: repoWeb, homepageFrom: info.homepage ? 'github' : homepage ? 'repo' : '',
    });
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
    if (bodyOf(req).kind !== 'twa') throw new HttpError(410, 'The standalone Flutter/Gradle workflow has been removed. Use Web → Android.', 'WEB_ONLY');
    const { repo, branch, kind } = bodyOf(req);
    checkRepo(repo);
    const k = WORKFLOW_KINDS[kindOf(kind)];
    const target = branch || (await ghJson(session, `/repos/${repo}`, undefined, `looking up ${repo}`)).default_branch;
    // a missing "workflow" scope shows up as a confusing 404 from GitHub, so check it up front
    const who = await gh(session, '/user');
    const sc = who.headers.get('x-oauth-scopes');
    if (sc !== null && !sc.split(/,\s*/).includes('workflow')) {
      throw new HttpError(403, `Your GitHub login is missing the "workflow" permission (granted: ${sc || 'none'}), so WyBuild cannot write .github/workflows files.`, 'MISSING_WORKFLOW_SCOPE', {
        hint: 'Sign out of WyBuild and sign in again, approving the "repo" and "workflow" permissions.',
        details: { oauthScopes: sc || 'none' },
      });
    }
    // commit the workflow first, helper scripts after it; the contents API needs one request per file
    for (const [repoPath, localPath] of k.files) {
      const content = fs.readFileSync(new URL(`../workflow/${localPath}`, import.meta.url), 'utf8');
      const ex = await gh(session, `/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(target)}`);
      if (!ex.ok && ex.status !== 404) {
        await ghJson(session, `/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(target)}`, undefined, `checking ${repoPath} on branch ${target}`);
      }
      const sha = ex.ok ? (await ex.json()).sha : undefined;
      try {
        await ghJson(session, `/repos/${repo}/contents/${repoPath}`, {
          method: 'PUT',
          body: JSON.stringify({ message: `ci: ${sha ? 'update' : 'add'} WyBuild ${kindOf(kind) === 'twa' ? 'TWA ' : ''}workflow (${repoPath.split('/').pop()})`, content: Buffer.from(content).toString('base64'), branch: target, ...(sha ? { sha } : {}) }),
        }, `writing ${repoPath} to branch ${target}`);
      } catch (e) {
        if (e instanceof HttpError && (e.status === 403 || e.status === 404) && e.code !== 'GITHUB_RATE_LIMIT') {
          const d = await diagnoseWriteFailure(session, repo, target, e);
          d.message = `${d.message} (while writing ${repoPath})`;
          throw d;
        }
        throw e;
      }
    }
    // install the keystore variables together with the workflow so the repo is ready for its first build
    let signing = 'none';
    try { await ensureSigning(session, repo); signing = await signingStatus(session, repo); } catch { /* reported at build time with a precise reason */ }
    return send(res, 200, { ok: true, branch: target, signing });
  }

  if (path === 'build' && post) {
    throw new HttpError(410, 'Standalone Flutter/Gradle builds have been removed. Use Web → Android.', 'WEB_ONLY');
  /* legacy Flutter build code intentionally unreachable */
  if (false) {
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
    if (wf.status === 404) throw new HttpError(409, `The WyBuild workflow (${WORKFLOW_PATH}) is not on branch "${branch}" of ${repo}.`, 'NO_WORKFLOW', { hint: 'Reconnect the project to install the workflow, or commit it to that branch.' });
    {
      const wfText = Buffer.from(((await wf.json().catch(() => ({}))).content || ''), 'base64').toString('utf8');
      const have = Number((/wybuild-workflow-version:\s*(\d+)/.exec(wfText) || [])[1] || 0);
      if (have < WORKFLOW_VERSION) throw new HttpError(409, `The WyBuild workflow in ${repo} is outdated (v${have}, current v${WORKFLOW_VERSION}).`, 'WORKFLOW_OUTDATED', { hint: 'WyBuild reinstalls it automatically; if you see this, press Build again.' });
    }

    // Every build first makes sure the repo has the keystore secrets (own key, or a copy of the Vercel default).
    // Release builds are then signed. A failure to install is only tolerated for debug/profile builds, or when
    // no key exists anywhere (release then builds unsigned as before); any other failure is shown, never hidden.
    let useKs = false;
    try {
      await ensureSigning(session, repo);
      useKs = !!c.useKeystore || c.mode === 'release';
    } catch (e) {
      if (c.useKeystore || (c.mode === 'release' && e.code !== 'NO_KEYSTORE')) throw e;
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
          use_keystore: String(useKs),
          timeout_minutes: String((await usageFor(session.login)).plan.monthlyLimit >= 9999 ? 60 : 15),
        },
      }),
    });
    if (r.status !== 204) {
      await kv.decr(inflightKey);
      const e = await r.json().catch(() => ({}));
      const d = describeGithubFailure(r, e, `starting the build on branch ${branch}`, `POST /repos/${repo}/actions/workflows/<workflow>/dispatches`);
      throw new HttpError(d.http === 404 ? 409 : d.http, d.code === 'GITHUB_NOT_FOUND' ? `GitHub cannot find the workflow on branch "${branch}" of ${repo} (404).` : d.message, d.code === 'GITHUB_NOT_FOUND' ? 'WORKFLOW_NOT_DISPATCHABLE' : d.code, { hint: d.code === 'GITHUB_NOT_FOUND' ? 'The workflow file must exist on that exact branch and contain "on: workflow_dispatch". Reinstall the workflow for that branch, make sure Actions is enabled in the repo settings, then retry.' : d.hint, details: d.details });
    }
    return send(res, 200, { ok: true });
  }

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
    if (wf.status === 404) throw new HttpError(409, `The WyBuild TWA workflow (${TWA_WORKFLOW_PATH}) is not on branch "${branch}" of ${repo}.`, 'NO_WORKFLOW', { hint: 'Open Web to Android, pick this repo and use Update workflow to install it.' });
    {
      const wfText = Buffer.from(((await wf.json().catch(() => ({}))).content || ''), 'base64').toString('utf8');
      const have = Number((/wybuild-twa-workflow-version:\s*(\d+)/.exec(wfText) || [])[1] || 0);
      if (have < TWA_WORKFLOW_VERSION) throw new HttpError(409, `The WyBuild TWA workflow in ${repo} is outdated (v${have}, current v${TWA_WORKFLOW_VERSION}).`, 'WORKFLOW_OUTDATED', { hint: 'WyBuild reinstalls it automatically; if you see this, press Build again.' });
    }
    const missingHelpers = [];
    for (const [repoPath] of WORKFLOW_KINDS.twa.files.slice(1)) {
      const hr = await gh(session, `/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(branch)}`);
      if (hr.status === 404) missingHelpers.push(repoPath);
      else if (!hr.ok) await ghJson(session, `/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(branch)}`, undefined, `checking ${repoPath}`);
    }
    if (missingHelpers.length) throw new HttpError(409, `The TWA workflow is installed but these helper files are missing on branch "${branch}": ${missingHelpers.join(', ')}.`, 'MISSING_HELPER_FILES', { hint: 'The build would fail with "No such file". Use Update workflow to commit all four WyBuild TWA files, then retry.', details: { missing: missingHelpers } });
    if (useKeystore) await ensureSigning(session, repo);
    else await ensureSigning(session, repo).catch(() => {}); // still leave the secrets in place for later builds

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
          bubblewrap_version: /^(\d+\.\d+\.\d+)$/.test(String(b.bubblewrapVersion || '')) ? b.bubblewrapVersion : '1.25.0',
        },
      }),
    });
    if (r.status !== 204) {
      await kv.decr(inflightKey);
      const e = await r.json().catch(() => ({}));
      const d = describeGithubFailure(r, e, `starting the build on branch ${branch}`, `POST /repos/${repo}/actions/workflows/<workflow>/dispatches`);
      throw new HttpError(d.http === 404 ? 409 : d.http, d.code === 'GITHUB_NOT_FOUND' ? `GitHub cannot find the workflow on branch "${branch}" of ${repo} (404).` : d.message, d.code === 'GITHUB_NOT_FOUND' ? 'WORKFLOW_NOT_DISPATCHABLE' : d.code, { hint: d.code === 'GITHUB_NOT_FOUND' ? 'The workflow file must exist on that exact branch and contain "on: workflow_dispatch". Reinstall the workflow for that branch, make sure Actions is enabled in the repo settings, then retry.' : d.hint, details: d.details });
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
    if (!loc) throw new HttpError(404, `GitHub has no downloadable artifact ${query.id} in ${repo} (HTTP ${r.status}).`, 'ARTIFACT_GONE', { hint: 'Artifacts expire after the repository retention period (default 90 days) or when the run is deleted. Rebuild to get a fresh one.' });
    return redirect(res, loc);
  }

  if (path === 'signing/reset' && post) {
    // explicit user action: replace this repo's signing secrets with the WyBuild (Vercel) default key
    const repo = checkRepo(bodyOf(req).repo);
    const st = defaultKeystoreState();
    if (st.state !== 'ok') {
      throw new HttpError(400, st.problem || 'No default keystore is configured in the WyBuild Vercel environment.', 'NO_KEYSTORE', {
        hint: 'Set WB_KEYSTORE_BASE64, WB_KEYSTORE_PASSWORD, WB_KEY_ALIAS and WB_KEY_PASSWORD in the WyBuild Vercel project and redeploy.',
      });
    }
    await installDefaultKeystore(session, repo, st);
    return send(res, 200, { ok: true, signing: 'default' });
  }

  if (path === 'keystore' && m === 'GET') {
    const repos = String(query.repos || '').split(',').filter(Boolean).slice(0, 10).map(checkRepo);
    return send(res, 200, { keystores: await keystoresFor(session, repos) });
  }

  if (path === 'keystore' && post) {
    const { repo, name, alias, storePassword, keyPassword, fileBase64 } = bodyOf(req);
    checkRepo(repo);
    const billing = await usageFor(session.login);
    if (!billing.sub && !billing.lifetimeFree) {
      const keyCount = Number((await kv.get(`wb:kscount:${session.login}`)) || 0);
      if (keyCount >= 1) throw new HttpError(402, 'Free tier includes 1 release keystore. Upgrade to Pro for unlimited signing profiles.', 'PRO_REQUIRED');
    }
    if (!alias || !storePassword || !fileBase64) throw new HttpError(400, 'Keystore file, alias and password are required');
    const parsed = parseKeystore(fileBase64, String(storePassword));
    if (!parsed.ok) throw new HttpError(400, `This keystore ${parsed.problem}`, parsed.code, { hint: 'Upload the .jks / .p12 file itself, not a text copy of it, and check the store password.' });
    const bytes = parsed.bytes;
    const cleanB64 = parsed.b64;
    if (cleanB64.length > 48000) throw new HttpError(400, 'Keystore file is larger than GitHub\'s 48 KB secret limit');
    const pub = await ghJson(session, `/repos/${repo}/actions/secrets/public-key`);
    await putSecret(session, repo, pub, 'WB_KEYSTORE_PASSWORD', String(storePassword));
    await putSecret(session, repo, pub, 'WB_KEY_ALIAS', String(alias));
    await putSecret(session, repo, pub, 'WB_KEY_PASSWORD', String(keyPassword || storePassword));
    await putSecret(session, repo, pub, 'WB_KEYSTORE_BASE64', cleanB64);
    await kv.del(defaultMarkerKey(repo)).catch(() => {}); // the repo now has the owner's own key: never rotate over it
    await kv.set(`wb:ks:${session.login}:${repo}`, { name: String(name || '').slice(0, 80), alias: String(alias).slice(0, 80), sha256: crypto.createHash('sha256').update(bytes).digest('hex'), createdAt: new Date().toISOString() });
    if (!billing.sub && !billing.lifetimeFree) await kv.set(`wb:kscount:${session.login}`, 1);
    return send(res, 200, { ok: true });
  }

  if (path === 'keystore' && m === 'DELETE') {
    const repo = checkRepo(query.repo);
    const existingMeta = await kv.get(`wb:ks:${session.login}:${repo}`);
    await Promise.all(SECRET_NAMES.map((n) => gh(session, `/repos/${repo}/actions/secrets/${n}`, { method: 'DELETE' })));
    await kv.del(`wb:ks:${session.login}:${repo}`);
    await kv.del(defaultMarkerKey(repo)).catch(() => {});
    if (existingMeta) {
      const billing = await usageFor(session.login);
      if (!billing.sub && !billing.lifetimeFree) await kv.del(`wb:kscount:${session.login}`);
    }
    return send(res, 200, { ok: true });
  }

  throw new HttpError(404, `Unknown WyBuild API route: ${m} /api/${path}`, 'UNKNOWN_ROUTE', { hint: 'The frontend and API are out of sync (stale deployment or cached page). Redeploy and hard-refresh.', details: { route: `${m} /api/${path}` } });
}

export default async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/^\/api\//, '').replace(/\/$/, '');
    await route(req, res, path, Object.fromEntries(url.searchParams));
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.end();
    send(res, e.status || 500, {
      error: e instanceof HttpError ? e.message : `Unexpected server error: ${String(e?.message || e).slice(0, 200)}`,
      ...(e.code ? { code: e.code } : e instanceof HttpError ? {} : { code: 'INTERNAL' }),
      ...(e.hint ? { hint: e.hint } : {}),
      ...(e.details ? { details: e.details } : {}),
    });
  }
}
