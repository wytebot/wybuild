import crypto from 'node:crypto';
import fs from 'node:fs';
import { kv } from '../lib/kv.js';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import nacl from 'tweetnacl';
import blake from 'blakejs';
import JSZip from 'jszip';

const TWA_WORKFLOW_FILE = 'wybuild-twa.yml';
const TWA_WORKFLOW_PATH = `.github/workflows/${TWA_WORKFLOW_FILE}`;
const TWA_WORKFLOW_VERSION = 37;
const TWA_MIN_SDK = 24; // androidbrowserhelper 2.7.x declares minSdk 24; a lower value fails the manifest merge
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
      ['.github/wybuild/WyBuildActivity.java', 'wybuild/WyBuildActivity.java'],
      ['.github/wybuild/WyBuildReminderReceiver.java', 'wybuild/WyBuildReminderReceiver.java'],
      ['.github/wybuild/capacitor-bridge.entry.js', 'wybuild/capacitor-bridge.entry.js'],
      ['.github/wybuild/capacitor-finalize.py', 'wybuild/capacitor-finalize.py'],
    ],
  },
};
const kindOf = (v) => 'twa';

/* ------------------------- GitHub Releases from a build artifact ------------------------- */
// Only installable binaries are ever published. Everything else in the artifact (logs, fingerprints, helper
// files) is ignored, and nothing is written to a release unless the person pressed Publish.
const RELEASE_ASSET_RE = /\.(apk|aab)$/i;
const MAX_ARTIFACT_BYTES = 150 * 1024 * 1024;
const TAG_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/;
const safeAssetName = (n) => String(n).split('/').pop().replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120);
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

async function loadArtifactZip(session, repo, artifactId) {
  if (!/^\d+$/.test(String(artifactId || ''))) throw new HttpError(400, 'Invalid artifact id', 'BAD_ARTIFACT');
  const sref = await signedArtifactRef(artifactId);
  let meta, r;
  if (sref) { // signed build kept on the signer repo
    const sg = signerState();
    if (!sg.ok || sref.repo !== String(repo).toLowerCase()) throw new HttpError(404, 'Signed build not found.', 'ARTIFACT_GONE');
    const seen = await gh(session, `/repos/${repo}/actions/runs/${sref.runId}`);
    if (!seen.ok) throw new HttpError(404, 'Signed build not found.', 'ARTIFACT_GONE');
    const mr = await signerGh(`/repos/${sg.repo}/actions/artifacts/${artifactId}`);
    if (!mr.ok) throw new HttpError(404, 'The signed build is no longer available. Build again.', 'ARTIFACT_GONE');
    meta = await mr.json();
    if (!/^wb-signed-/.test(meta.name || '')) throw new HttpError(400, 'Only artifacts produced by a WyBuild build can be released.', 'NOT_WYBUILD_ARTIFACT');
    r = await signerGh(`/repos/${sg.repo}/actions/artifacts/${artifactId}/zip`, { redirect: 'manual' });
  } else {
    meta = await ghJson(session, `/repos/${repo}/actions/artifacts/${artifactId}`, undefined, 'reading the build artifact');
    if (!/^wb-twa-/.test(meta.name || '')) throw new HttpError(400, 'Only signed artifacts produced by a WyBuild build can be released.', 'NOT_WYBUILD_ARTIFACT');
  }
  if (meta.expired) throw new HttpError(410, 'This build artifact has expired on GitHub.', 'ARTIFACT_GONE', { hint: 'Run the build again; artifacts are kept for the repository retention period (90 days by default), signed builds for 14 days.' });
  if (meta.size_in_bytes > MAX_ARTIFACT_BYTES) throw new HttpError(413, `This artifact is ${fmtBytes(meta.size_in_bytes)}, above the ${fmtBytes(MAX_ARTIFACT_BYTES)} limit WyBuild can process.`, 'ARTIFACT_TOO_LARGE');
  if (!r) r = await gh(session, `/repos/${repo}/actions/artifacts/${artifactId}/zip`, { redirect: 'manual' });
  const loc = r.headers.get('location');
  if (!loc) throw new HttpError(404, `GitHub has no downloadable artifact ${artifactId} in ${repo} (HTTP ${r.status}).`, 'ARTIFACT_GONE', { hint: 'Run the build again.' });
  const dl = await fetch(loc); // pre-signed storage URL: must NOT carry the GitHub token
  if (!dl.ok) throw new HttpError(502, `Downloading the artifact from GitHub storage failed (HTTP ${dl.status}).`, 'ARTIFACT_DOWNLOAD');
  let zip;
  try { zip = await JSZip.loadAsync(Buffer.from(await dl.arrayBuffer())); }
  catch { throw new HttpError(422, 'The build artifact is not a readable zip file.', 'ARTIFACT_CORRUPT'); }
  const entries = zip.file(RELEASE_ASSET_RE).filter((f) => !f.dir);
  if (!entries.length) throw new HttpError(422, 'This artifact contains no .apk or .aab file to release.', 'NO_BINARIES', { hint: 'Build with output "APK", "AAB" or "Both" and try again.' });
  return { meta, zip, entries };
}

const parseBinaryName = (name) => {
  const m = /^(.*)_([^_]+)_(\d+)\.(apk|aab)$/i.exec(name);
  return m ? { packageId: m[1], versionName: m[2], versionCode: m[3] } : {};
};

