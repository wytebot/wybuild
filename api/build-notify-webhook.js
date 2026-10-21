import crypto from 'node:crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { kv } from '../lib/kv.js';

export const config = { api: { bodyParser: false } };

const env = (key) => process.env[key] || '';
const repoUsersKey = (repo) => `wb:push:repo-users:${String(repo || '').toLowerCase()}`;
const tokenIndexKey = (login) => `wb:push:token-index:${String(login || '').toLowerCase()}`;

async function readRaw(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}
function timingSafeHexEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); } catch { return false; }
}
function firebaseMessaging() {
  const raw = env('FIREBASE_SERVICE_ACCOUNT_JSON').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured');
  const account = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  if (!account.project_id || !account.client_email || !account.private_key) throw new Error('Firebase service account JSON is incomplete');
  const app = getApps().find((a) => a.name === 'wybuild-build-notifications') || initializeApp({ credential: cert(account) }, 'wybuild-build-notifications');
  return getMessaging(app);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.statusCode = 405; res.setHeader('Allow', 'POST'); return res.end('Method not allowed'); }
  const secret = env('WYBUILD_PUSH_WEBHOOK_SECRET');
  if (secret.length < 24) { res.statusCode = 503; return res.end('Build notification webhook is not configured'); }

  let raw;
  try { raw = await readRaw(req); } catch { res.statusCode = 400; return res.end('Could not read request body'); }
  const signature = String(req.headers['x-hub-signature-256'] || '');
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  if (!signature.startsWith('sha256=') || !timingSafeHexEqual(signature.slice(7), expected.slice(7))) {
    res.statusCode = 401; return res.end('Invalid webhook signature');
  }

  const event = String(req.headers['x-github-event'] || '');
  if (event !== 'workflow_run') { res.statusCode = 202; return res.end('Ignored event'); }
  let payload;
  try { payload = JSON.parse(raw.toString('utf8')); } catch { res.statusCode = 400; return res.end('Invalid JSON'); }
  if (payload.action !== 'completed') { res.statusCode = 202; return res.end('Ignored workflow action'); }

  const run = payload.workflow_run || {};
  const repo = String(payload.repository?.full_name || '');
  const runId = String(run.id || '');
  const workflowPath = String(run.path || payload.workflow?.path || '');
  const workflowName = String(run.name || payload.workflow?.name || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^\d+$/.test(runId)) {
    res.statusCode = 400; return res.end('Missing repository or workflow run id');
  }
  // Do not notify for unrelated workflows in repositories that use WyBuild.
  if (!/wybuild/i.test(workflowName) && !/\.github\/workflows\/wybuild-[^/]+\.yml$/i.test(workflowPath)) {
    res.statusCode = 202; return res.end('Ignored non-WyBuild workflow');
  }
  const conclusion = String(run.conclusion || 'unknown');
  if (!['success', 'failure', 'timed_out', 'action_required'].includes(conclusion)) {
    res.statusCode = 202; return res.end('No notification for this conclusion');
  }

  // GitHub retries webhooks. A short idempotency key prevents duplicate device notifications.
  const dedupe = `wb:push:delivered:${repo.toLowerCase()}:${runId}:${String(run.run_attempt || 1)}:${conclusion}`;
  const first = await kv.set(dedupe, Date.now(), { nx: true, ex: 7 * 24 * 3600 });
  if (!first) { res.statusCode = 202; return res.end('Duplicate event ignored'); }

  const logins = await kv.smembers(repoUsersKey(repo)).catch(() => []);
  const devices = [];
  for (const login of logins) {
    const keys = await kv.smembers(tokenIndexKey(login)).catch(() => []);
    for (const key of keys) {
      const record = await kv.get(key).catch(() => null);
      if (record?.token) devices.push({ login, key, token: record.token });
    }
  }
  if (!devices.length) { res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, sent: 0, reason: 'No registered devices for this repository' })); }

  const base = (env('APP_URL') || 'https://wybuild-black.vercel.app').replace(/\/$/, '');
  const tab = conclusion === 'success' ? 'artifacts' : 'logs';
  const target = `${base}/?notifyRepo=${encodeURIComponent(repo)}&notifyRun=${encodeURIComponent(runId)}&notifyTab=${tab}`;
  const success = conclusion === 'success';
  const title = success ? 'WyBuild: build completed' : 'WyBuild: build failed';
  const body = success ? `Your build for ${repo} is ready. Tap to open its artifacts.` : `The build for ${repo} did not complete successfully. Tap to inspect its logs.`;
  let sent = 0, failed = 0;
  try {
    const messaging = firebaseMessaging();
    for (let i = 0; i < devices.length; i += 400) {
      const batch = devices.slice(i, i + 400);
      const response = await messaging.sendEachForMulticast({
        tokens: batch.map((x) => x.token),
        notification: { title, body },
        data: { url: target, repo, runId, tab, conclusion, workflowRunUrl: String(run.html_url || '') },
        android: { priority: 'high', notification: { channelId: 'wybuild-builds', clickAction: 'FLUTTER_NOTIFICATION_CLICK', tag: `wybuild-${repo}-${runId}` } },
        webpush: { notification: { title, body, tag: `wybuild-${repo}-${runId}`, data: { url: target } }, fcmOptions: { link: target } },
      });
      sent += response.successCount;
      failed += response.failureCount;
      for (let j = 0; j < response.responses.length; j++) {
        const err = response.responses[j].error;
        if (err && /registration-token-not-registered|invalid-registration-token/i.test(`${err.code || ''} ${err.message || ''}`)) {
          const device = batch[j];
          await kv.del(device.key).catch(() => {});
          await kv.srem(tokenIndexKey(device.login), device.key).catch(() => {});
        }
      }
    }
  } catch (error) {
    // Allow GitHub to retry on a server/configuration failure.
    await kv.del(dedupe).catch(() => {});
    console.error('WyBuild FCM notification failed:', error?.message || error);
    res.statusCode = 500; res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ ok: false, error: 'Firebase could not send build notifications' }));
  }
  res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({ ok: true, sent, failed, repo, runId }));
}