async function releaseExistsForTag(session, repo, tag) {
  const r = await gh(session, `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`);
  if (r.status === 404) return null;
  if (!r.ok) await ghJson(session, `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, undefined, `checking tag ${tag}`);
  return r.json();
}
async function tagExists(session, repo, tag) {
  const r = await gh(session, `/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`);
  return r.ok;
}

// Compare every WyBuild file committed in a repo branch against the copy bundled with THIS deployment.
// A version number alone is not enough: helper scripts can change without the workflow header changing,
// and the Builds page and Web to Android page must agree on what "up to date" means.
async function twaStaleFiles(session, repo, branch, req) {
  const norm = (t) => String(t).replace(/\r\n/g, '\n').trim();
  const stale = [];
  await Promise.all(WORKFLOW_KINDS.twa.files.map(async ([repoPath, localPath]) => {
    let want = fs.readFileSync(new URL(`../workflow/${localPath}`, import.meta.url), 'utf8');
    if (repoPath === TWA_WORKFLOW_PATH) want = want.replaceAll('__WYBUILD_APP_URL__', appUrl(req));
    const r = await gh(session, `/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(branch)}`);
    if (r.status === 404) { stale.push(repoPath); return; }
    if (!r.ok) { await ghJson(session, `/repos/${repo}/contents/${repoPath}?ref=${encodeURIComponent(branch)}`, undefined, `checking ${repoPath}`); return; }
    const f = await r.json();
    const have = Buffer.from(f.content || '', 'base64').toString('utf8');
    if (norm(have) !== norm(want)) stale.push(repoPath);
  }));
  return stale;
}

const SESSION_COOKIE = 'wb_session';
const STATE_COOKIE = 'wb_state';
const STALE_ACTIVE_MS = 3 * 60 * 60 * 1000;
const LIFETIME_FREE_LOGINS = new Set(['wytebot', 'wytzbot', ...String(process.env.WYBUILD_FREE_LOGINS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)]);
const FREE_FOREVER_BALANCE = 999999;
const PLANS = {
  // Cloud builds run in the connected user's GitHub Actions account; WyBuild diagnosis/repair uses the separate automation credit wallet.
  free: { monthlyLimit: Number.MAX_SAFE_INTEGER, concurrentLimit: 3 },
  pro: { monthlyLimit: Number.MAX_SAFE_INTEGER, concurrentLimit: 5 },
  lifetimeFree: { monthlyLimit: Number.MAX_SAFE_INTEGER, concurrentLimit: 5 },
};
// USD is the billing currency. NGN values are display equivalents only;
// Flutterwave continues to charge/verify the configured USD amount.
const PRICING = { monthly: 9.99, yearly: 99 };
const PRICING_NGN = { monthly: 15000, yearly: 150000 };
const CANCELLATION_GRACE_MS = 5 * 24 * 60 * 60 * 1000;
const RENEWAL_FAILURE_GRACE_MS = 5 * 24 * 60 * 60 * 1000;
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
  if (!s) throw new HttpError(401, 'Your WyBuild login session has expired or is missing. Sign in again to continue.', 'SESSION_EXPIRED', { hint: 'Return to the login screen and choose Continue with GitHub. Your projects and subscription are not deleted.' });
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
  if (status === 401) return { code: 'GITHUB_AUTH_EXPIRED', message: `WyBuild could not authenticate with GitHub${where}. The saved GitHub authorization is expired, revoked, or no longer valid (GitHub returned 401). This is not a password error.`, hint: 'Sign out of WyBuild, then sign in with GitHub again and approve the requested permissions.', details: { ...details, githubMessage: gm || undefined }, http: 401 };
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
function idempotencyKey(prefix) {
  // A caller-supplied prefix identifies one logical write and must remain stable across retries.
  // Read-only/unlabelled requests get a fresh trace-like value but do not depend on idempotency.
  return String(prefix || crypto.randomUUID()).replace(/[^A-Za-z0-9-]/g, '').slice(0, 120);
}

async function flw4(path, init = {}, opts = {}) {
  const token = await flw4Token();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Trace-Id': traceId(),
    ...(opts.idempotencyPrefix ? { 'X-Idempotency-Key': idempotencyKey(opts.idempotencyPrefix) } : {}),
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
  if ((sub.status === 'active' && until > Date.now()) || ((sub.status === 'past_due' || sub.status === 'cancelled') && grace > Date.now())) return sub;
  return null;
}

const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7);

/* ---------------------------- Automation credits --------------------------- */
// Automation credits are non-expiring, one-time purchases. WyBuild's deterministic engine uses no AI provider.
// Credits pay for deterministic automation operations, repository inspection, and integration workflows; they are not AI-token charges.
const CREDIT_PACKS = {
  starter: { credits: 100, amount: 4.99, currency: 'USD', ngn: 7500 },
  builder: { credits: 250, amount: 9.99, currency: 'USD', ngn: 15000 },
  studio: { credits: 700, amount: 24.99, currency: 'USD', ngn: 37500 },
};
const AUTOMATION_ENGINE = 'WyBuild Deterministic Automation Engine v1';
async function creditsFor(login) {
  if (isLifetimeFree(login)) return { balance: FREE_FOREVER_BALANCE, updatedAt: null, unlimited: true };
  let wallet = await kv.get(`wb:credits:${login}`);
  if (!wallet) {
    wallet = { balance: 10, starterGranted: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const claimed = await kv.set(`wb:credits:${login}`, wallet, { nx: true });
    if (!claimed) wallet = await kv.get(`wb:credits:${login}`) || wallet;
  }
  return { balance: Math.max(0, Number(wallet.balance || 0)), updatedAt: wallet.updatedAt || null };
}
async function debitCredits(login, amount, reason, metadata = {}) {
  if (isLifetimeFree(login)) return FREE_FOREVER_BALANCE; // Free Forever accounts are never charged
  // Short per-user lock prevents simultaneous automation operations from spending the same wallet balance.
  const lockKey = `wb:credits-lock:${login}`;
  const locked = await kv.set(lockKey, crypto.randomUUID(), { nx: true, ex: 30 });
  if (!locked) throw new HttpError(409, 'Another automation activity is updating your credit balance. Retry in a few seconds.', 'CREDITS_BUSY');
  try {
    const key = `wb:credits:${login}`;
    const wallet = (await kv.get(key)) || { balance: 10, starterGranted: true };
    const balance = Math.max(0, Number(wallet.balance || 0));
    const debit = Math.max(0, Math.ceil(Number(amount) || 0));
    if (balance < debit) throw new HttpError(402, `This automation activity needs ${debit} credits; your balance is ${balance}. Buy a one-time credit pack to continue.`, 'INSUFFICIENT_CREDITS', { details: { balance, required: debit } });
    const next = { ...wallet, balance: balance - debit, updatedAt: new Date().toISOString() };
    await kv.set(key, next);
    await kv.set(`wb:credit-ledger:${login}:${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, { delta: -debit, reason, metadata, at: new Date().toISOString() }, { ex: 60 * 60 * 24 * 365 });
    return next.balance;
  } finally { await kv.del(lockKey).catch(() => {}); }
}
async function refundCredits(login, amount, reason, metadata = {}) {
  if (isLifetimeFree(login)) return FREE_FOREVER_BALANCE;
  const lockKey = `wb:credits-lock:${login}`;
  const locked = await kv.set(lockKey, crypto.randomUUID(), { nx: true, ex: 30 });
  if (!locked) throw new HttpError(409, 'Another credit activity is updating this wallet. Retry shortly.', 'CREDITS_BUSY');
  try {
    const key = `wb:credits:${login}`;
    const wallet = (await kv.get(key)) || { balance: 0, starterGranted: true };
    const refund = Math.max(0, Math.ceil(Number(amount) || 0));
    const next = { ...wallet, balance: Math.max(0, Number(wallet.balance || 0)) + refund, updatedAt: new Date().toISOString() };
    await kv.set(key, next);
    await kv.set(`wb:credit-ledger:${login}:refund-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`, { delta: refund, reason, metadata, at: new Date().toISOString() }, { ex: 60 * 60 * 24 * 365 });
    return next.balance;
  } finally { await kv.del(lockKey).catch(() => {}); }
}
function scrubBuildLogs(text) {
  return String(text || '').replace(/(gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|AIza[0-9A-Za-z_-]{30,})/g, '[REDACTED_SECRET]')
    .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .slice(-26000);
}
async function getFailedBuildContext(session, repo, runId) {
  checkRepo(repo);
  if (!/^\d+$/.test(String(runId || ''))) throw new HttpError(400, 'Invalid build run id');
  const build = await runDetail(session, repo, String(runId));
  if (build.status !== 'failed') throw new HttpError(409, 'WyBuild build diagnosis is available only after a failed build.', 'BUILD_NOT_FAILED');
  const logs = scrubBuildLogs(build.steps.map((step) => `### ${step.name} [${step.status}]\n${(step.logs || []).join('\n')}`).join('\n'));
  if (!logs.trim()) throw new HttpError(422, 'GitHub has not provided logs for this failed build yet. Refresh the build page and try again.', 'NO_BUILD_LOGS');
  return { build, logs };
}
const BUILD_REPAIR_CATALOG = [
  { id: 'npm_missing_package', re: /Cannot find module ['"]([^'"]+)['"]|Could not resolve ['"]([^'"]+)['"]|Failed to resolve import ['"]([^'"]+)['"]/i, title: 'Missing JavaScript dependency', category: 'dependency', detail: 'The build tool cannot resolve an imported package. This usually means it is absent from package.json, installed with the wrong package name, or the lockfile and manifest disagree.', suggestions: ['Identify the package name from the first “Cannot find module”, “Could not resolve”, or “Failed to resolve import” line.', 'Check package.json and confirm the package is declared under dependencies or devDependencies.', 'If the package is declared, regenerate the lockfile using the repository’s package manager and commit the matching manifest and lockfile together.', 'Re-run the build and inspect the earliest dependency-resolution error rather than later cascading errors.'], manualSteps: ['WyBuild will not guess a package version or rewrite a lockfile automatically because that can introduce incompatible dependency trees.'] },
  { id: 'npm_peer_conflict', re: /ERESOLVE|unable to resolve dependency tree|peer dependen/i, title: 'Dependency version conflict', category: 'dependency', detail: 'npm found incompatible peer-dependency requirements. The log should identify the package pair and the versions each package expects.', suggestions: ['Find the first “Could not resolve dependency” section and record both package names and version ranges.', 'Prefer upgrading or downgrading the directly conflicting package to a compatible version.', 'Use --legacy-peer-deps only as a temporary workaround after reviewing the conflict; it can install an unsupported combination.', 'Update package.json and the lockfile with the same package manager, then rebuild.'], manualSteps: ['No blind dependency downgrade was applied.'] },
  { id: 'typescript', re: /TS\d{4}:|TypeScript error|type error/i, title: 'TypeScript compilation error', category: 'source_code', detail: 'The TypeScript compiler rejected source code or its type declarations. The first TS code and file:line reference are the most useful evidence.', suggestions: ['Open the exact file and line reported by the first TS error.', 'Fix the earliest type error first; subsequent errors may be cascading failures.', 'Check whether the installed package version matches the API used by the code.', 'Run the project lint/typecheck command locally before triggering another remote build.'], manualSteps: ['The source change is not edited automatically because a safe correction depends on the intended data shape and application behavior.'] },
  { id: 'vite_memory', re: /JavaScript heap out of memory|Reached heap limit|heap out of memory/i, title: 'JavaScript build ran out of memory', category: 'configuration', detail: 'The Node.js process exceeded its available heap while bundling or type-checking.', suggestions: ['Check the runner memory limit and whether multiple build processes run simultaneously.', 'Try NODE_OPTIONS=--max-old-space-size=4096 only if the runner has enough RAM.', 'Inspect large generated files, oversized imports, and source maps that unnecessarily increase bundling memory.', 'If this is a hosted runner, split type-checking and bundling or reduce parallel jobs.'], manualSteps: ['Increasing the Node heap beyond the runner’s RAM can make the process fail sooner; confirm runner memory first.'] },
  { id: 'gradle_dependency', re: /Could not resolve all files for configuration|Could not resolve .* dependency|Could not find .*\.aar|Could not find .*\.jar/i, title: 'Gradle dependency resolution failed', category: 'android', detail: 'Gradle could not download or locate an Android dependency. The failing coordinate and repository URL distinguish a missing artifact from a temporary network issue.', suggestions: ['Locate the first “Could not resolve” line and identify the exact group:artifact:version.', 'Check that the version exists and that required Maven repositories are configured.', 'Retry once if the log indicates a timeout, TLS failure, or HTTP 5xx from a repository.', 'For Capacitor plugins, align the plugin major version with the project’s Capacitor major version.'], manualSteps: ['If a dependency was unpublished or a repository is private, the required artifact/repository access must be restored.'] },
  { id: 'gradle_sdk', re: /SDK location not found|ANDROID_HOME.*not set|ANDROID_SDK_ROOT.*not set|Failed to find target with hash string/i, title: 'Android SDK configuration missing', category: 'android', detail: 'Gradle cannot find the required Android SDK or requested platform/build tools.', suggestions: ['Check that the GitHub Actions runner installs the Android SDK platform required by compileSdk.', 'Confirm ANDROID_HOME or the runner’s SDK location is configured by the workflow.', 'Use a supported compileSdk/build-tools version available on the runner.', 'Do not commit a developer-specific local.properties path; configure the SDK in the CI workflow.'], manualSteps: ['This normally requires runner/workflow configuration rather than an application source edit.'] },
  { id: 'manifest_merge', re: /Manifest merger failed|uses-sdk:minSdkVersion .* cannot be smaller|Attribute .* is also present at/i, title: 'Android manifest merge conflict', category: 'permissions', detail: 'An Android plugin or app manifest declares conflicting permissions, SDK requirements, or attributes.', suggestions: ['Read the manifest merger report to identify the two declarations in conflict.', 'Check the plugin’s documented minimum Android SDK and align minSdkVersion if the app can support it.', 'Avoid adding tools:replace blindly; only override the exact attribute after confirming the intended value.', 'Rebuild after updating the relevant Capacitor plugin or manifest configuration.'], manualSteps: ['A manifest override was not applied automatically because it can hide a genuine security or compatibility conflict.'] },
  { id: 'signing', re: /Keystore was tampered with|keystore password was incorrect|No key with alias|SigningConfig .* is missing|WB_KEYSTORE|ANDROID_SIGNING/i, title: 'Android signing configuration problem', category: 'signing', detail: 'The release signing step could not load the keystore, password, alias, or expected signing secret.', suggestions: ['Confirm the keystore secret is valid Base64 and represents the intended .jks/.p12 file.', 'Verify the store password, key alias, and key password correspond to that keystore.', 'Check that the repository has the secrets required by the selected WyBuild signing workflow.', 'Never paste signing passwords into source code or build logs.'], manualSteps: ['Signing secrets cannot be created or corrected by code inspection. Update the repository secrets or select the correct keystore.'] },
  { id: 'firebase_config', re: /google-services\.json|No matching client found for package name|FirebaseApp is not initialized|Default FirebaseApp is not initialized/i, title: 'Firebase Android configuration mismatch', category: 'firebase', detail: 'The Firebase configuration file is missing, does not include the selected application ID, or Firebase initialization is incomplete.', suggestions: ['Download google-services.json from the correct Firebase Android app entry.', 'Confirm its package_name exactly matches the generated Android applicationId.', 'Place the file in the Android app module location expected by the build workflow; do not commit service-account private keys.', 'If using Firebase Messaging/Auth plugins, confirm the matching plugin and Google Services Gradle setup are present.'], manualSteps: ['WyBuild cannot invent a Firebase project or valid google-services.json; configure the real Firebase project.'] },
  { id: 'package_id', re: /applicationId|package name|Invalid package name|namespace .* is not a valid/i, title: 'Android package ID or namespace issue', category: 'configuration', detail: 'The Android application ID or namespace is invalid or inconsistent with the project configuration.', suggestions: ['Use a reverse-domain identifier such as app.company.product with lowercase letters, digits, and dots.', 'Ensure there are no spaces, hyphens, empty segments, or Java keywords in invalid positions.', 'Keep applicationId, Firebase package_name, and any app-link configuration aligned.', 'Rebuild and verify the resulting APK package ID before publishing.'], manualSteps: ['Changing a published app’s application ID creates a different Android app identity; confirm before changing it.'] },
  { id: 'network_timeout', re: /ETIMEDOUT|ECONNRESET|socket hang up|Read timed out|Connection timed out|Could not GET .* (502|503|504)/i, title: 'Transient network or package-server failure', category: 'network', detail: 'A network request or package repository timed out or reset. This may be transient and is not necessarily a source-code defect.', suggestions: ['Retry the same build once to determine whether the failure is transient.', 'Check the URL/host and HTTP status immediately preceding the failure.', 'If the same dependency repeatedly fails, inspect repository availability, TLS certificates, and rate limits.', 'Avoid repeatedly rebuilding in a tight loop; use bounded retries with backoff.'], manualSteps: ['No source changes are recommended unless the same endpoint consistently fails.'] },
  { id: 'vite_config', re: /vite\.config|Failed to load config|Invalid config/i, title: 'Vite configuration error', category: 'configuration', detail: 'Vite could not load or validate the project configuration.', suggestions: ['Check the exact vite.config file and the first reported stack-trace location.', 'Confirm imported Vite plugins are declared and compatible with the installed Vite major version.', 'Check whether the config uses ESM/CJS syntax inconsistent with package.json type.', 'Run the package manager’s build command after correcting the first config error.'], manualSteps: ['WyBuild will not replace the whole Vite config automatically because that can remove aliases, plugins, or environment settings.'] },
  { id: 'unknown', re: /.*/, title: 'Unclassified build failure', category: 'unknown', detail: 'No known signature confidently matched the available build logs. WyBuild will show the strongest log evidence and safe next diagnostic steps rather than inventing a root cause.', suggestions: ['Start with the earliest step marked failed and the first actual error; ignore warnings unless the build treats them as errors.', 'Inspect roughly 30–60 lines before the first fatal error to find the originating command or dependency.', 'Compare the failed commit with the last successful commit for changes to package.json, lockfiles, build scripts, and native configuration.', 'Re-run once only if the failure looks transient; repeated identical failures need a targeted code/configuration change.'], manualSteps: ['No automatic code change was made because the failure did not match a verified repair rule.'] },
];
function diagnoseLogs(logs, build) {
  const normalized = String(logs || '').replace(/\u001b\[[0-9;]*m/g, '');
  const rule = BUILD_REPAIR_CATALOG.find((item) => item.id !== 'unknown' && item.re.test(normalized)) || BUILD_REPAIR_CATALOG[BUILD_REPAIR_CATALOG.length - 1];
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const evidenceLine = lines.find((line) => /error|failed|exception|cannot find|could not resolve|timed out|denied|not found/i.test(line)) || lines[lines.length - 1] || 'No specific error line was provided.';
  const match = evidenceLine.match(/(?:Cannot find module|Could not resolve|Failed to resolve import) ['"]([^'"]+)['"]/i);
  const detail = rule.id === 'npm_missing_package' && match ? `The log names missing package “${match[1]}”. ${rule.detail}` : rule.detail;
  const canAutoFix = false; // no rule writes source unless it has a fully verified, narrow patch
  return { title: rule.title, category: rule.category, summary: detail, rootCause: `Log evidence: ${evidenceLine.slice(0, 900)}`, suggestions: rule.suggestions, canAutoFix, filesToInspect: [], manualSteps: rule.manualSteps, ruleId: rule.id, branch: build.branch, commit: build.commitHash, evidenceLines: lines.filter((line) => /error|failed|exception|cannot find|could not resolve|timed out|denied|not found/i.test(line)).slice(0, 8) };
}
async function wybuildDiagnose(session, repo, runId) {
  const { build, logs } = await getFailedBuildContext(session, repo, runId);
  const baseCharge = 2;
  const balance = await creditsFor(session.login);
  if (!isLifetimeFree(session.login) && balance.balance < baseCharge) throw new HttpError(402, `WyBuild Build Doctor costs ${baseCharge} credits; your balance is ${balance.balance}.`, 'INSUFFICIENT_CREDITS', { details: { balance: balance.balance, required: baseCharge } });
  const charged = isLifetimeFree(session.login) ? FREE_FOREVER_BALANCE : await debitCredits(session.login, baseCharge, 'wybuild_diagnosis', { repo, runId: String(runId), engine: 'rules-v1' });
  return { diagnosis: diagnoseLogs(logs, build), engine: 'WyBuild Rules Engine v1', creditsCharged: isLifetimeFree(session.login) ? 0 : baseCharge, creditsRemaining: charged, balance: { ...balance, balance: charged } };
}
async function wybuildFix(session, repo, runId, branchHint) {
  const { build, logs } = await getFailedBuildContext(session, repo, runId);
  const branch = String(branchHint || build.branch || '').slice(0, 120);
  if (!branch || branch !== build.branch) throw new HttpError(400, 'The repair branch does not match the failed build branch.', 'BRANCH_MISMATCH');
  const baseCharge = 6;
  const wallet = await creditsFor(session.login);
  if (!isLifetimeFree(session.login) && wallet.balance < baseCharge) throw new HttpError(402, `WyBuild automated repair analysis costs ${baseCharge} credits; your balance is ${wallet.balance}.`, 'INSUFFICIENT_CREDITS', { details: { balance: wallet.balance, required: baseCharge } });
  const charged = isLifetimeFree(session.login) ? FREE_FOREVER_BALANCE : await debitCredits(session.login, baseCharge, 'wybuild_repair_analysis', { repo, runId: String(runId), engine: 'rules-v1' });
  const diagnosis = diagnoseLogs(logs, build);
  return { applied: false, summary: `WyBuild inspected the failed run using its verified repair rules. ${diagnosis.title} was identified, but this rule does not have a safe, fully deterministic source patch, so no repository files were changed. Follow the specific steps below.`, fixes: [], settingsChanges: [], manualSteps: [...diagnosis.suggestions, ...(diagnosis.manualSteps || [])], diagnosis, engine: 'WyBuild Rules Engine v1', creditsCharged: isLifetimeFree(session.login) ? 0 : baseCharge, creditsRemaining: charged };
}
const API_INTEGRATIONS = {
  rest_api: { label: 'REST API client', requiredPackages: [], guidance: 'Create a typed, reusable fetch client with base URL configuration, JSON/error handling, timeout and safe response parsing. Never hardcode credentials.' },
  firebase_auth: { label: 'Firebase Authentication', requiredPackages: ['firebase'], guidance: 'Integrate Firebase web auth only when Firebase is already configured in the repository. Reuse existing firebase app initialization; do not invent project IDs or credentials. If absent, provide manual setup steps and do not fake a working integration.' },
  analytics: { label: 'Privacy-conscious analytics', requiredPackages: [], guidance: 'Add an opt-in analytics abstraction that can be connected to an existing provider. Do not send PII or add a new provider dependency without configuration.' },
  payments: { label: 'Payment provider integration', requiredPackages: [], guidance: 'Add a safe client-side checkout abstraction only; payment verification and secret keys must remain server-side. Do not mark payment successful based on client-only signals.' },
  push_notifications: { label: 'Push notifications', requiredPackages: ['@capacitor/push-notifications'], guidance: 'Connect existing supported push registration/permission flow if present. Do not claim delivery works without server/Firebase configuration; provide exact manual setup steps.' },
  native_camera: { label: 'Native camera / photo picker', requiredPackages: ['@capacitor/camera'], guidance: 'Integrate through existing Capacitor camera APIs or window.WyBuildNative when available, with browser fallback and permission/error handling.' },
  native_share: { label: 'Native share', requiredPackages: ['@capacitor/share'], guidance: 'Integrate the system share sheet via existing Capacitor Share or window.WyBuildNative, with Web Share API fallback.' },
  file_uploads: { label: 'File picker / uploads', requiredPackages: ['@capacitor/filesystem'], guidance: 'Use accessible browser file input or existing Capacitor filesystem APIs; validate file size/type and do not silently upload user files.' },
  geolocation: { label: 'Geolocation', requiredPackages: ['@capacitor/geolocation'], guidance: 'Use existing Capacitor Geolocation or browser geolocation with explicit user-triggered permission, denial handling and no background tracking.' },
  offline_cache: { label: 'Offline cache', requiredPackages: [], guidance: 'Add a conservative offline-aware data/cache layer consistent with existing app architecture; never cache auth tokens or sensitive API responses.' },
  notifications_local: { label: 'Local notifications', requiredPackages: ['@capacitor/local-notifications'], guidance: 'Use existing Capacitor Local Notifications/native bridge when available. Explain platform permissions and do not claim remote push.' },
  device_info: { label: 'Device information', requiredPackages: ['@capacitor/device'], guidance: 'Read supported device metadata without collecting unnecessary personal information.' },
  network_status: { label: 'Network status', requiredPackages: ['@capacitor/network'], guidance: 'Observe network connectivity state and changes.' },
  haptics: { label: 'Haptic feedback', requiredPackages: ['@capacitor/haptics'], guidance: 'Trigger supported native haptic feedback.' },
  clipboard: { label: 'Clipboard', requiredPackages: ['@capacitor/clipboard'], guidance: 'Read and write clipboard content only on explicit user action.' },
};
const CAPACITOR_PLUGIN_FOR_INTEGRATION = {
  native_camera: '@capacitor/camera', native_share: '@capacitor/share',
  file_uploads: '@capacitor/filesystem', geolocation: '@capacitor/geolocation',
  notifications_local: '@capacitor/local-notifications', push_notifications: '@capacitor/push-notifications', device_info: '@capacitor/device',
  network_status: '@capacitor/network', haptics: '@capacitor/haptics', clipboard: '@capacitor/clipboard',
};
function capacitorMajor(packageJson) {
  const deps = { ...(packageJson?.dependencies || {}), ...(packageJson?.devDependencies || {}) };
  const v = String(deps['@capacitor/core'] || deps['@capacitor/android'] || '');
  const m = v.match(/(?:\^|~|>=|\s|^)([567])(?:\.|$)/);
  return m ? Number(m[1]) : 0;
}
function preparePluginDependency(packageText, integrationId) {
  const plugin = CAPACITOR_PLUGIN_FOR_INTEGRATION[integrationId];
  if (!plugin || typeof packageText !== 'string') return null;
  let pkg;
  try { pkg = JSON.parse(packageText); } catch { return { error: 'The repository package.json is invalid JSON; no changes were made.' }; }
  const major = capacitorMajor(pkg);
  if (!major) return { manual: `Automatic plugin installation for ${plugin} requires a detectable Capacitor 5, 6, or 7 project. Add a compatible plugin version and rebuild manually.` };
  const existing = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  if (existing[plugin]) return null;
  // Capacitor plugins must match the app's Capacitor major to avoid Gradle/runtime incompatibility.
  pkg.dependencies = { ...(pkg.dependencies || {}), [plugin]: `^${major}.0.0` };
  return { content: JSON.stringify(pkg, null, 2) + '\n', plugin, major };
}
async function createAtomicIntegrationCommit(session, repo, branch, changes, integrationLabel) {
  // Build one Git tree and one commit, so either every accepted file lands or none does.
  // GitHub uses singular /git/ref/{ref} for GET, but plural /git/refs/{ref} for PATCH.
  const encodedBranch = branch.split('/').map(encodeURIComponent).join('/');
  const refPath = `/repos/${repo}/git/ref/heads/${encodedBranch}`;
  const updateRefPath = `/repos/${repo}/git/refs/heads/${encodedBranch}`;
  const ref = await ghJson(session, refPath, undefined, 'checking integration branch before atomic commit');
  const parentSha = ref?.object?.sha;
  if (!parentSha) throw new HttpError(409, 'Could not resolve the selected branch head. No files were changed.', 'INTEGRATION_BRANCH_UNRESOLVED');
  const parent = await ghJson(session, `/repos/${repo}/git/commits/${encodeURIComponent(parentSha)}`, undefined, 'reading integration parent commit');
  const baseTree = parent?.tree?.sha;
  if (!baseTree) throw new HttpError(502, 'GitHub did not return the branch tree. No files were changed.', 'INTEGRATION_TREE_MISSING');
  const treeEntries = [];
  const diagnoseIfDenied = async (e) => { if (e instanceof HttpError && (e.status === 403 || e.status === 404) && e.code !== 'GITHUB_RATE_LIMIT') throw await diagnoseWriteFailure(session, repo, branch, e); throw e; };
  for (const change of changes) {
    const blob = await ghJson(session, `/repos/${repo}/git/blobs`, { method: 'POST', body: JSON.stringify({ content: change.content, encoding: 'utf-8' }) }, `staging ${change.path} for atomic integration`).catch(diagnoseIfDenied);
    if (!blob?.sha) throw new HttpError(502, `GitHub did not stage ${change.path}. No branch changes were made.`, 'INTEGRATION_BLOB_FAILED');
    treeEntries.push({ path: change.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const tree = await ghJson(session, `/repos/${repo}/git/trees`, { method: 'POST', body: JSON.stringify({ base_tree: baseTree, tree: treeEntries }) }, 'creating atomic integration tree').catch(diagnoseIfDenied);
  if (!tree?.sha) throw new HttpError(502, 'GitHub could not create the integration tree. No branch changes were made.', 'INTEGRATION_TREE_FAILED');
  const commit = await ghJson(session, `/repos/${repo}/git/commits`, { method: 'POST', body: JSON.stringify({ message: `feat: integrate ${integrationLabel.toLowerCase()} via WyBuild`, tree: tree.sha, parents: [parentSha] }) }, 'creating atomic integration commit').catch(diagnoseIfDenied);
  if (!commit?.sha) throw new HttpError(502, 'GitHub could not create the integration commit. The branch was not updated.', 'INTEGRATION_COMMIT_FAILED');
  // Optimistic concurrency check before updating the branch ref.
  const latest = await ghJson(session, refPath, undefined, 'rechecking integration branch before commit');
  if (latest?.object?.sha !== parentSha) throw new HttpError(409, 'The repository branch changed during integration. No integration commit was applied; retry against the latest branch.', 'INTEGRATION_STALE');
  let update = null;
  let updateError = null;
  const patchRef = () => gh(session, updateRefPath, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha, force: false }) });
  try {
    update = await patchRef();
    // A just-created commit can briefly be invisible to the ref endpoint; retry once before blaming permissions.
    if (!update.ok && (update.status === 404 || update.status === 422)) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      update = await patchRef();
    }
  }
  catch (error) { updateError = error; }
  if (updateError || !update?.ok) {
    const data = update ? await update.json().catch(() => ({})) : {};
    // A network timeout can occur after GitHub accepted the update. Verify before refunding.
    const observed = await ghJson(session, refPath, undefined, 'verifying atomic integration commit').catch(() => null);
    if (observed?.object?.sha !== commit.sha) {
      if (!observed && updateError) throw new HttpError(503, 'GitHub’s response was lost while applying the integration. WyBuild could not verify whether the branch moved; credits were retained to avoid a double-commit/refund race. Check the branch commit history before retrying.', 'INTEGRATION_COMMIT_UNCERTAIN');
      if (update) {
        const d = describeGithubFailure(update, data, 'updating branch with atomic integration commit', `PATCH ${updateRefPath}`);
        const original = new HttpError(d.http, d.message, d.code, { hint: d.hint, details: d.details });
        // The repo and branch were readable a moment ago, so a 404/403 here is a write-permission problem: name the real cause.
        if (update.status === 403 || update.status === 404) throw await diagnoseWriteFailure(session, repo, branch, original);
        throw original;
      }
      throw new HttpError(503, 'GitHub did not confirm the integration commit. No branch update was verified.', 'INTEGRATION_COMMIT_FAILED');
    }
  }
  return changes.map((change) => ({ path: change.path, reason: change.reason || 'WyBuild deterministic integration', commit: commit.html_url || `https://github.com/${repo}/commit/${commit.sha}` }));
}
const STATIC_INTEGRATION_TEMPLATES = {
  rest_api: `/** WyBuild REST helper. Configure a public base URL at runtime; never put private API keys in browser code. */\nexport async function wybuildRequest(path: string, options: RequestInit = {}) {\n  const base = String((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\\/$/, '');\n  if (!base) throw new Error('Set VITE_API_BASE_URL to your API base URL.');\n  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);\n  try { const response = await fetch(base + '/' + String(path).replace(/^\\//, ''), { ...options, signal: controller.signal, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } }); const text = await response.text(); let data: any = null; try { data = text ? JSON.parse(text) : null; } catch { data = text; } if (!response.ok) throw new Error('API request failed (' + response.status + '): ' + (data?.message || response.statusText)); return data; } finally { clearTimeout(timer); }\n}\n`,
  analytics: `/** WyBuild privacy-first analytics queue. No events leave the device until a destination is configured and consent is granted. */\nlet analyticsConsent = false; let analyticsEndpoint = '';\nexport function configureWyBuildAnalytics(options: { endpoint?: string; consent: boolean }) { analyticsConsent = !!options.consent; analyticsEndpoint = String(options.endpoint || ''); }\nexport async function trackWyBuildEvent(name: string, properties: Record<string, string | number | boolean> = {}) { if (!analyticsConsent || !analyticsEndpoint) return { sent: false, reason: 'consent_or_endpoint_missing' }; if (!/^[a-z0-9_.-]{1,80}$/i.test(name)) throw new Error('Invalid analytics event name'); const safe = Object.fromEntries(Object.entries(properties).filter(([k,v]) => /^[a-z0-9_.-]{1,50}$/i.test(k) && (typeof v === 'string' ? v.length <= 120 : ['number','boolean'].includes(typeof v))).slice(0, 30)); const response = await fetch(analyticsEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, properties: safe, at: new Date().toISOString() }) }); if (!response.ok) throw new Error('Analytics endpoint returned HTTP ' + response.status); return { sent: true }; }\n`,
  payments: `/** WyBuild safe checkout launcher. Server must create checkout sessions and verify webhooks; this module never marks payment successful. */\nexport async function startWyBuildCheckout(sessionEndpoint: string, payload: Record<string, unknown> = {}) { if (!/^https:\\/\\//i.test(sessionEndpoint)) throw new Error('Use your HTTPS server-side checkout-session endpoint.'); const response = await fetch(sessionEndpoint, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const data = await response.json().catch(() => ({})); if (!response.ok) throw new Error(data?.message || 'Could not create checkout session (' + response.status + ')'); if (!data?.checkoutUrl || !/^https:\\/\\//i.test(data.checkoutUrl)) throw new Error('Server did not return a valid HTTPS checkoutUrl.'); window.location.assign(data.checkoutUrl); return { redirected: true }; }\n`,
  firebase_auth: `/** WyBuild Firebase Auth adapter. Pass an already-initialized Firebase Auth instance; configure Firebase in the provider console first. */\nexport async function wybuildFirebaseSignIn(auth: any, provider: any) { if (!auth || !provider) throw new Error('Provide initialized Firebase Auth and a configured provider.'); const { signInWithPopup } = await import('firebase/auth'); return signInWithPopup(auth, provider); }\nexport async function wybuildFirebaseSignOut(auth: any) { if (!auth) throw new Error('Firebase Auth instance is required.'); const { signOut } = await import('firebase/auth'); return signOut(auth); }\n`,
  native_camera: `/** WyBuild camera adapter: Capacitor native camera with browser file-picker fallback. */\nexport async function wybuildPickPhoto() { const cap = (window as any).Capacitor; if (cap?.isNativePlatform?.()) { const mod = await import('@capacitor/camera'); return mod.Camera.getPhoto({ quality: 85, allowEditing: false, resultType: mod.CameraResultType.Uri, source: mod.CameraSource.Prompt }); } return new Promise<File>((resolve, reject) => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.capture = 'environment'; input.onchange = () => input.files?.[0] ? resolve(input.files[0]) : reject(new Error('No photo selected.')); input.click(); }); }\n`,
  native_share: `/** WyBuild share adapter: native Capacitor share, then Web Share API, then clipboard fallback. */\nexport async function wybuildShare(options: { title?: string; text?: string; url?: string }) { const cap = (window as any).Capacitor; if (cap?.isNativePlatform?.()) { const mod = await import('@capacitor/share'); return mod.Share.share(options); } if (navigator.share) return navigator.share(options); const text = [options.title, options.text, options.url].filter(Boolean).join('\\n'); if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return { copied: true }; } throw new Error('Sharing is not supported by this browser.'); }\n`,
  file_uploads: `/** WyBuild file picker with size/type validation. Uploading is intentionally a separate explicit operation. */\nexport function wybuildPickFile(options: { accept?: string; maxBytes?: number } = {}): Promise<File> { return new Promise((resolve, reject) => { const input = document.createElement('input'); input.type = 'file'; input.accept = options.accept || '*/*'; input.onchange = () => { const file = input.files?.[0]; if (!file) return reject(new Error('No file selected.')); if (file.size > (options.maxBytes || 10 * 1024 * 1024)) return reject(new Error('Selected file exceeds the allowed size.')); resolve(file); }; input.click(); }); }\n`,
  geolocation: `/** WyBuild foreground geolocation helper; never requests background tracking. */\nexport async function wybuildGetLocation() { if (!('geolocation' in navigator)) throw new Error('Geolocation is not available on this device.'); return new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, (e) => reject(new Error(e.message || 'Location permission denied.')), { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 })); }\n`,
  offline_cache: `/** WyBuild small JSON cache. Do not use for access tokens, private records, or sensitive responses. */\nexport function wybuildCacheJson(key: string, value?: unknown, maxAgeMs = 3600000) { const safeKey = 'wybuild-cache:' + key; if (value !== undefined) { localStorage.setItem(safeKey, JSON.stringify({ expires: Date.now() + maxAgeMs, value })); return value; } const raw = localStorage.getItem(safeKey); if (!raw) return null; try { const item = JSON.parse(raw); if (!item || item.expires < Date.now()) { localStorage.removeItem(safeKey); return null; } return item.value; } catch { localStorage.removeItem(safeKey); return null; } }\n`,
  notifications_local: `/** WyBuild local notifications adapter for Capacitor. Requires native plugin installation and Android permission. */\nexport async function wybuildScheduleLocalNotification(title: string, body: string, at: Date = new Date(Date.now() + 60000)) { if (!(window as any).Capacitor?.isNativePlatform?.()) throw new Error('Local notifications require the native Capacitor app.'); const mod = await import('@capacitor/local-notifications'); const permission = await mod.LocalNotifications.requestPermissions(); if (permission.display !== 'granted') throw new Error('Notification permission was not granted.'); return mod.LocalNotifications.schedule({ notifications: [{ id: Math.floor(Date.now() % 2147483000), title, body, schedule: { at } }] }); }\n`,
  push_notifications: `/** WyBuild remote push registration helper. Server-side token registration and Firebase setup are required for delivery. */\nexport async function wybuildRegisterForPush() { if (!(window as any).Capacitor?.isNativePlatform?.()) throw new Error('Remote push requires a native Capacitor app.'); const mod = await import('@capacitor/push-notifications'); const permission = await mod.PushNotifications.requestPermissions(); if (permission.receive !== 'granted') throw new Error('Push permission was not granted.'); return new Promise<string>((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Push registration timed out.')), 15000); mod.PushNotifications.addListener('registration', (token) => { clearTimeout(timeout); resolve(token.value); }); mod.PushNotifications.addListener('registrationError', (e) => { clearTimeout(timeout); reject(new Error(e.error || 'Push registration failed.')); }); mod.PushNotifications.register().catch((e) => { clearTimeout(timeout); reject(e); }); }); }\n`,
  device_info: `/** WyBuild device info adapter. Avoid storing or transmitting identifiers without consent. */\nexport async function wybuildGetDeviceInfo() { if ((window as any).Capacitor?.isNativePlatform?.()) { const mod = await import('@capacitor/device'); return { ...(await mod.Device.getInfo()), ...(await mod.Device.getBatteryInfo().catch(() => ({}))) }; } return { platform: 'web', userAgent: navigator.userAgent, language: navigator.language, online: navigator.onLine }; }\n`,
  network_status: `/** WyBuild network status adapter for native and web. */\nexport async function wybuildGetNetworkStatus() { if ((window as any).Capacitor?.isNativePlatform?.()) { const mod = await import('@capacitor/network'); return mod.Network.getStatus(); } return { connected: navigator.onLine, connectionType: navigator.onLine ? 'unknown' : 'none' }; }\nexport async function wybuildOnNetworkChange(callback: (status: any) => void) { if ((window as any).Capacitor?.isNativePlatform?.()) { const mod = await import('@capacitor/network'); return mod.Network.addListener('networkStatusChange', callback); } const handler = () => callback({ connected: navigator.onLine, connectionType: navigator.onLine ? 'unknown' : 'none' }); window.addEventListener('online', handler); window.addEventListener('offline', handler); return { remove: async () => { window.removeEventListener('online', handler); window.removeEventListener('offline', handler); } }; }\n`,
  haptics: `/** WyBuild haptic feedback adapter with a web vibration fallback. */\nexport async function wybuildHaptic(style: 'light' | 'medium' | 'heavy' = 'medium') { if ((window as any).Capacitor?.isNativePlatform?.()) { const mod = await import('@capacitor/haptics'); return mod.Haptics.impact({ style: style === 'light' ? mod.ImpactStyle.Light : style === 'heavy' ? mod.ImpactStyle.Heavy : mod.ImpactStyle.Medium }); } if (navigator.vibrate) navigator.vibrate(style === 'light' ? 10 : style === 'heavy' ? 35 : 20); return { supported: !!navigator.vibrate }; }\n`,
  clipboard: `/** WyBuild clipboard adapter. Reading clipboard may require a user gesture and browser permission. */\nexport async function wybuildWriteClipboard(text: string) { if ((window as any).Capacitor?.isNativePlatform?.()) { const mod = await import('@capacitor/clipboard'); await mod.Clipboard.write({ string: text }); return; } if (!navigator.clipboard?.writeText) throw new Error('Clipboard writing is not supported in this context.'); await navigator.clipboard.writeText(text); }\nexport async function wybuildReadClipboard() { if ((window as any).Capacitor?.isNativePlatform?.()) { const mod = await import('@capacitor/clipboard'); return (await mod.Clipboard.read()).value || ''; } if (!navigator.clipboard?.readText) throw new Error('Clipboard reading is not supported or permission was denied.'); return navigator.clipboard.readText(); }\n`,
};
async function wybuildIntegrateApi(session, repo, branchHint, integrationId, userGoal = '', shell = 'standalone') {
  checkRepo(repo);
  const integration = API_INTEGRATIONS[integrationId];
  const template = STATIC_INTEGRATION_TEMPLATES[integrationId];
  if (!integration || !template) throw new HttpError(400, 'This integration does not yet have a verified deterministic WyBuild template. Choose a supported catalog integration.', 'UNSUPPORTED_DETERMINISTIC_INTEGRATION');
  const branch = String(branchHint || '').trim().slice(0, 120);
  if (!branch || !/^[A-Za-z0-9._/-]{1,120}$/.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) throw new HttpError(400, 'Choose a valid repository branch.', 'BAD_BRANCH');
  const wallet = await creditsFor(session.login); const baseCharge = 8;
  if (!isLifetimeFree(session.login) && wallet.balance < baseCharge) throw new HttpError(402, `WyBuild integration automation costs ${baseCharge} credits. Your balance is ${wallet.balance}.`, 'INSUFFICIENT_CREDITS', { details: { balance: wallet.balance, required: baseCharge } });
  const tree = await ghJson(session, `/repos/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, undefined, 'inspecting repository for deterministic integration');
  const paths = (tree.tree || []).filter((x) => x.type === 'blob').map((x) => x.path);
  const pkgEntry = (tree.tree || []).find((x) => x.type === 'blob' && x.path === 'package.json' && Number(x.size || 0) < 100000);
  const capRequired = new Set(['native_camera','native_share','notifications_local','push_notifications','device_info','network_status','haptics','clipboard']);
  if (shell === 'twa' && capRequired.has(integrationId)) throw new HttpError(400, `${integration.label} uses native Capacitor APIs and is incompatible with the Trusted Web Activity workflow. Switch to Standard / standalone or choose a web-compatible integration.`, 'INTEGRATION_WORKFLOW_INCOMPATIBLE', { details: { integrationId, shell } });
  if (integration.requiredPackages?.length && !pkgEntry) throw new HttpError(400, `${integration.label} requires a root package.json so WyBuild can declare its runtime dependency. No credits were charged and no files were changed.`, 'INTEGRATION_DEPENDENCY_MANIFEST_MISSING', { details: { integrationId } });
  let parsedPackage = null;
  if (pkgEntry) {
    const packageFile = await ghJson(session, `/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`, undefined, 'checking project compatibility');
    try { parsedPackage = JSON.parse(Buffer.from(packageFile.content || '', 'base64').toString('utf8')); } catch { throw new HttpError(422, 'The repository package.json is invalid JSON. No integration changes were committed.', 'INVALID_PACKAGE_JSON'); }
  }
  if (integrationId === 'push_notifications' && !['google-services.json','config/android/google-services.json','android/app/google-services.json'].some((file) => paths.includes(file))) throw new HttpError(400, 'Remote push requires google-services.json for the exact Android package ID. Add the Firebase Android configuration before integrating push; no credits were charged and no files were changed.', 'FEATURE_CONFIGURATION_MISSING', { details: { integrationId, reason: 'missing_firebase_config' } });
  if (capRequired.has(integrationId)) {
    const sourceInfo = sourceBuildInfo(parsedPackage);
    if (!parsedPackage || !sourceInfo.sourceBuildCandidate) throw new HttpError(400, `${integration.label} requires a confidently detectable static web source build so WyBuild can produce a Capacitor APK. This repository does not meet that requirement (${!parsedPackage ? 'missing_package_json' : sourceInfo.reason}); no credits were charged and no files were changed.`, 'INTEGRATION_WORKFLOW_INCOMPATIBLE', { details: { integrationId, reason: !parsedPackage ? 'missing_package_json' : sourceInfo.reason } });
  }
  const existingTarget = `src/wybuild-integrations/${integrationId}.ts`;
  if (paths.includes(existingTarget)) throw new HttpError(409, `WyBuild integration module ${existingTarget} already exists. Inspect it or remove it before reinstalling.`, 'INTEGRATION_ALREADY_INSTALLED');
  let changes = [{ path: existingTarget, content: template, reason: `Installed deterministic ${integration.label} helper template` }];
  let manualSteps = [];
  let requiresSecrets = ['firebase_auth','payments','push_notifications'].includes(integrationId);
  let packageContent = null, packageSha = null, pluginName = CAPACITOR_PLUGIN_FOR_INTEGRATION[integrationId];
  if (pluginName && pkgEntry) {
    const pkgFile = await ghJson(session, `/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`, undefined, 'reading package manifest for native plugin installation');
    const raw = Buffer.from(pkgFile.content || '', 'base64').toString('utf8');
    const prepared = preparePluginDependency(raw, integrationId);
    if (prepared?.error) throw new HttpError(422, prepared.error, 'INVALID_PACKAGE_JSON');
    if (prepared?.manual) manualSteps.push(prepared.manual);
    else if (prepared?.content) { packageContent = prepared.content; packageSha = pkgFile.sha; changes.unshift({ path: 'package.json', content: prepared.content, reason: `Added compatible ${pluginName} dependency` }); }
    else manualSteps.push(`${pluginName} is already declared. WyBuild did not change its version.`);
  } else if (pluginName) manualSteps.push(`No root package.json was found. WyBuild installed the source helper but could not safely add ${pluginName}; add it to the actual app package manifest and run the native sync/build.`);
  // Install declared non-Capacitor dependencies too (notably firebase for the Firebase Auth helper).
  // Never silently commit a helper with a static import whose package is absent from package.json.
  if (pkgEntry && Array.isArray(integration.requiredPackages) && integration.requiredPackages.length) {
    const pkgFile = await ghJson(session, `/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`, undefined, 'validating integration dependencies');
    let pkg;
    try { pkg = JSON.parse(packageContent || Buffer.from(pkgFile.content || '', 'base64').toString('utf8')); } catch { throw new HttpError(422, 'The repository package.json is invalid JSON; no integration changes were committed.', 'INVALID_PACKAGE_JSON'); }
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const versions = { firebase: '^11.0.0' };
    const missing = integration.requiredPackages.filter((name) => !deps[name]);
    const safelyResolvable = missing.filter((name) => versions[name]);
    for (const name of missing.filter((name) => !versions[name])) manualSteps.push(`WyBuild could not safely choose a version for required package ${name}; add a version compatible with your framework before building.`);
    if (safelyResolvable.length) {
      for (const name of safelyResolvable) pkg.dependencies = { ...(pkg.dependencies || {}), [name]: versions[name] };
      const nextPackage = JSON.stringify(pkg, null, 2) + '\n';
      const existingPackageChange = changes.find((change) => change.path === 'package.json');
      if (existingPackageChange) existingPackageChange.content = nextPackage;
      else changes.unshift({ path: 'package.json', content: nextPackage, reason: `Added required integration dependencies: ${safelyResolvable.join(', ')}` });
      packageContent = nextPackage;
      packageSha = pkgFile.sha;
    }
  }
  if (integrationId === 'firebase_auth') manualSteps.push('Initialize Firebase using the real project configuration and pass an initialized Auth instance and provider to wybuildFirebaseSignIn().');
  if (integrationId === 'payments') manualSteps.push('Create the checkout session and verify payment webhooks on your trusted server. Never trust a browser-only payment success callback.');
  if (integrationId === 'analytics') manualSteps.push('Call configureWyBuildAnalytics({ endpoint, consent: true }) only after user consent and use an endpoint you control.');
  if (integrationId === 'rest_api') manualSteps.push('Set VITE_API_BASE_URL in the build environment and call wybuildRequest(path, options) from the application. Do not place private API secrets in VITE_ variables.');
  if (integrationId === 'native_camera') manualSteps.push('Import wybuildPickPhoto from the generated module and call it from a user-triggered action. Run the Capacitor sync/build and test permissions on-device.');
  if (integrationId === 'native_share') manualSteps.push('Import wybuildShare and call it from a user-triggered action.');
  if (integrationId === 'file_uploads') manualSteps.push('Import wybuildPickFile and explicitly upload the returned File to your chosen backend if needed.');
  if (integrationId === 'geolocation') manualSteps.push('Call wybuildGetLocation only after explaining why location is needed and in response to a user action.');
  if (integrationId === 'offline_cache') manualSteps.push('Use this cache only for non-sensitive JSON; it does not synchronize offline writes to a server.');
  if (integrationId === 'notifications_local') manualSteps.push('Call wybuildScheduleLocalNotification from the app and test Android notification permission on a physical device.');
  if (integrationId === 'push_notifications') manualSteps.push('Configure the real Firebase Android app and google-services.json, then send registered tokens from a trusted backend. Token registration alone does not deliver remote notifications.');
  if (integrationId === 'device_info') manualSteps.push('Import wybuildGetDeviceInfo and request only the device fields your feature needs.');
  if (integrationId === 'network_status') manualSteps.push('Import wybuildGetNetworkStatus or wybuildOnNetworkChange and remove the listener when the screen unmounts.');
  if (integrationId === 'haptics') manualSteps.push('Import wybuildHaptic and invoke it from a user gesture; browser vibration support varies by device.');
  if (integrationId === 'clipboard') manualSteps.push('Import the clipboard helper and call it from an explicit user gesture; clipboard read access may be denied by the browser or OS.');
  if (!pkgEntry && integrationId !== 'rest_api' && integrationId !== 'analytics' && integrationId !== 'payments' && integrationId !== 'firebase_auth' && integrationId !== 'offline_cache') manualSteps.push('Repository has no root package.json; native plugin installation could not be verified.');
  const charged = isLifetimeFree(session.login) ? FREE_FOREVER_BALANCE : await debitCredits(session.login, baseCharge, 'wybuild_deterministic_integration', { repo, branch, integrationId, engine: 'templates-v1' });
  let committed = false;
  try {
    const refPath = `/repos/${repo}/git/ref/heads/${branch.split('/').map(encodeURIComponent).join('/')}`;
    const refBefore = await ghJson(session, refPath, undefined, 'checking integration branch');
    const parentSha = refBefore?.object?.sha;
    if (!parentSha) throw new HttpError(409, 'Could not resolve the branch commit before integration.', 'INTEGRATION_BRANCH_UNKNOWN');
    if (String(userGoal || '').trim()) manualSteps.push(`Additional request recorded but not auto-applied: ${String(userGoal).trim().slice(0, 300)}. WyBuild only applies the selected verified template; custom UI placement is not inferred automatically.`);
    const commitChanges = [];
    for (const change of changes) {
      if (change.path === 'package.json') {
        const current = await ghJson(session, `/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`, undefined, 'checking package manifest before integration');
        if (current.sha !== packageSha) throw new HttpError(409, 'package.json changed during integration. Retry on the latest branch.', 'INTEGRATION_STALE');
      } else if (paths.includes(change.path)) throw new HttpError(409, `Target file ${change.path} already exists.`, 'INTEGRATION_TARGET_EXISTS');
      commitChanges.push(change);
    }
    const commits = await createAtomicIntegrationCommit(session, repo, branch, commitChanges, integration.label);
    committed = true;
    return { applied: true, integration: integration.label, summary: `WyBuild installed a deterministic ${integration.label} helper module without calling an AI provider. The helper is committed atomically. It is not marked build-verified until the repository is rebuilt and tested.`, fixes: commits, manualSteps, requiresSecrets, engine: 'WyBuild Deterministic Integration Engine v1', creditsCharged: isLifetimeFree(session.login) ? 0 : baseCharge, creditsRemaining: charged, detectedCapabilities: [`Repository branch inspected (${paths.length} tracked files)`, pkgEntry ? 'Root package.json detected' : 'No root package.json detected', pluginName ? `${pluginName} ${packageContent ? 'added' : 'checked'}` : 'No native plugin dependency required'], verificationChecks: ['Confirm the new helper file is present in the commit', 'Run the project typecheck/build command', 'Import the helper from the application UI and handle its errors', 'Build the Android package and test the feature on a device'], status: manualSteps.length ? 'committed_with_setup_steps' : 'committed_unverified', buildVerified: false, verificationMessage: 'Source helper committed; rebuild and run the checklist before treating the integration as verified.' };
  } catch (e) {
    if (!committed && !isLifetimeFree(session.login) && charged > 0 && e?.code !== 'INTEGRATION_COMMIT_UNCERTAIN') await refundCredits(session.login, charged, 'wybuild_integration_failed_refund', { repo, branch, integrationId, errorCode: e?.code || 'INTEGRATION_FAILED' }).catch((refundError) => console.error('[wybuild/integrate] refund failed', { login: session.login, repo, branch, integrationId, error: String(refundError?.message || refundError) }));
    throw e;
  }
}

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
  if (!charge || String(charge.status || '').toLowerCase() !== 'succeeded') return false;
  const ref = String(charge.reference || '').trim();
  if (!ref || !/^wb-[A-Za-z0-9-]{8,42}$/i.test(ref)) return false;
  const pending = await kv.get(`wb:tx:${ref}`);
  if (!pending || pending.login !== fallbackLogin && fallbackLogin) return false;
  if (!expected || !Number.isFinite(Number(charge.amount)) || Number(charge.amount) !== Number(expected.amount) || String(charge.currency || '').toUpperCase() !== String(expected.currency || '').toUpperCase()) return false;
  const returnedCustomerId = charge.customer_id || charge.customer?.id || '';
  if (!returnedCustomerId || !pending.customerId || String(returnedCustomerId) !== String(pending.customerId)) return false;
  const pmd = charge.payment_method_details || charge.payment_method || {};
  const customerId = String(returnedCustomerId);
  const paymentMethodId = pmd.id || '';
  if (pending.paymentMethodId && paymentMethodId && String(paymentMethodId) !== String(pending.paymentMethodId)) return false;
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
    autoRenew: true,
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

async function activateCreditCharge(charge, pending, login) {
  if (!charge || String(charge.status || '').toLowerCase() !== 'succeeded') return false;
  const ref = String(charge.reference || '').trim();
  if (!pending || pending.type !== 'credits' || pending.login !== login || pending.reference !== ref) throw new HttpError(409, 'Flutterwave charge does not match a pending WyBuild credit purchase. No credits were granted.', 'CREDIT_PAYMENT_MISMATCH');
  const pack = CREDIT_PACKS[pending.pack];
  if (!pack || Number(charge.amount) !== Number(pack.amount) || String(charge.currency || '').toUpperCase() !== pack.currency) throw new HttpError(409, 'Flutterwave amount or currency does not match the selected credit pack. No credits were granted.', 'CREDIT_PAYMENT_MISMATCH');
  if (String(charge.customer_id || charge.customer?.id || '') !== String(pending.customerId || '')) throw new HttpError(409, 'Flutterwave customer does not match the pending credit purchase. No credits were granted.', 'CREDIT_PAYMENT_MISMATCH');
  const paymentDetails = charge.payment_method_details || charge.payment_method || {};
  if (pending.paymentMethodId && paymentDetails.id && String(paymentDetails.id) !== String(pending.paymentMethodId)) throw new HttpError(409, 'Flutterwave payment method does not match the pending credit purchase. No credits were granted.', 'CREDIT_PAYMENT_MISMATCH');
  const doneKey = `wb:credit-txdone:${ref}`;
  const first = await kv.set(doneKey, 1, { nx: true, ex: 60 * 60 * 24 * 365 });
  if (!first) return true;
  const lockKey = `wb:credits-lock:${login}`;
  const locked = await kv.set(lockKey, crypto.randomUUID(), { nx: true, ex: 30 });
  if (!locked) { await kv.del(doneKey).catch(() => {}); throw new HttpError(409, 'Credits are being updated. Flutterwave will retry confirmation shortly.', 'CREDITS_BUSY'); }
  try {
    const key = `wb:credits:${login}`;
    const wallet = (await kv.get(key)) || { balance: 0, createdAt: new Date().toISOString(), processedPurchases: [] };
    const processed = Array.isArray(wallet.processedPurchases) ? wallet.processedPurchases : [];
    const alreadyApplied = processed.includes(ref);
    const next = alreadyApplied ? wallet : { ...wallet, balance: Math.max(0, Number(wallet.balance || 0)) + pack.credits, processedPurchases: [...processed.slice(-999), ref], updatedAt: new Date().toISOString() };
    // The reference is stored in the same wallet document as the balance, so a retry after a partial write cannot double-credit.
    await kv.set(key, next);
    await kv.set(`wb:credit-ledger:${login}:${ref}`, { delta: alreadyApplied ? 0 : pack.credits, reason: 'credit_pack_purchase', pack: pending.pack, amount: pack.amount, currency: pack.currency, reference: ref, alreadyApplied, at: new Date().toISOString() }, { ex: 60 * 60 * 24 * 365 });
    await kv.set(`wb:credit-purchase:${ref}`, { login, pack: pending.pack, credits: pack.credits, confirmedAt: new Date().toISOString() }, { ex: 60 * 60 * 24 * 365 });
    return true;
  } catch (e) { await kv.del(doneKey).catch(() => {}); throw e; }
  finally { await kv.del(lockKey).catch(() => {}); }
}

async function createCreditCheckout(session, body, base) {
  const packId = String(body.pack || '');
  const pack = CREDIT_PACKS[packId];
  if (!pack) throw new HttpError(400, 'Choose a valid one-time credit pack.');
  const card = body.card || {};
  for (const k of ['nonce', 'encrypted_card_number', 'encrypted_expiry_month', 'encrypted_expiry_year', 'encrypted_cvv']) {
    if (!card[k] || typeof card[k] !== 'string') throw new HttpError(400, `Missing encrypted card field: ${k}`);
  }
  if (String(card.nonce).length !== 12) throw new HttpError(400, 'Invalid card encryption nonce');
  const email = session.email || `${session.login}@users.noreply.github.com`;
  let customerId = (await kv.get(`wb:cust:${session.login}`)) || '';
  if (!customerId) {
    const customer = await flw4('/customers', { method: 'POST', body: JSON.stringify({ email, name: { first: String(session.name || session.login).split(/\s+/)[0].slice(0, 60), last: String(session.name || '').split(/\s+/).slice(1).join(' ').slice(0, 60) || undefined }, meta: { wybuild_login: session.login } }) }, { idempotencyPrefix: `customer-${session.login}` });
    customerId = customer.data?.id;
    if (!customerId) throw new HttpError(502, 'Flutterwave did not return a customer id');
    await kv.set(`wb:cust:${session.login}`, customerId);
  }
  const reference = `wbc-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const method = await flw4('/payment-methods', { method: 'POST', body: JSON.stringify({ type: 'card', card: { nonce: card.nonce, encrypted_card_number: card.encrypted_card_number, encrypted_expiry_month: card.encrypted_expiry_month, encrypted_expiry_year: card.encrypted_expiry_year, encrypted_cvv: card.encrypted_cvv } }) }, { idempotencyPrefix: `credit-method-${reference}` });
  const paymentMethodId = method.data?.id;
  if (!paymentMethodId) throw new HttpError(502, 'Flutterwave did not return a payment method id');
  const pending = { type: 'credits', login: session.login, pack: packId, amount: pack.amount, currency: pack.currency, customerId, paymentMethodId, customerEmail: email, reference };
  await kv.set(`wb:tx:${reference}`, pending, { ex: 60 * 60 * 24 * 3 });
  const result = await flw4('/charges', { method: 'POST', body: JSON.stringify({ reference, amount: pack.amount, currency: pack.currency, customer_id: customerId, payment_method_id: paymentMethodId, redirect_url: `${base}/api/billing/callback`, meta: { wybuild_login: session.login, type: 'credits', pack: packId } }) }, { idempotencyPrefix: `credit-charge-${reference}` });
  const charge = result.data;
  if (!charge?.id) throw new HttpError(502, 'Flutterwave did not return a charge id');
  await kv.set(`wb:charge:${charge.id}`, { login: session.login, reference, type: 'credits' }, { ex: 60 * 60 * 24 * 3 });
  if (charge.status === 'succeeded') await activateCreditCharge(charge, pending, session.login);
  return { chargeId: charge.id, reference, status: charge.status, nextAction: charge.next_action || null, redirectUrl: charge.next_action?.redirect_url?.url || charge.redirect_url || null, pack: packId, credits: pack.credits };
}

async function reconcileCharge(chargeId, login) {
  const charge = await getCharge(chargeId);
  const ref = String(charge.reference || '');
  const pending = await kv.get(`wb:tx:${ref}`);
  if (!pending || pending.login !== login) throw new HttpError(403, 'Payment does not belong to this account');
  if (charge.status === 'succeeded') {
    if (pending.type === 'credits') await activateCreditCharge(charge, pending, login);
    else await activateFromCharge(charge, pending, login);
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

  const reference = `wb-${session.login}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`.replace(/[^A-Za-z0-9-]/g, '').slice(0, 42);
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
  }, { idempotencyPrefix: `payment-method-${reference}` });

  const paymentMethodId = paymentMethod.data?.id;
  if (!paymentMethodId) throw new HttpError(502, 'Flutterwave did not return a payment method id');
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
  // WyBuild uses one-time credits now. Stop legacy scheduled renewals and leave any already-paid access
  // available only through its original end date/grace period; never create another recurring charge.
  const logins = await kv.smembers('wb:subscribers');
  for (const login of logins || []) {
    const sub = await kv.get(`wb:sub:${login}`);
    if (sub && sub.autoRenew !== false) {
      await kv.set(`wb:sub:${login}`, { ...sub, autoRenew: false, status: sub.status === 'active' ? 'cancelled' : sub.status, graceUntil: sub.graceUntil || sub.nextBillingDate || new Date().toISOString() });
    }
    await kv.srem('wb:subscribers', login);
  }
  return 0;
}

/* --------------------------------- runs ----------------------------------- */

const ACTIVE = new Set(['queued', 'in_progress', 'waiting', 'requested', 'pending']);

function mapStatus(run) {
  if (run.status !== 'completed') return run.status === 'in_progress' ? 'running' : 'queued';
  if (run.conclusion === 'success') return 'success';
  if (run.conclusion === 'cancelled') return 'cancelled';
  return 'failed';
}

function mapRun(run, repo, workflowKind = 'twa') {
  const title = run.display_title || run.name || '';
  const t = /^WyBuild TWA (\S+)\/(\S+) on /.exec(title);
  const m = t ? null : /^WyBuild (\S+)\/(\S+)\/(\S+) on /.exec(title);
  // These API routes list/detail the WyBuild TWA workflow specifically. Do not infer
  // the workflow kind from display_title alone: GitHub often puts the commit message there.
  const isTwa = workflowKind === 'twa' || !!t;
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
    kind: isTwa ? 'twa' : 'flutter',
    target: isTwa ? ((t?.[2] || '').toLowerCase() === 'aab' ? 'appbundle' : 'apk') : m ? m[1] : 'apk',
    mode: m ? m[2] : 'release',
    flutterVersion: m ? m[3] : 'stable',
    ...(isTwa ? { twa: { packageId: t?.[1] || '', output: t?.[2] || 'apk' } } : {}),
    runnerType: 'shared-standard',
    steps: [],
    artifacts: [],
  };
}

async function refundIfNeeded(session, repo, run) {
  const lrepo = String(repo).toLowerCase();
  if ((run.triggering_actor?.login || '').toLowerCase() !== session.login.toLowerCase()) return;
  if (run.status !== 'completed') return;
  // A run WyBuild refused at its authorize step never created a run-bound reservation.
  if (await kv.get(`wb:rejected:${lrepo}:${run.id}`)) return;
  const buildCreditKey = `wb:build-credit:${lrepo}:${run.id}`;
  const buildCredit = await kv.get(buildCreditKey);
  if (buildCredit && buildCredit.status === 'reserved') {
    if (run.conclusion === 'success') {
      await kv.set(buildCreditKey, { ...buildCredit, status: 'settled', settledAt: Date.now() }, { ex: 60 * 60 * 24 * 120 });
    } else {
      const refundKey = `wb:build-credit-refunded:${lrepo}:${run.id}`;
      const claim = await kv.set(refundKey, 1, { nx: true, ex: 60 * 60 * 24 * 120 });
      if (claim) {
        try {
          await refundCredits(buildCredit.login || session.login, buildCredit.credits || 3, 'failed_build_credit_refund', { repo: lrepo, runId: String(run.id), conclusion: run.conclusion || 'failed' });
          await kv.set(buildCreditKey, { ...buildCredit, status: 'refunded', settledAt: Date.now() }, { ex: 60 * 60 * 24 * 120 });
        } catch (e) {
          await kv.del(refundKey).catch(() => {});
          throw e;
        }
      }
    }
  }
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
  // GitHub accepts up to 100 runs per page; 15 was silently hiding older pipelines.
  const runs = await workflowRuns(session, repo, TWA_WORKFLOW_FILE, 100);
  await Promise.all(runs.map((r) => refundIfNeeded(session, repo, r).catch(() => {})));
  return runs;
}

const STEP_STATUS = (s) => {
  if (s.status !== 'completed') return s.status === 'in_progress' ? 'running' : 'pending';
  if (s.conclusion === 'success') return 'success';
  if (['skipped', 'cancelled', 'neutral'].includes(s.conclusion)) return 'skipped';
  return 'failed';
};

const DIAGNOSES = [
  { re: /google-services\.json.*missing|missing.*google-services\.json|Firebase Android config.*missing|Native Google\/Apple sign-in or remote push was selected/i, category: 'firebase', title: 'Firebase Android configuration is missing', fix: 'This build selected native Google/Apple sign-in or remote push, but no google-services.json matching the exact Android package ID was found. Add the correct Firebase Android config at the repository root (or a supported config path / GOOGLE_SERVICES_JSON_BASE64 variable), enable the required Firebase provider, register the release signing SHA-1/SHA-256, and rebuild. WyBuild cannot safely invent this file or your Firebase project credentials.' },
  { re: /WyBuild could not sign this build|waiting for WyBuild to sign|WyBuild could not start signing|stopped the signing request/i, category: 'keystore', title: 'The build worked, but WyBuild could not sign it', fix: 'The release key lives on the WyBuild signing service, not in your repository. The error line above names the reason (certificate mismatch, signer not configured, or signing timeout). The WyBuild owner can see details in the signing repo run.' },
  { re: /provided androidSdk isn'?t correct|given androidSdk isn'?t correct/i, category: 'twa_config', title: 'Bubblewrap rejected the Android SDK folder', fix: 'Bubblewrap needs an Android SDK folder with a top-level bin/ or tools/ directory, which the GitHub runner does not have. Reinstall the TWA workflow (v9 builds a compatible SDK folder automatically) and rebuild.' },
  { re: /Unexpected EOF|stdin|EOF.*prompt|Is a terminal|inquirer|Cannot read.*(?:password|input)/i, category: 'twa_config', title: 'Bubblewrap asked a question and nobody could answer', fix: 'Bubblewrap needed input (usually the keystore password or "update project?"). Check WB_KEYSTORE_PASSWORD and WB_KEY_PASSWORD and re-run the updated TWA workflow.' },
  { re: /exceeded the maximum execution time|timed out|The operation was canceled|timeout.*bubblewrap|Terminated/i, category: 'twa_config', title: 'Build hung and was stopped (timeout)', fix: 'The failed step ran out of time, most often while signing. Reinstall the TWA workflow (v5 closes stdin and times out with a clear error) and verify the keystore alias/passwords.' },
  { re: /Cannot open the keystore|java\.io\.EOFException|keystore was tampered|Keystore was tampered|password was incorrect|Cannot recover key|UnrecoverableKeyException|Invalid keystore format/i, category: 'keystore', title: 'Release keystore is invalid, truncated, or credentials are wrong', fix: 'WyBuild decoded the secret but Java could not read it. Replace WB_KEYSTORE_BASE64 with the complete raw .jks/.p12 Base64, then verify the exact case-sensitive alias and store password. WyBuild now checks the decoded file before Bubblewrap.' },
  { re: /alias.*does not exist|Alias <.*> does not exist/i, category: 'keystore', title: 'Key alias not found in keystore', fix: 'The alias saved in WB_KEY_ALIAS is not in your keystore. Run keytool -list -keystore <file> locally and re-upload with the exact alias.' },
  { re: /\.github\/wybuild\/[\w.-]+ is missing|cp: cannot stat '?[^\n]*\.github\/wybuild|Cannot find module[^\n]*\.github\/wybuild/i, category: 'twa_config', title: 'Workflow helper files are missing in the repo', fix: 'Use Update workflow so .github/wybuild/twa-prepare.mjs, twa-generate.mjs, twa-verify.sh, twa-native.py, WyBuildActivity.java and WyBuildReminderReceiver.java are committed alongside the workflow.' },
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
  // Fetch the run itself as the required resource. Jobs and artifacts are independent GitHub
  // endpoints: one can be temporarily unavailable (or forbidden by a narrower token) without
  // throwing away the other data and leaving the whole Build page empty.
  const run = await ghJson(session, `/repos/${repo}/actions/runs/${id}`);
  const [jobsResult, artsResult] = await Promise.allSettled([
    ghJson(session, `/repos/${repo}/actions/runs/${id}/jobs?per_page=100`),
    ghJson(session, `/repos/${repo}/actions/runs/${id}/artifacts?per_page=100`),
  ]);
  const warnings = [];
  const jobs = jobsResult.status === 'fulfilled' && Array.isArray(jobsResult.value?.jobs)
    ? jobsResult.value : { jobs: [] };
  const arts = artsResult.status === 'fulfilled' && Array.isArray(artsResult.value?.artifacts)
    ? artsResult.value : { artifacts: [] };
  if (jobsResult.status === 'rejected') warnings.push(`GitHub pipeline jobs could not be loaded: ${jobsResult.reason?.message || 'request failed'}`);
  if (artsResult.status === 'rejected') warnings.push(`Generated artifacts could not be loaded: ${artsResult.reason?.message || 'request failed'}`);

  const build = mapRun(run, repo);
  const allJobs = jobs.jobs || [];
  if (!allJobs.length && !['queued', 'requested', 'waiting', 'pending'].includes(run.status)) {
    warnings.push('GitHub has not returned any jobs for this run. Refresh in a few seconds; if this persists, check the run in GitHub Actions.');
  }

  // A workflow can contain multiple jobs, each with its own steps and logs. Load every job;
  // the previous implementation only rendered jobs[0], hiding the rest of the pipeline.
  const jobStepGroups = await Promise.all(allJobs.map(async (job) => {
    const ghSteps = Array.isArray(job.steps) ? job.steps : [];
    let buckets = ghSteps.map(() => []);
    if (ghSteps.length && job.status !== 'queued' && job.status !== 'waiting') {
      try {
        const lr = await gh(session, `/repos/${repo}/actions/jobs/${job.id}/logs`);
        if (lr.ok) {
          const rawLogs = await lr.text();
          buckets = splitLogsIntoSteps(rawLogs, ghSteps);
          if (buckets.length && buckets.every((b) => b.length === 0) && rawLogs.trim()) {
            buckets[0] = rawLogs.split('\n').filter(Boolean).slice(-500);
          }
        } else {
          warnings.push(`Logs for job "${job.name || job.id}" are not available yet (GitHub HTTP ${lr.status}).`);
        }
      } catch (e) {
        warnings.push(`Logs for job "${job.name || job.id}" could not be loaded: ${e?.message || 'request failed'}`);
      }
    }
    return ghSteps.map((step, index) => {
      const errLine = (buckets[index] || []).filter((line) => line.startsWith('##[error]')).pop();
      const multiJob = allJobs.length > 1;
      return {
        id: `job-${job.id}-step-${step.number ?? index + 1}`,
        name: multiJob ? `${job.name || `Job ${job.id}`} · ${step.name || `Step ${index + 1}`}` : (step.name || `Step ${index + 1}`),
        status: STEP_STATUS(step),
        durationMs: step.started_at && step.completed_at ? Math.max(0, Date.parse(step.completed_at) - Date.parse(step.started_at)) : 0,
        logs: buckets[index] || [],
        ...(errLine ? { error: errLine.replace('##[error]', '') } : {}),
      };
    });
  }));
  build.steps = jobStepGroups.flat();

  if (build.status === 'failed') {
    const failedStep = build.steps.find((step) => step.status === 'failed');
    const failedText = failedStep ? failedStep.logs.join('\n') : '';
    const all = build.steps.flatMap((step) => step.logs).join('\n');
    const hit = DIAGNOSES.find((d) => d.re.test(failedText)) || (failedStep ? undefined : DIAGNOSES.find((d) => d.re.test(all)));
    if (hit || failedStep) {
      build.errorDiagnosis = {
        id: `diag-${id}`,
        title: hit ? hit.title : `Step failed: ${failedStep.name}`,
        category: hit ? hit.category : 'gradle',
        severity: 'critical',
        matchedPattern: failedStep?.error || failedStep?.name || '',
        description: `${failedStep ? `Failed at step "${failedStep.name}". ` : ''}${failedStep?.error || [...(failedStep?.logs || [])].reverse().find((line) => /error|fail|denied|not found|no such|timed? ?out/i.test(line)) || 'Open the step logs for details.'}`.slice(0, 600),
        suggestedFix: hit ? hit.fix : 'Inspect the failing step logs; re-run once fixed.',
        autoFixAvailable: false,
      };
    }
  }

  if (build.kind === 'twa') {
    const all = build.steps.flatMap((step) => step.logs).join('\n');
    const pick = (key) => ((new RegExp(`WYBUILD_${key}=(.+)`).exec(all) || [])[1] || '').trim();
    build.twa = { ...build.twa, versionName: pick('VERSION'), fingerprint: pick('FINGERPRINT') };
    if (pick('PACKAGE')) build.twa.packageId = pick('PACKAGE');
  }

  const aab = build.target === 'appbundle';
  build.artifacts = (arts.artifacts || [])
    .filter((artifact) => artifact && !artifact.expired && !/^wb-unsigned-/.test(artifact.name || '')) // never offer the throw-away-signed hand-off
    .map((artifact) => ({
      name: `${artifact.name || `artifact-${artifact.id}`}.zip`,
      type: build.kind === 'twa' ? 'bundle' : aab ? 'aab' : 'apk',
      sizeBytes: Number(artifact.size_in_bytes || 0),
      sizeFormatted: `${(Number(artifact.size_in_bytes || 0) / 1048576).toFixed(1)} MB`,
      id: artifact.id,
      downloadUrl: `/api/artifact?repo=${encodeURIComponent(repo)}&id=${artifact.id}`,
      sha256: String(artifact.digest || '').replace('sha256:', ''),
    }));
  // Remote signing: the signed files live on the signer repo; list them like any other artifact of this run.
  try {
    const rec = await kv.get(signKey(repo, id));
    if (rec) {
      build.signing = { state: rec.state, error: rec.error || undefined, fingerprint: rec.fingerprint || undefined };
      if (rec.state === 'signed' && rec.artifactId) {
        build.artifacts.push({
          name: `${rec.artifactName || `wb-signed-${id}`}.zip`, type: 'bundle', sizeBytes: 0, sizeFormatted: 'signed',
          id: rec.artifactId, downloadUrl: `/api/artifact?repo=${encodeURIComponent(repo)}&id=${rec.artifactId}`, sha256: '',
        });
      } else if (rec.state === 'failed') {
        warnings.push(`Signing failed: ${rec.error || 'unknown reason'}`);
      }
    }
  } catch { /* the build itself is still shown */ }
  build.detailWarnings = warnings;
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

  // WyBuild's configured default key is authoritative when present. Refresh all four
  // repository Actions secrets before EVERY build so new repos and existing repos receive
  // key rotations automatically. GitHub encrypts secrets in transit; values never go to the
  // browser or get committed to repository files. This intentionally replaces repo-level
  // WB_KEYSTORE_* values while the WyBuild default key is configured.
  if (st.state === 'ok') {
    await installDefaultKeystore(session, repo, st);
    return 'default';
  }
  if (hasCoreSecrets(names)) return marker ? 'default' : 'repo';
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

/* ------------------------------ remote signing ------------------------------
   The default release key never leaves WyBuild. A user's repository workflow builds the app with a throw-away key and hands
   the unsigned result to WyBuild; the private signer repo (WB_SIGNER_REPO, secrets = the release keystore) signs it with
   apksigner/jarsigner, verifies the certificate and publishes the signed files, which WyBuild then serves. */
const SIGNER_WORKFLOW = 'wybuild-sign.yml';
function signerState() {
  const repo = env('WB_SIGNER_REPO').trim(), token = env('WB_SIGNER_TOKEN'), secret = env('WB_SIGNER_SECRET');
  const missing = [['WB_SIGNER_REPO', repo], ['WB_SIGNER_TOKEN', token], ['WB_SIGNER_SECRET', secret]].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) return { ok: false, problem: `The WyBuild Vercel environment is missing ${missing.join(', ')}.` };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { ok: false, problem: 'WB_SIGNER_REPO must look like owner/name.' };
  if (secret.length < 24) return { ok: false, problem: 'WB_SIGNER_SECRET must be at least 24 characters.' };
  return { ok: true, repo };
}
function signerGh(path, init = {}) {
  return fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env('WB_SIGNER_TOKEN')}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'wybuild',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
}
// the run's short-lived GitHub token is kept encrypted and only until the signer has fetched the unsigned build
const sealKey = () => crypto.createHash('sha256').update(`wb-sign-token\0${env('SESSION_SECRET')}`).digest();
function sealText(t) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', sealKey(), iv);
  const enc = Buffer.concat([c.update(String(t), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function unsealText(b64) {
  const b = Buffer.from(String(b64), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', sealKey(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
const SIGN_TTL = 60 * 60 * 24 * 14; // signed files are kept 14 days on the signer repo
const signKey = (repo, runId) => `wb:sign:${String(repo).toLowerCase()}:${runId}`;
const signTokKey = (repo, runId) => `wb:signtok:${String(repo).toLowerCase()}:${runId}`;
const signedArtifactRef = async (artifactId) => { try { return (await kv.get(`wb:signedart:${artifactId}`)) || null; } catch { return null; } };
const cleanRunRef = (b) => {
  const repo = String(b.repo || '').toLowerCase(), runId = String(b.runId || '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(runId)) throw new HttpError(400, 'Invalid request');
  return { repo, runId };
};
function signerAuth(req) {
  const st = signerState();
  if (!st.ok) throw new HttpError(503, st.problem, 'SIGNER_NOT_CONFIGURED');
  const got = crypto.createHash('sha256').update(String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')).digest();
  const want = crypto.createHash('sha256').update(env('WB_SIGNER_SECRET')).digest();
  if (!crypto.timingSafeEqual(got, want)) throw new HttpError(401, 'Unauthorized', 'NOT_AUTHORIZED');
  return st;
}
// the run proves itself with the one-time ticket WyBuild issued for exactly this repo + run
async function ticketRunBinding(b) {
  const { repo, runId } = cleanRunRef(b);
  const ticket = String(b.ticket || '');
  if (!/^[0-9a-f]{48}$/.test(ticket)) throw new HttpError(403, 'No WyBuild ticket on this run.', 'NOT_AUTHORIZED');
  const h = ticketHash(ticket);
  const [t, used] = await Promise.all([kv.get(`wb:ticket:${h}`), kv.get(`wb:ticket-used:${h}`)]);
  if (!t || t.repo !== repo || used !== `${repo}:${runId}`) throw new HttpError(403, 'This build ticket is invalid, expired or belongs to another run.', 'NOT_AUTHORIZED');
  return { t, repo, runId };
}
const runTokenFetch = (token, path, init = {}) => fetch(`https://api.github.com${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'wybuild' },
});
async function findUnsignedArtifact(token, repo, runId) {
  const r = await runTokenFetch(token, `/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
  if (!r.ok) throw new HttpError(502, `GitHub would not list the artifacts of run ${runId} (HTTP ${r.status}).`, 'ARTIFACT_LIST');
  const art = ((await r.json()).artifacts || []).find((a) => a.name === `wb-unsigned-${runId}` && !a.expired);
  if (!art) throw new HttpError(409, 'The unsigned build artifact was not found on this run.', 'NO_UNSIGNED_ARTIFACT');
  if (art.size_in_bytes > MAX_ARTIFACT_BYTES) throw new HttpError(413, `The unsigned build is ${fmtBytes(art.size_in_bytes)}, above the ${fmtBytes(MAX_ARTIFACT_BYTES)} limit.`, 'ARTIFACT_TOO_LARGE');
  return art;
}
async function removeDefaultKeystore(session, repo) {
  for (const n of SECRET_NAMES) {
    const r = await gh(session, `/repos/${repo}/actions/secrets/${n}`, { method: 'DELETE' });
    if (!r.ok && r.status !== 404) {
      throw new HttpError(502, `Could not remove secret ${n} from ${repo} (GitHub ${r.status}).`, 'SECRET_DELETE_FAILED', { hint: `Your GitHub account needs admin access to ${repo} to remove the old signing secrets.` });
    }
  }
  await kv.del(defaultMarkerKey(repo)).catch(() => {});
}
// Decides how a build is signed. 'repo' = the owner's own key already lives in the repo's secrets (unchanged).
// 'remote' = the WyBuild default key; it stays on the signing service and is never copied into the repo.
async function prepareSigning(session, repo) {
  // All builds use the repo's Actions secrets. ensureSigning synchronizes the configured
  // WyBuild environment key into that repo on every build; no private signer service is
  // required and no signing credentials are sent to the browser or committed as files.
  await ensureSigning(session, repo);
  return 'repo';
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

/* Build tickets: every dispatch carries a one-time ticket that the workflow's first step redeems at
   /api/build/authorize. A run started by hand from the GitHub Actions tab has no valid ticket and is refused. */
const ticketHash = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
async function issueBuildTicket(session, repo, branch, signMode = 'repo', creditsReserved = 0) {
  const ticket = crypto.randomBytes(24).toString('hex');
  await kv.set(`wb:ticket:${ticketHash(ticket)}`, { login: session.login, repo: String(repo).toLowerCase(), branch, signMode, creditsReserved: Math.max(0, Number(creditsReserved) || 0), at: Date.now() }, { ex: 60 * 60 * 3 });
  return ticket;
}
async function redeemBuildTicket(b) {
  const repo = String(b.repo || '').toLowerCase();
  const runId = String(b.runId || '');
  const attempt = String(b.runAttempt || '1');
  const fail = async (msg) => {
    if (attempt === '1' && /^[\w.-]+\/[\w.-]+$/.test(repo) && /^\d+$/.test(runId)) await kv.set(`wb:rejected:${repo}:${runId}`, 1, { ex: 60 * 60 * 24 * 120 }).catch(() => {});
    throw new HttpError(403, msg, 'NOT_AUTHORIZED');
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo) || !/^\d+$/.test(runId)) throw new HttpError(400, 'Invalid request');
  const ticket = String(b.ticket || '');
  if (!/^[0-9a-f]{48}$/.test(ticket)) return fail('No WyBuild ticket on this run. Start the build from the WyBuild app.');
  if (b.event !== 'workflow_dispatch') return fail('Unsupported trigger.');
  if (attempt !== '1') return fail('Re-running a build from GitHub is not allowed. Start a new build from the WyBuild app.');
  const h = ticketHash(ticket);
  const t = await kv.get(`wb:ticket:${h}`);
  if (!t || t.repo !== repo) return fail('This build ticket is invalid or expired. Start the build from the WyBuild app.');
  const claimed = await kv.set(`wb:ticket-used:${h}`, `${repo}:${runId}`, { nx: true, ex: 60 * 60 * 24 });
  if (!claimed && (await kv.get(`wb:ticket-used:${h}`)) !== `${repo}:${runId}`) return fail('This build ticket was already used. Start a new build from the WyBuild app.');
  await kv.set(`wb:run:${repo}:${runId}`, t.login, { ex: 60 * 60 * 24 * 120 }).catch(() => {});
  if (Number(t.creditsReserved) > 0) {
    await kv.set(`wb:build-credit:${repo}:${runId}`, { login: t.login, credits: Math.max(0, Number(t.creditsReserved) || 0), status: 'reserved', at: Date.now() }, { ex: 60 * 60 * 24 * 120 });
  }
  return t;
}

// Reserves concurrent build capacity. Build runs use the connected developer's GitHub Actions quota; no subscription is required.
async function reserveBuildSlot(session, repo) {
  const { plan, usage } = await usageFor(session.login);
  const month = utcMonth();
  const pendingKey = `wb:pending:${session.login}:${month}`;
  // No monthly build cap: the 3-credit build reserve is the usage gate. Keep the
  // pending counter for dashboard accounting and the concurrency guard below.
  await kv.incr(pendingKey);
  await kv.expire(pendingKey, 60 * 60 * 24 * 370);
  const inflightKey = `wb:inflight:${session.login}`;
  const inflight = await kv.incr(inflightKey);
  await kv.expire(inflightKey, 60 * 60 * 24 * 3);
  if (inflight > plan.concurrentLimit) {
    await kv.decr(inflightKey);
    await kv.decr(pendingKey);
    throw new HttpError(429, `Concurrent build limit reached (${plan.concurrentLimit}). Wait for a running build to finish.`, 'CONCURRENCY');
  }
  await kv.del(`wb:repos:${session.login}`).catch(() => {});
  return { inflightKey, pendingKey };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
// Default Android package id for a web address. Free hosting domains (x.vercel.app ...) become app.<name>.<platform>
// (Google Play accepts app.wybuildblack.vercel, not app.vercel.wybuildblack); owned domains keep reverse-DNS (com.brand).
const HOST_PLATFORMS = ['vercel.app', 'netlify.app', 'pages.dev', 'github.io', 'web.app', 'firebaseapp.com', 'onrender.com', 'herokuapp.com', 'fly.dev', 'railway.app', 'surge.sh', 'workers.dev', 'glitch.me', 'repl.co', 'replit.app', 'azurewebsites.net', 'framer.app', 'webflow.io', 'wixsite.com', 'blogspot.com'];
function defaultPackageId(hostname) {
  const clean = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '');
  const seg = (x) => (/^[a-z]/.test(x) ? x : `a${x}`);
  const host = String(hostname || '').replace(/^www\./, '').toLowerCase();
  const plat = HOST_PLATFORMS.find((p) => host.endsWith('.' + p));
  let segs;
  if (plat) {
    const name = clean(host.slice(0, -(plat.length + 1)).split('.').join(''));
    segs = ['app', name, clean(plat.split('.')[0])];
  } else {
    segs = host.split('.').reverse().map(clean);
  }
  return segs.filter(Boolean).map(seg).join('.').slice(0, 140);
}

const PKG_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const NATIVE_OPTIN = ['biometric', 'sharetarget', 'reminders', 'googleauth', 'push', 'pulltorefresh', 'swipeback', 'shareout', 'fileaccess', 'networkstatus', 'deviceinfo', 'haptics', 'deeplinks', 'localnotifications'];
const CAPACITOR_ONLY_FEATURES = new Set(['googleauth', 'push', 'pulltorefresh', 'swipeback', 'shareout', 'fileaccess', 'networkstatus', 'deviceinfo', 'haptics', 'deeplinks', 'localnotifications']);
function sourceBuildInfo(pkg) {
  const scripts = pkg?.scripts || {};
  const buildScript = ['wybuild:build', 'build:capacitor-web', 'build:static', 'build'].find((name) => scripts[name]) || '';
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const explicitStatic = ['wybuild:build', 'build:capacitor-web', 'build:static'].includes(buildScript);
  const isNext = !!deps.next;
  const knownStaticBuilder = ['vite', 'react-scripts', 'parcel', 'astro', 'vue-cli-service', 'webpack', 'svelte'].some((name) => !!deps[name]);
  const sourceBuildCandidate = !!buildScript && !deps.expo && !deps['react-native'] && (explicitStatic || (!isNext && knownStaticBuilder));
  return { buildScript, hasBuildScript: !!buildScript, sourceBuildCandidate, reason: !buildScript ? 'missing_build_script' : (deps.expo || deps['react-native']) ? 'native_framework_not_web_static' : isNext && !explicitStatic ? 'next_requires_static_export_script' : !sourceBuildCandidate ? 'unknown_static_output' : '' };
}
async function validateNativeFeatureWorkflow(session, repo, branch, twa) {
  const selected = [...new Set(Array.isArray(twa.nativeFeatures) ? twa.nativeFeatures : [])];
  if (!selected.length) return;
  if (twa.shell === 'twa') throw new HttpError(400, `The selected Trusted Web Activity workflow cannot expose native bridge features (${selected.join(', ')}). Switch to Standard / standalone or remove those selections before building.`, 'FEATURE_WORKFLOW_INCOMPATIBLE', { details: { incompatibleFeatures: selected, shell: 'twa' } });
  const capOnly = selected.filter((f) => CAPACITOR_ONLY_FEATURES.has(f));
  if (!capOnly.length) return;
  const r = await gh(session, `/repos/${repo}/contents/package.json?ref=${encodeURIComponent(branch)}`);
  if (!r.ok) throw new HttpError(400, `These features require a buildable Capacitor source project (${capOnly.join(', ')}), but this repository has no root package.json. Add a web build script that outputs a static index.html or deselect these features.`, 'FEATURE_WORKFLOW_INCOMPATIBLE', { details: { incompatibleFeatures: capOnly, reason: 'missing_package_json' } });
  const f = await r.json(); let pkg;
  try { pkg = JSON.parse(Buffer.from(f.content || '', 'base64').toString('utf8')); } catch { throw new HttpError(422, 'The repository package.json is invalid JSON. WyBuild cannot verify native feature compatibility; no build was dispatched.', 'INVALID_PACKAGE_JSON'); }
  const sourceInfo = sourceBuildInfo(pkg);
  if (!sourceInfo.sourceBuildCandidate) throw new HttpError(400, `These features require a confidently detectable static web source build (${capOnly.join(', ')}). WyBuild cannot confirm one for this repository (${sourceInfo.reason}). Add wybuild:build / build:capacitor-web / build:static that outputs index.html, or use a supported static builder and deselect the incompatible features.`, 'FEATURE_WORKFLOW_INCOMPATIBLE', { details: { incompatibleFeatures: capOnly, reason: sourceInfo.reason } });
  if (capOnly.some((f) => ['googleauth', 'push'].includes(f))) {
    const candidates = ['google-services.json', 'config/android/google-services.json', 'android/app/google-services.json'];
    let hasFirebaseConfig = false;
    for (const file of candidates) { const check = await gh(session, `/repos/${repo}/contents/${file}?ref=${encodeURIComponent(branch)}`); if (check.ok) { hasFirebaseConfig = true; break; } }
    if (!hasFirebaseConfig) throw new HttpError(400, `Native ${capOnly.filter((f) => ['googleauth','push'].includes(f)).join(' / ')} requires google-services.json for the exact Android package ID. Add the Firebase Android configuration to the repository at a supported path before building.`, 'FEATURE_CONFIGURATION_MISSING', { details: { incompatibleFeatures: capOnly.filter((f) => ['googleauth','push'].includes(f)), reason: 'missing_firebase_config' } });
  }
}
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
  const generatedPackage = defaultPackageId(host);
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
  // App shell. "standalone" (default) runs the site in WyBuild's own native activity, so no browser address bar or
  // Chrome toolbar can ever appear and no Digital Asset Links are needed. "twa" is a plain Trusted Web Activity,
  // which shows Chrome's address bar whenever the site's assetlinks.json does not verify.
  out.shell = c.shell === 'twa' ? 'twa' : 'standalone';
  // fallbackType is only meaningful to Bubblewrap/TWA. Standalone builds never use a browser shell.
  out.fallbackType = 'customtabs';
  for (const k of ['enableNotifications', 'enableSiteSettingsShortcut', 'locationDelegation', 'playBilling', 'isChromeOSOnly', 'predictiveBack']) if (k in c) out[k] = !!c[k];
  if (c.minSdkVersion) {
    out.minSdkVersion = Number(c.minSdkVersion);
    if (!Number.isInteger(out.minSdkVersion) || out.minSdkVersion < 21 || out.minSdkVersion > 35) throw new HttpError(400, 'minSdkVersion must be between 21 and 35');
    // saved projects from before v24 still carry 21; raise it instead of failing the Gradle manifest merge
    out.minSdkVersion = Math.max(TWA_MIN_SDK, out.minSdkVersion);
  }
  out.additionalTrustedOrigins = (Array.isArray(c.additionalTrustedOrigins) ? c.additionalTrustedOrigins : []).slice(0, 20).map((o) => str(o, 200)).filter(Boolean);
  out.linkRules = cleanLinkRules(c.linkRules);
  out.nativeFeatures = [...new Set((Array.isArray(c.nativeFeatures) ? c.nativeFeatures : []).map((f) => str(f, 30)).filter((f) => NATIVE_OPTIN.includes(f)))];
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

  // 4) service worker + asset links. A manifest alone is not enough to call a site a PWA.
  const swLinks = links.filter((l) => /(^|\s)serviceworker(\s|$)/i.test(l.rel || '') && l.href).map((l) => abs(l.href));
  const swCandidates = [...new Set([
    ...swLinks,
    finalUrl.origin + '/sw.js',
    finalUrl.origin + '/service-worker.js',
    finalUrl.origin + '/serviceworker.js',
  ])].slice(0, 6);
  let serviceWorker = { present: false, url: '', source: 'none', reachable: false };
  for (const sw of swCandidates) {
    const r = await fetchOk(sw, { maxBytes: 2_000_000 });
    if (r && r.status >= 200 && r.status < 300 && /javascript|ecmascript|text\//i.test(r.contentType || '') && /(?:addEventListener|self\.|workbox|precache)/.test(r.text)) {
      serviceWorker = { present: true, url: r.finalUrl, source: swLinks.includes(sw) ? 'html' : 'conventional-path', reachable: true };
      break;
    }
  }

  let assetlinks = null;
  const al = await fetchOk(`${finalUrl.origin}/.well-known/assetlinks.json`, { json: true });
  try { assetlinks = al && al.status === 200 ? JSON.parse(al.text) : null; } catch { assetlinks = null; }

  // 5) PWA readiness: distinguish detected metadata from the minimum signals needed for a dependable install/build.
  const manifestScope = (() => { try { return manifest?.scope ? new URL(manifest.scope, base).href : new URL('./', manifestUrl || finalUrl.href).href; } catch { return ''; } })();
  const startHref = startUrl?.href || finalUrl.href;
  let scopeCoversStart = true;
  try { scopeCoversStart = new URL(startHref).origin === new URL(manifestScope).origin && new URL(startHref).pathname.startsWith(new URL(manifestScope).pathname); } catch { scopeCoversStart = false; }
  const hasName = !!String(manifest?.name || siteName).trim();
  const hasShortName = !!String(manifest?.short_name || shortName).trim();
  const hasStartUrl = !!manifest?.start_url;
  const hasScope = !!manifest?.scope || !!manifestUrl;
  const hasDisplay = ['standalone', 'fullscreen', 'minimal-ui'].includes(String(manifest?.display || '')) || Array.isArray(manifest?.display_override);
  const hasGoodIcon = !!iconUrl && iconReachable && (iconPx === 0 || iconPx >= 192);
  const pwaChecks = [
    { id: 'pwa-name', ok: hasName, msg: hasName ? 'App name detected' : 'Manifest/page has no usable app name', level: 'error' },
    { id: 'pwa-short-name', ok: hasShortName, msg: hasShortName ? 'Launcher name detected' : 'No usable short_name/launcher name detected', level: 'warn' },
    { id: 'pwa-start-url', ok: hasStartUrl, msg: hasStartUrl ? `start_url detected: ${manifest.start_url}` : 'Manifest has no start_url', level: 'error' },
    { id: 'pwa-scope', ok: hasScope && scopeCoversStart, msg: scopeCoversStart ? 'Manifest scope covers the start URL' : 'Manifest scope does not cover the start URL', level: 'error' },
    { id: 'pwa-display', ok: hasDisplay, msg: hasDisplay ? `Display mode detected: ${display}` : 'No standalone/fullscreen display mode detected', level: 'warn' },
    { id: 'pwa-icon', ok: hasGoodIcon, msg: hasGoodIcon ? `Install icon detected${iconPx ? ` (${iconPx}px)` : ''}` : 'No reachable 192px+ install icon detected', level: 'error' },
    { id: 'pwa-service-worker', ok: serviceWorker.present, msg: serviceWorker.present ? `Service worker detected at ${new URL(serviceWorker.url).pathname}` : 'No reachable service worker detected', level: 'warn' },
  ];
  const pwaReady = !!manifest && pwaChecks.filter((x) => x.level === 'error').every((x) => x.ok);

  // 6) native features the site's own code appears to use (suggestions only; the user decides)
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
  add('service-worker', serviceWorker.present || swSeen, serviceWorker.present ? `Service worker detected at ${new URL(serviceWorker.url).pathname}` : (swSeen ? 'Service-worker registration code detected, but the conventional worker URL could not be fetched' : 'No service worker found: the app needs a network connection to open'), 'warn');
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
      packageId: defaultPackageId(host),
    },
    featureHints,
    checks,
    assetlinks: assetlinks ? { present: true, packages: Array.isArray(assetlinks) ? assetlinks.map((e) => e?.target?.package_name).filter(Boolean) : [] } : { present: false, packages: [] },
    pwa: {
      ready: pwaReady,
      manifest: { url: manifestUrl || '', id: String(manifest?.id || '').slice(0, 300), scope: manifestScope ? new URL(manifestScope).pathname : '/', startUrl: manifest?.start_url ? String(manifest.start_url).slice(0, 300) : '/', display, orientation, name: String(siteName).slice(0, 50), shortName: String(shortName).slice(0, 30) },
      serviceWorker,
      icons: { primary: iconUrl, primarySize: iconPx || null, maskable: maskable ? abs(maskable.src) : '', monochrome: mono ? abs(mono.src) : '' },
      checks: pwaChecks,
    },
  };
}

/* --------------------------- Firebase push ------------------------------- */
const pushTokenKey = (login, token) => `wb:push:token:${String(login).toLowerCase()}:${crypto.createHash('sha256').update(String(token)).digest('hex')}`;
const pushTokenIndex = (login) => `wb:push:token-index:${String(login).toLowerCase()}`;
const pushRepoUsers = (repo) => `wb:push:repo-users:${String(repo).toLowerCase()}`;
async function registerPushToken(login, token, platform = 'android') {
  if (typeof token !== 'string' || token.length < 30 || token.length > 4096) throw new HttpError(400, 'Invalid Firebase registration token.', 'INVALID_PUSH_TOKEN');
  const key = pushTokenKey(login, token);
  await kv.set(key, { token, platform: String(platform).slice(0, 30), updatedAt: Date.now() });
  await kv.sadd(pushTokenIndex(login), key);
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
    const accountHint = String(query.login || '').trim().replace(/[^A-Za-z0-9-]/g, '').slice(0, 39);
    // prompt=select_account forces GitHub's account picker, so a different account can be chosen even when the
    // browser is already signed in to GitHub as someone else (without it GitHub approves the cached account instantly).
    if (accountHint) url.searchParams.set('login', accountHint);
    if (accountHint || String(query.account || '') === 'other') url.searchParams.set('prompt', 'select_account');
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
    // Flutterwave v4 signs the raw HTTP request body. Prefer a runtime-provided raw body when available;
    // string/Buffer bodies are already raw. JSON.stringify is only a compatibility fallback for runtimes
    // that eagerly parse JSON before invoking the function.
    const rawWebhookBody = Buffer.isBuffer(req.rawBody) ? req.rawBody
      : typeof req.rawBody === 'string' ? Buffer.from(req.rawBody)
      : Buffer.isBuffer(req.body) ? req.body
      : typeof req.body === 'string' ? Buffer.from(req.body)
      : Buffer.from(JSON.stringify(req.body ?? {}));
    const expectedSig = want ? crypto.createHmac('sha256', want).update(rawWebhookBody).digest('base64') : '';
    const ok = !!want && (safeEq(legacy, want) || safeEq(sig, expectedSig));
    if (!ok) throw new HttpError(401, 'Invalid signature');
    const webhook = bodyOf(req) || {};
    // Never activate from webhook fields alone. Use the webhook only as a trigger,
    // then fetch the authoritative charge from Flutterwave v4 and validate amount,
    // currency, customer/payment-method ownership, reference and succeeded status.
    const id = webhook?.data?.id || webhook?.data?.charge_id || webhook?.charge_id || null;
    const referenceHint = webhook?.data?.reference || webhook?.reference || webhook?.tx_ref || null;
    if (id || referenceHint) {
      try {
        let charge = null;
        if (id) {
          charge = await getCharge(String(id));
        } else {
          // Some webhook payloads carry the reference but not the charge id.
          // WyBuild subscriptions can resolve a stored charge ID from our own KV record.
          const pending = await kv.get(`wb:tx:${String(referenceHint)}`);
          if (pending?.flwChargeId) charge = await getCharge(String(pending.flwChargeId));
          else if (/^wycut_[A-Za-z0-9-]{8,100}$/i.test(String(referenceHint || ''))) {
            // Read-only lookup in WyCut; the returned ID is still verified directly with Flutterwave below.
            const confirmUrl = env('WYCUT_PAYMENT_CONFIRM_URL'); const sharedSecret = env('WYCUT_WEBHOOK_SHARED_SECRET');
            if (!confirmUrl || !sharedSecret || new URL(confirmUrl).protocol !== 'https:') throw new Error('WyCut confirmation failed: secure lookup endpoint/shared secret is not configured');
            const lookup = await fetch(confirmUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WyBuild-Webhook-Secret': sharedSecret }, body: JSON.stringify({ source: 'wybuild-flutterwave-v4', action: 'lookup', reference: String(referenceHint) }), signal: AbortSignal.timeout(15000) });
            const lookupData = await lookup.json().catch(() => ({}));
            if (!lookup.ok || !lookupData?.providerChargeId) throw new Error(`WyCut confirmation failed: charge-ID lookup returned HTTP ${lookup.status}`);
            charge = await getCharge(String(lookupData.providerChargeId));
          } else if (pending) {
            console.info('Flutterwave webhook received reference-only event; awaiting charge reconciliation', referenceHint);
          }
        }
        if (charge) {
          const ref = String(charge.reference || referenceHint || '').trim();
          // WyCut orders are verified by WyBuild's single Flutterwave v4 webhook.
          // Forward only authoritative fields from getCharge(); WyCut matches the reference,
          // amount, currency, transaction ID and stored order before granting credits.
          if (/^wycut_[A-Za-z0-9-]{8,100}$/i.test(ref)) {
            const confirmUrl = env('WYCUT_PAYMENT_CONFIRM_URL');
            const sharedSecret = env('WYCUT_WEBHOOK_SHARED_SECRET');
            if (!confirmUrl || !sharedSecret) {
              throw new Error('WyCut confirmation failed: WYCUT_PAYMENT_CONFIRM_URL / WYCUT_WEBHOOK_SHARED_SECRET is not configured');
            }
            if (new URL(confirmUrl).protocol !== 'https:') throw new Error('WyCut confirmation failed: WYCUT_PAYMENT_CONFIRM_URL must use HTTPS');
            const verifiedStatus = String(charge.status || '').toLowerCase();
            const terminalFailure = ['failed', 'cancelled', 'canceled', 'declined', 'expired', 'rejected'].includes(verifiedStatus);
            if (verifiedStatus !== 'succeeded' && !terminalFailure) {
              // Pending/processing charges are not settled; a later webhook must report the final status.
              console.info('WyCut Flutterwave charge is not final yet', ref, verifiedStatus);
            } else {
              const forward = await fetch(confirmUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WyBuild-Webhook-Secret': sharedSecret },
                body: JSON.stringify({
                  source: 'wybuild-flutterwave-v4',
                  id: String(charge.id || id || ''),
                  reference: ref,
                  status: verifiedStatus,
                  amount: Number(charge.amount),
                  currency: String(charge.currency || '').toUpperCase(),
                  customerEmail: String(charge.customer?.email || charge.customer_email || ''),
                }),
                signal: AbortSignal.timeout(15000),
              });
              if (!forward.ok) throw new Error(`WyCut confirmation endpoint returned HTTP ${forward.status}`);
            }
          } else if (/^KIVORA-[A-Za-z0-9-]+$/i.test(ref)) {
            if (String(charge.status || '').toLowerCase() !== 'succeeded') {
              console.info('Kivora Flutterwave charge is not succeeded yet', ref, String(charge.status || ''));
            } else {
              const confirmUrl = env('KIVORA_PAYMENT_CONFIRM_URL');
              const sharedSecret = env('KIVORA_WEBHOOK_SHARED_SECRET');
              if (!confirmUrl || !sharedSecret) {
                throw new Error('Kivora confirmation failed: KIVORA_PAYMENT_CONFIRM_URL / KIVORA_WEBHOOK_SHARED_SECRET is not configured');
              }
              if (new URL(confirmUrl).protocol !== 'https:') throw new Error('Kivora confirmation failed: KIVORA_PAYMENT_CONFIRM_URL must use HTTPS');
              const forward = await fetch(confirmUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-WyBuild-Webhook-Secret': sharedSecret },
                body: JSON.stringify({
                  source: 'wybuild-flutterwave-v4',
                  id: String(charge.id || id || ''),
                  reference: ref,
                  status: String(charge.status || '').toLowerCase(),
                  amount: Number(charge.amount),
                  currency: String(charge.currency || '').toUpperCase(),
                }),
                signal: AbortSignal.timeout(15000),
              });
              if (!forward.ok) throw new Error(`Kivora confirmation endpoint returned HTTP ${forward.status}`);
            }
          } else {
            if (String(charge.status || '').toLowerCase() === 'succeeded') {
              const pending = await kv.get(`wb:tx:${ref}`);
              if (pending) { if (pending.type === 'credits') await activateCreditCharge(charge, pending, pending.login); else await activateFromCharge(charge, pending, pending.login); }
            } else {
              console.info('WyBuild subscription charge is not succeeded yet', ref, String(charge.status || ''));
            }
          }
        }
      } catch (e) {
        console.error('Flutterwave webhook reconciliation failed', e);
        // Any authoritative lookup or downstream persistence failure must be retryable.
        // Returning 200 here would permanently lose a successful payment when a network
        // timeout or downstream 5xx occurs, even if the error text is unexpected.
        return send(res, 500, { error: 'Flutterwave webhook reconciliation failed; retry delivery.' });
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
          const owner = await kv.get(`wb:charge:${chargeId}`);
          result = state.status === 'succeeded' ? (owner?.type === 'credits' ? 'credits-success' : 'success') : state.status === 'pending' ? 'pending' : 'failed';
        }
      } else if (ref) {
        const pending = await kv.get(`wb:tx:${ref}`);
        if (pending) {
          if (pending.type === 'credits') {
            const purchased = await kv.get(`wb:credit-purchase:${String(ref)}`);
            result = purchased ? 'credits-success' : 'pending';
          } else { const sub = await getSubscription(pending.login); result = sub ? 'success' : 'pending'; }
        }
      }
    } catch {
      result = 'failed';
    }
    if (result === 'credits-success') return redirect(res, `${appUrl(req)}/?credits=success`);
    if (result === 'pending' && ref && (await kv.get(`wb:tx:${ref}`))?.type === 'credits') return redirect(res, `${appUrl(req)}/?credits=pending`);
    return redirect(res, `${appUrl(req)}/?billing=${result}`);
  }

  if (path === 'billing/renew' && m === 'GET') {
    const given = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const cron = env('CRON_SECRET');
    if (!cron || given !== cron) throw new HttpError(401, 'Unauthorized');
    const processed = await renewDueSubscriptions();
    return send(res, 200, { ok: true, processed });
  }

  /* called by the installed workflow's first step; authenticated by the one-time ticket, not a session */
  if (path === 'build/authorize' && post) {
    await redeemBuildTicket(bodyOf(req));
    return send(res, 200, { ok: true });
  }

  /* ---- remote signing (runner -> WyBuild, signer -> WyBuild). No session: proven by ticket or signer secret ---- */
  if (path === 'build/complete' && post) {
    const b = bodyOf(req);
    const { t, repo, runId } = await ticketRunBinding(b);
    if (t.signMode !== 'remote') throw new HttpError(403, 'This build was not started for remote signing.', 'NOT_AUTHORIZED');
    if (String(b.runAttempt || '1') !== '1') throw new HttpError(403, 'Re-running a build from GitHub is not allowed.', 'NOT_AUTHORIZED');
    const sg = signerState();
    if (!sg.ok) throw new HttpError(503, `Secure signing is not configured. ${sg.problem}`, 'SIGNER_NOT_CONFIGURED');
    const key = signKey(repo, runId);
    const existing = await kv.get(key);
    if (existing) return send(res, 200, { ok: true, state: existing.state }); // runner retry: never sign twice
    const token = String(b.token || '');
    if (!/^[A-Za-z0-9_.\-]{20,600}$/.test(token)) throw new HttpError(400, 'Invalid run token');
    // confirm with GitHub, using the run's own token, that this really is a WyBuild build started from the app
    const rr = await runTokenFetch(token, `/repos/${repo}/actions/runs/${runId}`);
    if (!rr.ok) throw new HttpError(403, `GitHub did not confirm this run (HTTP ${rr.status}).`, 'NOT_AUTHORIZED');
    const run = await rr.json();
    const okRun = String(run.id) === runId && String(run.repository?.full_name || '').toLowerCase() === repo && run.event === 'workflow_dispatch'
      && Number(run.run_attempt || 1) === 1 && run.status === 'in_progress' && String(run.path || '').startsWith(TWA_WORKFLOW_PATH);
    if (!okRun) throw new HttpError(403, 'This run is not an in-progress WyBuild build started from the WyBuild app.', 'NOT_AUTHORIZED');
    await findUnsignedArtifact(token, repo, runId);
    const claimed = await kv.set(key, { state: 'queued', login: t.login, requestedAt: Date.now() }, { nx: true, ex: 60 * 60 * 24 * 120 });
    if (!claimed) return send(res, 200, { ok: true, state: 'queued' });
    await kv.set(signTokKey(repo, runId), sealText(token), { ex: 60 * 40 });
    const d = await signerGh(`/repos/${sg.repo}/actions/workflows/${SIGNER_WORKFLOW}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({ ref: env('WB_SIGNER_REF') || 'main', inputs: { repo, run_id: runId } }),
    });
    if (d.status !== 204) {
      const msg = `Could not start the WyBuild signing service (GitHub ${d.status}). Check WB_SIGNER_TOKEN, WB_SIGNER_REPO and that ${SIGNER_WORKFLOW} exists on its default branch.`;
      await kv.set(key, { state: 'failed', login: t.login, error: msg }, { ex: SIGN_TTL });
      await kv.del(signTokKey(repo, runId)).catch(() => {});
      throw new HttpError(502, msg, 'SIGNER_DISPATCH_FAILED');
    }
    return send(res, 200, { ok: true, state: 'queued' });
  }

  if (path === 'build/sign-status' && post) {
    const { repo, runId } = await ticketRunBinding(bodyOf(req));
    const rec = await kv.get(signKey(repo, runId));
    return send(res, 200, rec ? { state: rec.state, error: rec.error, fingerprint: rec.fingerprint } : { state: 'waiting' });
  }

  if (path === 'sign/fetch' && post) {
    signerAuth(req);
    const { repo, runId } = cleanRunRef(bodyOf(req));
    const key = signKey(repo, runId);
    const rec = await kv.get(key);
    if (!rec || !['queued', 'signing'].includes(rec.state)) throw new HttpError(409, 'There is no pending signing request for this run.', 'NO_REQUEST');
    const sealed = await kv.get(signTokKey(repo, runId));
    if (!sealed) throw new HttpError(410, 'The build run has ended; its access expired before signing started.', 'RUN_TOKEN_EXPIRED');
    const token = unsealText(sealed);
    const art = await findUnsignedArtifact(token, repo, runId);
    const z = await runTokenFetch(token, `/repos/${repo}/actions/artifacts/${art.id}/zip`, { redirect: 'manual' });
    const loc = z.headers.get('location');
    if (!loc) throw new HttpError(502, `GitHub gave no download for the unsigned build (HTTP ${z.status}).`, 'ARTIFACT_DOWNLOAD');
    await kv.set(key, { ...rec, state: 'signing', startedAt: Date.now() }, { ex: 60 * 60 * 24 * 120 });
    return send(res, 200, { ok: true, downloadUrl: loc }); // pre-signed storage URL, valid for about a minute
  }

  if (path === 'sign/done' && post) {
    const sg = signerAuth(req);
    const b = bodyOf(req);
    const { repo, runId } = cleanRunRef(b);
    const key = signKey(repo, runId);
    const rec = await kv.get(key);
    if (!rec) throw new HttpError(409, 'There is no signing request for this run.', 'NO_REQUEST');
    if (b.ok === true) {
      const artifactId = String(b.artifactId || ''), name = String(b.artifactName || '');
      if (!/^\d+$/.test(artifactId) || !/^wb-signed-[\w.-]+$/.test(name)) throw new HttpError(400, 'Invalid signed artifact');
      const mr = await signerGh(`/repos/${sg.repo}/actions/artifacts/${artifactId}`);
      const meta = mr.ok ? await mr.json() : null;
      if (!meta || meta.name !== name || meta.expired) throw new HttpError(409, 'The signed artifact is not on the signing repository.', 'NO_SIGNED_ARTIFACT');
      await kv.set(key, { ...rec, state: 'signed', artifactId: Number(artifactId), artifactName: name, fingerprint: String(b.fingerprint || '').slice(0, 120), signedAt: Date.now() }, { ex: SIGN_TTL });
      await kv.set(`wb:signedart:${artifactId}`, { repo, runId }, { ex: SIGN_TTL });
    } else {
      await kv.set(key, { ...rec, state: 'failed', error: String(b.error || 'Signing failed.').slice(0, 600) }, { ex: SIGN_TTL });
    }
    await kv.del(signTokKey(repo, runId)).catch(() => {});
    return send(res, 200, { ok: true });
  }

  /* everything below needs a session */
  const session = requireSession(req);

  if (path === 'push/register' && post) {
    const b = bodyOf(req);
    await registerPushToken(session.login, b.token, b.platform || 'android');
    // Register only repositories visible to this authenticated GitHub account.
    const repos = Array.isArray(b.repos) ? b.repos.slice(0, 100) : [];
    for (const rawRepo of repos) {
      if (typeof rawRepo !== 'string' || !REPO_RE.test(rawRepo)) continue;
      await kv.sadd(pushRepoUsers(rawRepo), session.login);
    }
    return send(res, 200, { ok: true });
  }

  if (path === 'push/unregister' && post) {
    const b = bodyOf(req);
    const token = String(b.token || '');
    if (token) {
      const key = pushTokenKey(session.login, token);
      await kv.del(key).catch(() => {});
      await kv.srem(pushTokenIndex(session.login), key).catch(() => {});
    } else {
      const keys = await kv.smembers(pushTokenIndex(session.login)).catch(() => []);
      await Promise.all(keys.map((key) => kv.del(key).catch(() => {})));
      await kv.del(pushTokenIndex(session.login)).catch(() => {});
    }
    return send(res, 200, { ok: true });
  }

  if (path === 'credits/balance' && m === 'GET') {
    return send(res, 200, { wallet: await creditsFor(session.login), packs: CREDIT_PACKS, currency: 'USD', engine: 'WyBuild Deterministic Automation Engine v1', freeForever: isLifetimeFree(session.login) });
  }

  if (path === 'credits/action' && post) {
    const b = bodyOf(req);
    const action = String(b.action || '');
    const operationId = String(b.operationId || '');
    const prices = {
      package_id_edit: 2,
      version_edit: 2,
      fullscreen: 2,
      'fullscreen-sticky': 2,
      pulltorefresh: 2,
      swipeback: 2,
      predictive_back: 1,
      vibration: 1,
      biometric: 3,
      reminders: 2,
      push: 3,
      googleauth: 3,
      sharetarget: 1,
      orientation: 1,
      statusbar: 1,
      native_downloads: 2,
      native_camera: 2,
      native_location: 2,
    };
    if (!Object.prototype.hasOwnProperty.call(prices, action)) throw new HttpError(400, 'Unknown paid action.', 'INVALID_CREDIT_ACTION');
    if (!/^[a-zA-Z0-9_-]{12,100}$/.test(operationId)) throw new HttpError(400, 'A valid action operation ID is required.', 'INVALID_OPERATION_ID');
    if (isLifetimeFree(session.login)) return send(res, 200, { ok: true, charged: 0, balance: FREE_FOREVER_BALANCE, freeForever: true });
    const doneKey = `wb:credit-action:${session.login}:${operationId}`;
    const previous = await kv.get(doneKey);
    if (previous) return send(res, 200, { ok: true, charged: 0, balance: (await creditsFor(session.login)).balance, duplicate: true });
    const claimKey = `${doneKey}:claim`;
    const claimed = await kv.set(claimKey, '1', { nx: true, ex: 60 });
    if (!claimed) {
      const completed = await kv.get(doneKey);
      if (completed) return send(res, 200, { ok: true, charged: 0, balance: (await creditsFor(session.login)).balance, duplicate: true });
      throw new HttpError(409, 'This credit action is already being processed. Retry shortly.', 'CREDITS_BUSY');
    }
    const cost = prices[action];
    try {
      const balance = await creditsFor(session.login);
      if (balance.balance < cost) throw new HttpError(402, `This action costs ${cost} credits; your balance is ${balance.balance}. Buy a one-time credit pack to continue.`, 'INSUFFICIENT_CREDITS', { details: { balance: balance.balance, required: cost, action } });
      const updated = await debitCredits(session.login, cost, 'paid_native_action', { action, operationId });
      await kv.set(doneKey, { action, cost, at: new Date().toISOString() }, { ex: 60 * 60 * 24 * 365 });
      return send(res, 200, { ok: true, charged: cost, balance: updated });
    } catch (e) {
      await kv.del(claimKey).catch(() => {});
      throw e;
    }
  }

  if (path === 'automation/diagnose' && post) {
    const b = bodyOf(req);
    const r = await wybuildDiagnose(session, checkRepo(b.repo), String(b.runId || ''));
    return send(res, 200, isLifetimeFree(session.login) ? { ...r, creditsCharged: 0, creditsRemaining: FREE_FOREVER_BALANCE, freeForever: true } : r);
  }

  if (path === 'automation/fix' && post) {
    const b = bodyOf(req);
    const r = await wybuildFix(session, checkRepo(b.repo), String(b.runId || ''), String(b.branch || ''));
    return send(res, 200, isLifetimeFree(session.login) ? { ...r, creditsCharged: 0, creditsRemaining: FREE_FOREVER_BALANCE, freeForever: true } : r);
  }

  if (path === 'automation/integrate-api' && post) {
    const b = bodyOf(req);
    const r = await wybuildIntegrateApi(session, checkRepo(b.repo), String(b.branch || ''), String(b.integrationId || ''), String(b.goal || ''), b.shell === 'twa' ? 'twa' : 'standalone');
    return send(res, 200, isLifetimeFree(session.login) ? { ...r, creditsCharged: 0, creditsRemaining: FREE_FOREVER_BALANCE, freeForever: true } : r);
  }

  if (path === 'billing/config' && m === 'GET') {
    return send(res, 200, publicBillingConfig());
  }

  if (path === 'billing/checkout' && post) {
    const checkoutBody = bodyOf(req);
    if (checkoutBody.pack) return send(res, 200, await createCreditCheckout(session, checkoutBody, appUrl(req)));
    if (isLifetimeFree(session.login)) {
      throw new HttpError(403, 'This GitHub account has WyBuild Free Forever access and does not need subscription billing.', 'FREE_FOREVER');
    }
    throw new HttpError(410, 'Recurring subscriptions have been retired. Choose a one-time credit pack instead.', 'SUBSCRIPTIONS_RETIRED');
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
    }, { idempotencyPrefix: `authorize-${chargeId}-${b.type}-${crypto.randomUUID()}` });
    const d = result.data;
    if (d?.status === 'succeeded') {
      const pending = await kv.get(`wb:tx:${owner.reference}`);
      if (pending) { if (pending.type === 'credits') await activateCreditCharge(d, pending, session.login); else await activateFromCharge(d, pending, session.login); }
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
    const existingGrace = new Date(sub.graceUntil || 0).getTime();
    const activeUntil = sub.status === 'cancelled' && existingGrace > Date.now()
      ? new Date(existingGrace)
      : new Date(Date.now() + CANCELLATION_GRACE_MS);
    const cancelled = {
      ...sub,
      status: 'cancelled',
      autoRenew: false,
      cancelledAt: sub.cancelledAt || new Date().toISOString(),
      graceUntil: activeUntil.toISOString(),
    };
    await kv.set(`wb:sub:${session.login}`, cancelled);
    await kv.srem('wb:subscribers', session.login);
    return send(res, 200, { ok: true, activeUntil: cancelled.graceUntil, status: 'cancelled' });
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
    return send(res, 200, { user: { login: session.login, name: session.name, avatar: session.avatar, email: session.email }, subscription: sub, usage, lifetimeFree: isLifetimeFree(session.login), pricing: PRICING, pricingNgn: PRICING_NGN, defaultKeystore: !!defaultKeystore(), defaultKeystoreProblem: defaultKeystoreState().problem || undefined, signerProblem: defaultKeystoreState().state === 'ok' ? (signerState().problem || undefined) : undefined });
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
    const MANIFEST_PATHS = ['public/manifest.webmanifest', 'public/manifest.json', 'manifest.webmanifest', 'manifest.json', 'site.webmanifest', 'static/manifest.json', 'src/manifest.json', 'docs/manifest.json'];
    const SW_PATHS = ['public/sw.js', 'public/service-worker.js', 'sw.js', 'service-worker.js', 'src/sw.js', 'src/service-worker.js', 'static/sw.js', 'docs/sw.js'];
    const CNAME_PATHS = ['CNAME', 'public/CNAME', 'docs/CNAME', 'static/CNAME'];
    const [packageJson, gradle, manifest, twaWf, latest, signing, repoManifestFiles, cnameFiles, repoSwFiles] = await Promise.all([
      readFile('package.json'), readFile('android/app/build.gradle'),
      readFile('android/app/src/main/AndroidManifest.xml'), readFile(WORKFLOW_KINDS.twa.path),
      ghJson(session, `/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&per_page=1`).catch(() => []),
      signingStatus(session, repo),
      Promise.all(MANIFEST_PATHS.map((f) => readFile(f).catch(() => ''))),
      Promise.all(CNAME_PATHS.map((f) => readFile(f).catch(() => ''))),
      Promise.all(SW_PATHS.map((f) => readFile(f).catch(() => ''))),
    ]);
    let framework = 'unknown';
    let nativeBuild = { hasPackageJson: !!packageJson, hasBuildScript: false, buildScript: '', capacitorDeclared: false, capacitorMajor: 0, firebaseConfigFound: false, sourceBuildCandidate: false, sourceBuildReason: 'missing_build_script' };
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        framework = deps.expo ? 'expo' : deps['react-native'] ? 'react-native' : 'web';
        const sourceInfo = sourceBuildInfo(pkg);
        nativeBuild.buildScript = sourceInfo.buildScript;
        nativeBuild.hasBuildScript = sourceInfo.hasBuildScript;
        nativeBuild.capacitorDeclared = !!(deps['@capacitor/core'] || deps['@capacitor/android']);
        const cap = String(deps['@capacitor/core'] || deps['@capacitor/android'] || '').match(/(?:\^|~|>=|\s|^)([0-9]+)(?:\.|$)/);
        nativeBuild.capacitorMajor = cap ? Number(cap[1]) : 0;
        nativeBuild.sourceBuildCandidate = sourceInfo.sourceBuildCandidate;
        nativeBuild.sourceBuildReason = sourceInfo.reason;
      } catch { framework = 'web'; }
    }
    for (const file of ['google-services.json', 'config/android/google-services.json', 'android/app/google-services.json']) {
      const probe = await gh(session, `/repos/${repo}/contents/${file}?ref=${encodeURIComponent(branch)}`).catch(() => null);
      if (probe?.ok) { nativeBuild.firebaseConfigFound = true; break; }
    }
    const packageId = /applicationId\s+["']([^"']+)/.exec(gradle)?.[1] || /package="([^"]+)"/.exec(manifest)?.[1] || undefined;
    const twaVersionOk = Number((/wybuild-twa-workflow-version:\s*(\d+)/.exec(twaWf) || [])[1] || 0) >= TWA_WORKFLOW_VERSION;
    const twaStale = twaWf && twaVersionOk ? await twaStaleFiles(session, repo, branch, req).catch(() => []) : [];
    const workflows = { twa: { installed: !!twaWf, upToDate: twaVersionOk && twaStale.length === 0 } };
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
          manifestUrl: MANIFEST_PATHS[i],
          id: typeof j.id === 'string' ? j.id.slice(0, 300) : '',
          scope: typeof j.scope === 'string' && j.scope.startsWith('/') ? j.scope.slice(0, 300) : '',
          iconCount: Array.isArray(j.icons) ? j.icons.length : 0,
          hasMaskableIcon: Array.isArray(j.icons) && j.icons.some((x) => /maskable/i.test(String(x?.purpose || ''))),
          hasMonochromeIcon: Array.isArray(j.icons) && j.icons.some((x) => /monochrome/i.test(String(x?.purpose || ''))),
        };
      } catch { /* not a manifest */ }
    }
    if (!repoWeb && (pkgMeta.name || info.description)) repoWeb = { source: 'package.json', name: String(pkgMeta.displayName || info.description || '').slice(0, 50), launcherName: '', themeColor: '', backgroundColor: '', display: '', orientation: '', startUrl: '', manifestUrl: '', id: '', scope: '', iconCount: 0, hasMaskableIcon: false, hasMonochromeIcon: false };
    const repoServiceWorker = SW_PATHS.find((_, i) => String(repoSwFiles[i] || '').trim());
    const pwaSource = repoWeb ? { ...repoWeb, serviceWorker: repoServiceWorker || '' } : (repoServiceWorker ? { source: repoServiceWorker, name: '', launcherName: '', themeColor: '', backgroundColor: '', display: '', orientation: '', startUrl: '', manifestUrl: '', id: '', scope: '', iconCount: 0, hasMaskableIcon: false, hasMonochromeIcon: false, serviceWorker: repoServiceWorker } : undefined);
    if (!homepage && info.has_pages) homepage = /\.github\.io$/i.test(info.name) ? `https://${info.name.toLowerCase()}/` : `https://${info.owner.login.toLowerCase()}.github.io/${info.name}/`;
    return send(res, 200, {
      repo, name: info.name, defaultBranch: branch, framework, flutterVersion: 'n/a', packageId, latestCommitSha, nativeBuild,
      workflowInstalled: workflows.twa.installed, workflowUpToDate: workflows.twa.upToDate, workflows,
      signing, signingProblem: signing === 'none' ? (defaultKeystoreState().problem || undefined) : undefined, homepage: homepage.startsWith('https://') ? homepage : '',
      canPush: !!info.permissions?.push, private: !!info.private, web: pwaSource, pwa: { manifestFound: !!repoWeb && repoWeb.source !== 'package.json', manifestPath: repoWeb?.manifestUrl || '', serviceWorkerFound: !!repoServiceWorker, serviceWorkerPath: repoServiceWorker || '', maskableIcon: !!repoWeb?.hasMaskableIcon, monochromeIcon: !!repoWeb?.hasMonochromeIcon }, homepageFrom: info.homepage ? 'github' : homepage ? 'repo' : '',
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
    const stale = v >= k.version ? await twaStaleFiles(session, repo, query.branch || (await ghJson(session, `/repos/${repo}`)).default_branch, req) : ['version'];
    return send(res, 200, { installed: true, upToDate: stale.length === 0 });
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
      let content = fs.readFileSync(new URL(`../workflow/${localPath}`, import.meta.url), 'utf8');
      if (repoPath === k.path) content = content.replaceAll('__WYBUILD_APP_URL__', appUrl(req));
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
    try { await prepareSigning(session, repo); signing = await signingStatus(session, repo); } catch { /* reported at build time with a precise reason */ }
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

  // WyBuild can publish its own Digital Asset Links document when its production
  // Android signing identity is configured. Never emit a fake fingerprint.
  if (path === 'self-assetlinks' && m === 'GET') {
    const packageId = String(env('WYBUILD_ANDROID_PACKAGE_ID') || '').trim();
    const rawFingerprints = String(env('WYBUILD_ANDROID_SHA256') || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const playFingerprints = String(env('WYBUILD_PLAY_SIGNING_SHA256') || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    const fingerprints = [...new Set([...rawFingerprints, ...playFingerprints])].map((x) => x.toUpperCase().replace(/-/g, ':'));
    if (!packageId || !fingerprints.length || fingerprints.some((x) => !/^([0-9A-F]{2}:?){32}$/.test(x))) {
      return send(res, 503, { error: 'WyBuild Digital Asset Links is not configured. Set WYBUILD_ANDROID_PACKAGE_ID and valid WYBUILD_ANDROID_SHA256 (SHA-256 fingerprints).', code: 'ASSETLINKS_NOT_CONFIGURED' });
    }
    return send(res, 200, fingerprints.map((sha256_cert_fingerprints) => ({
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: packageId, sha256_cert_fingerprints: [sha256_cert_fingerprints] },
    })));
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
    await kv.sadd(pushRepoUsers(repo), session.login).catch(() => {});
    const branch = String(b.branch || '').slice(0, 200);
    if (!branch) throw new HttpError(400, 'Branch is required');
    const output = ['apk', 'aab', 'both'].includes(b.output) ? b.output : 'both';
    const twa = cleanTwaConfig(b.twa);
    await validateNativeFeatureWorkflow(session, repo, branch, twa);
    const useKeystore = b.useKeystore !== false;
    const storeReady = b.storeReady !== false;
    if (storeReady && !useKeystore) throw new HttpError(400, 'Store-ready builds must be signed with your own release keystore');

    const wf = await gh(session, `/repos/${repo}/contents/${TWA_WORKFLOW_PATH}?ref=${encodeURIComponent(branch)}`);
    if (wf.status === 404) throw new HttpError(409, `The WyBuild TWA workflow (${TWA_WORKFLOW_PATH}) is not on branch "${branch}" of ${repo}.`, 'NO_WORKFLOW', { hint: 'Open Web to Android, pick this repo and use Update workflow to install it.' });
    {
      // Same freshness test the Web to Android page uses: every WyBuild file must match this deployment
      const stale = await twaStaleFiles(session, repo, branch, req);
      if (stale.length) throw new HttpError(409, `The WyBuild TWA workflow in ${repo} is outdated (${stale.map((x) => x.split('/').pop()).join(', ')} differ from v${TWA_WORKFLOW_VERSION}).`, 'WORKFLOW_OUTDATED', { hint: 'WyBuild reinstalls it automatically; if you see this, press Build again.', details: { stale } });
    }
    const signMode = await prepareSigning(session, repo); // Sync WyBuild's environment signing secrets before every build

    const BUILD_CREDITS = 5; // successful Web-to-Android builds cost five credits; failed/dispatch-failed builds are refunded
    // Reserve credits before dispatch so concurrent builds cannot spend the same balance.
    await debitCredits(session.login, BUILD_CREDITS, 'build_reserved', { repo, branch, output });
    let reservation;
    let wbTicket;
    try {
      reservation = await reserveBuildSlot(session, repo);
      wbTicket = await issueBuildTicket(session, repo, branch, signMode, BUILD_CREDITS);
    } catch (e) {
      await refundCredits(session.login, BUILD_CREDITS, 'build_dispatch_setup_refund', { repo, branch }).catch(() => {});
      if (reservation) {
        await kv.decr(reservation.inflightKey).catch(() => {});
        await kv.decr(reservation.pendingKey).catch(() => {});
      }
      throw e;
    }
    const inflightKey = reservation.inflightKey;
    let r;
    try {
      r = await gh(session, `/repos/${repo}/actions/workflows/${TWA_WORKFLOW_FILE}/dispatches`, {
      method: 'POST',
      body: JSON.stringify({
        ref: branch,
        inputs: {
          wb_ticket: wbTicket,
          twa_config: JSON.stringify(twa),
          output,
          use_keystore: String(useKeystore),
          sign_mode: signMode,
          store_ready: String(storeReady),
          timeout_minutes: String((await usageFor(session.login)).plan.monthlyLimit >= 9999 ? 60 : 15),
          bubblewrap_version: /^(\d+\.\d+\.\d+)$/.test(String(b.bubblewrapVersion || '')) ? b.bubblewrapVersion : '1.25.0',
        },
      }),
      });
    } catch (e) {
      await kv.del(`wb:ticket:${ticketHash(wbTicket)}`).catch(() => {});
      await kv.decr(inflightKey).catch(() => {});
      await kv.decr(reservation.pendingKey).catch(() => {});
      await refundCredits(session.login, BUILD_CREDITS, 'build_dispatch_error_refund', { repo, branch }).catch(() => {});
      throw e;
    }
    if (r.status !== 204) {
      await kv.del(`wb:ticket:${ticketHash(wbTicket)}`).catch(() => {});
      await kv.decr(inflightKey).catch(() => {});
      await kv.decr(reservation.pendingKey).catch(() => {});
      await refundCredits(session.login, BUILD_CREDITS, 'build_dispatch_failed_refund', { repo, branch }).catch(() => {});
      const e = await r.json().catch(() => ({}));
      const d = describeGithubFailure(r, e, `starting the build on branch ${branch}`, `POST /repos/${repo}/actions/workflows/<workflow>/dispatches`);
      throw new HttpError(d.http === 404 ? 409 : d.http, d.code === 'GITHUB_NOT_FOUND' ? `GitHub cannot find the workflow on branch "${branch}" of ${repo} (404).` : d.message, d.code === 'GITHUB_NOT_FOUND' ? 'WORKFLOW_NOT_DISPATCHABLE' : d.code, { hint: d.code === 'GITHUB_NOT_FOUND' ? 'The workflow file must exist on that exact branch and contain "on: workflow_dispatch". Reinstall the workflow for that branch, make sure Actions is enabled in the repo settings, then retry.' : d.hint, details: d.details });
    }
    return send(res, 200, { ok: true });
  }

  if (path === 'runs' && m === 'GET') {
    const repos = String(query.repos || '').split(',').filter(Boolean).slice(0, 10).map(checkRepo);
    await Promise.all(repos.map((repo) => kv.sadd(pushRepoUsers(repo), session.login).catch(() => {})));
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

  if (path === 'release/prepare' && m === 'GET') {
    const repo = checkRepo(query.repo);
    const { meta, entries } = await loadArtifactZip(session, repo, query.artifactId);
    const sha = meta.workflow_run?.head_sha || '';
    const files = [];
    for (const f of entries) {
      const buf = await f.async('nodebuffer');
      const name = safeAssetName(f.name);
      files.push({ name, size: buf.length, kind: /\.aab$/i.test(name) ? 'aab' : 'apk', sha256: crypto.createHash('sha256').update(buf).digest('hex') });
    }
    // APK first: it is what people sideload; the AAB is for Play Console
    files.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'apk' ? -1 : 1));
    const parsed = parseBinaryName(files[0].name);
    const versionName = parsed.versionName || '';
    let tag = versionName ? `v${versionName}` : `build-${meta.workflow_run?.id || Date.now()}`;
    const existing = await releaseExistsForTag(session, repo, tag);
    const tagTaken = !!existing || (await tagExists(session, repo, tag));
    if (tagTaken && parsed.versionCode) tag = `${tag}-${parsed.versionCode}`;
    // Suggestions come from the repository's real Git refs and releases, so users can
    // avoid accidentally reusing an existing tag. Keep this bounded and best-effort.
    let tagSuggestions = [];
    try {
      const refs = await gh(session, `/repos/${repo}/git/matching-refs/tags/`);
      if (refs.ok) {
        const rows = await refs.json();
        tagSuggestions = (Array.isArray(rows) ? rows : [])
          .map((r) => String(r?.ref || '').replace(/^refs\/tags\//, ''))
          .filter(Boolean).slice(-40).reverse();
      }
    } catch { /* suggestions are optional; release preparation must still work */ }
    const info = await ghJson(session, `/repos/${repo}`, undefined, `reading ${repo}`);
    const latest = await gh(session, `/repos/${repo}/releases/latest`);
    const previousTag = latest.ok ? (await latest.json()).tag_name : undefined;
    let notes = ''; let notesSource = 'fallback'; let title = versionName ? `${info.name} ${versionName}` : `${info.name} ${tag}`;
    try {
      const gn = await gh(session, `/repos/${repo}/releases/generate-notes`, { method: 'POST', body: JSON.stringify({ tag_name: tag, target_commitish: sha, ...(previousTag ? { previous_tag_name: previousTag } : {}) }) });
      if (gn.ok) { const j = await gn.json(); notes = String(j.body || '').trim(); notesSource = 'github'; }
    } catch { /* fall through to the plain notes */ }
    if (!notes) notes = `Release ${tag} built from ${meta.workflow_run?.head_branch || 'the default branch'} at ${sha.slice(0, 7)}.`;
    const table = ['| File | Size | SHA-256 |', '| --- | --- | --- |', ...files.map((f) => `| \`${f.name}\` | ${fmtBytes(f.size)} | \`${f.sha256}\` |`)].join('\n');
    const howTo = files.some((f) => f.kind === 'apk') ? '\n\nInstall the `.apk` on an Android device (allow installs from your browser or file manager). Use the `.aab` for Google Play Console.' : '\n\nUpload the `.aab` to Google Play Console.';
    notes = `${notes}\n\n## Downloads\n\n${table}${howTo}\n\n_Built with WyBuild._`;
    return send(res, 200, {
      files, packageId: parsed.packageId || '', versionName, versionCode: parsed.versionCode || '',
      tag, name: title, notes, notesSource, previousTag, tagSuggestions,
      target: { sha, branch: meta.workflow_run?.head_branch || info.default_branch },
      tagExists: tagTaken, releaseExists: !!existing, existingReleaseUrl: existing?.html_url,
      canPush: info.permissions ? !!info.permissions.push : true,
    });
  }

  if (path === 'release/publish' && post) {
    const b = bodyOf(req);
    const repo = checkRepo(b.repo);
    const tag = String(b.tag || '').trim();
    if (!TAG_RE.test(tag) || tag.includes('..') || tag.endsWith('/') || tag.endsWith('.lock')) throw new HttpError(400, 'Tag must be 1–100 characters: letters, digits, dots, dashes, underscores or slashes (for example v1.0.0).', 'BAD_TAG');
    const name = String(b.name || tag).trim().slice(0, 200) || tag;
    const body = String(b.body || '').slice(0, 100000);
    const wanted = Array.isArray(b.files) ? b.files.map(safeAssetName).filter((n) => RELEASE_ASSET_RE.test(n)).slice(0, 6) : [];
    if (!wanted.length) throw new HttpError(400, 'Select at least one .apk or .aab file to publish.', 'NO_FILES');
    const asDraft = b.draft === true;
    const info = await ghJson(session, `/repos/${repo}`, undefined, `reading ${repo}`);
    if (info.permissions && !info.permissions.push) throw new HttpError(403, `Your GitHub account cannot create releases in ${repo}.`, 'NO_PUSH_ACCESS', { hint: 'Sign in as the owner or a collaborator with write access.' });
    const { meta, entries } = await loadArtifactZip(session, repo, b.artifactId);
    const byName = new Map(entries.map((f) => [safeAssetName(f.name), f]));
    const missing = wanted.filter((n) => !byName.has(n));
    if (missing.length) throw new HttpError(400, `These files are not in the artifact: ${missing.join(', ')}.`, 'FILE_NOT_IN_ARTIFACT');
    const existing = await releaseExistsForTag(session, repo, tag);
    if (existing) throw new HttpError(409, `A release for tag ${tag} already exists.`, 'TAG_HAS_RELEASE', { hint: 'Choose a new tag (for example bump the version) or edit the existing release on GitHub.', details: { url: existing.html_url } });
    const sha = meta.workflow_run?.head_sha || undefined;
    // Create as a draft first: nobody sees a release with missing downloads. It is published only after every upload succeeds.
    const rel = await ghJson(session, `/repos/${repo}/releases`, {
      method: 'POST',
      body: JSON.stringify({ tag_name: tag, target_commitish: sha, name, body, draft: true, prerelease: b.prerelease === true, generate_release_notes: false }),
    }, `creating release ${tag}`);
    const uploaded = [];
    try {
      for (const n of wanted) {
        const buf = await byName.get(n).async('nodebuffer');
        const up = await gh(session, `https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(n)}`, {
          method: 'POST', body: buf,
          headers: { 'Content-Type': /\.apk$/i.test(n) ? 'application/vnd.android.package-archive' : 'application/octet-stream' },
        });
        if (!up.ok) {
          const e = await up.json().catch(() => ({}));
          throw new HttpError(up.status === 404 ? 502 : up.status, `GitHub rejected the upload of ${n} (${up.status}${e.message ? `: ${e.message}` : ''}).`, 'ASSET_UPLOAD_FAILED');
        }
        const a = await up.json();
        uploaded.push({ name: a.name, url: a.browser_download_url, size: a.size });
      }
    } catch (e) {
      await gh(session, `/repos/${repo}/releases/${rel.id}`, { method: 'DELETE' }).catch(() => {}); // never leave a half-filled draft behind
      throw e;
    }
    let finalRel = rel;
    if (!asDraft) {
      finalRel = await ghJson(session, `/repos/${repo}/releases/${rel.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ draft: false, prerelease: b.prerelease === true, make_latest: b.prerelease === true ? 'false' : 'true' }),
      }, `publishing release ${tag}`);
    }
    return send(res, 200, { ok: true, url: finalRel.html_url, draft: !!finalRel.draft, tag, assets: uploaded });
  }

  if (path === 'artifact' && m === 'GET') {
    const repo = checkRepo(query.repo);
    if (!/^\d+$/.test(query.id || '')) throw new HttpError(400, 'Invalid artifact id');
    const sref = await signedArtifactRef(query.id);
    if (sref) { // a signed build lives on the signer repo; the caller must be able to see the build run in their own repo
      const sg = signerState();
      if (!sg.ok || sref.repo !== repo.toLowerCase()) throw new HttpError(404, 'Signed build not found.', 'ARTIFACT_GONE');
      const seen = await gh(session, `/repos/${repo}/actions/runs/${sref.runId}`);
      if (!seen.ok) throw new HttpError(404, 'Signed build not found.', 'ARTIFACT_GONE');
      const sz = await signerGh(`/repos/${sg.repo}/actions/artifacts/${query.id}/zip`, { redirect: 'manual' });
      const sloc = sz.headers.get('location');
      if (!sloc) throw new HttpError(404, 'The signed build has expired (kept 14 days). Build again to get a fresh signed copy.', 'ARTIFACT_GONE');
      return redirect(res, sloc);
    }
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
    if (signerState().ok) { await removeDefaultKeystore(session, repo); return send(res, 200, { ok: true, signing: 'default' }); } // remote signing: drop the repo's own key, builds are then signed by WyBuild
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
