// Firestore-first KV with automatic Supabase failover for quota/resource-exhaustion errors.
// Supabase credentials are server-only. Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
// A short process-local circuit breaker prevents repeatedly paying for Firestore requests after quota is hit.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let firestore;
let firestoreBlockedUntil = 0;
const FIRESTORE_COOLDOWN_MS = Math.max(15_000, Number(process.env.FIRESTORE_FAILOVER_COOLDOWN_MS || 120_000));
const supabaseUrl = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

function db() {
  if (firestore) return firestore;
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('Firestore credentials are not configured.');
  let serviceAccount;
  try { serviceAccount = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8')); }
  catch { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON.'); }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing required service-account fields.');
  const app = getApps().find((a) => a.name === 'wybuild-admin') || initializeApp({ credential: cert(serviceAccount) }, 'wybuild-admin');
  firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true, ...(process.env.FIRESTORE_PREFER_REST === '1' ? { preferRest: true } : {}) });
  return firestore;
}
const docId = (v) => Buffer.from(String(v)).toString('base64url');
const expiryMs = (v) => v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : Number(v || 0));

function isQuotaError(error) {
  const code = String(error?.code ?? error?.status ?? '').toLowerCase();
  const msg = String(error?.message || error || '').toLowerCase();
  return code === '8' || code === 'resource_exhausted' || code === '429' || code === 'quota_exceeded' ||
    /quota exceeded|resource exhausted|too many requests|rate.?limit exceeded|daily limit exceeded|billing account.*disabled|exceeded.*quota/.test(msg);
}
function fallbackEnabled() { return Date.now() < firestoreBlockedUntil; }
function markFirestoreQuota(error) {
  firestoreBlockedUntil = Date.now() + FIRESTORE_COOLDOWN_MS;
  // Server log only: never surface storage-provider noise as a user popup.
  console.warn(`[storage] Firestore quota/resource exhaustion; switching KV operations to Supabase for ${Math.round(FIRESTORE_COOLDOWN_MS / 1000)}s.`, String(error?.code || error?.message || 'quota').slice(0, 160));
}
function requireSupabase() {
  const url = supabaseUrl(); const key = supabaseKey();
  if (!url || !key) throw new Error('Firestore quota was reached, but Supabase fallback is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  return { url, key };
}
async function supaRpc(fn, body) {
  const { url, key } = requireSupabase();
  const response = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(12_000),
  });
  const raw = await response.text();
  if (!response.ok) throw new Error(`Supabase fallback ${fn} failed (${response.status}): ${raw.slice(0, 240)}`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return raw; }
}
async function supaGet(k) {
  const value = await supaRpc('wb_kv_get', { p_key: String(k) });
  return value ?? null;
}
async function supaSet(k, value, opts = {}) {
  const result = await supaRpc('wb_kv_set', { p_key: String(k), p_value: value, p_nx: !!opts.nx, p_ex: opts.ex == null ? null : Math.max(1, Number(opts.ex) | 0) });
  return opts.nx ? (result === true ? 'OK' : null) : 'OK';
}
async function supaDel(k) { await supaRpc('wb_kv_del', { p_key: String(k) }); return 1; }
async function supaIncr(k, by = 1) { return Number(await supaRpc('wb_kv_incr', { p_key: String(k), p_by: by })); }
async function supaExpire(k, seconds) { await supaRpc('wb_kv_expire', { p_key: String(k), p_ex: Math.max(1, Number(seconds) | 0) }); return 1; }
async function supaSadd(k, member) { await supaRpc('wb_set_add', { p_set: String(k), p_member: String(member) }); return 1; }
async function supaSrem(k, member) { await supaRpc('wb_set_rem', { p_set: String(k), p_member: String(member) }); return 1; }
async function supaSmembers(k) { const v = await supaRpc('wb_set_members', { p_set: String(k) }); return Array.isArray(v) ? v : []; }

async function withStorage(firestoreOperation, supabaseOperation) {
  if (fallbackEnabled()) return supabaseOperation();
  try { return await firestoreOperation(); }
  catch (error) {
    if (!isQuotaError(error)) throw error;
    markFirestoreQuota(error);
    return supabaseOperation();
  }
}
async function fsGet(k) {
  const ref = db().collection('wb_kv').doc(docId(k)); const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.expiresAt && expiryMs(data.expiresAt) <= Date.now()) { await ref.delete().catch(() => {}); return null; }
  return data.value ?? null;
}
async function fsSet(k, value, opts = {}) {
  const ref = db().collection('wb_kv').doc(docId(k));
  if (!opts.nx) {
    await ref.set({ key: String(k), value, expiresAt: opts.ex ? new Date(Date.now() + Number(opts.ex) * 1000) : null, updatedAt: Date.now() });
    return 'OK';
  }
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref); const old = snap.exists ? snap.data() : null;
    const expired = old?.expiresAt && expiryMs(old.expiresAt) <= Date.now();
    if (old && !expired) return false;
    tx.set(ref, { key: String(k), value, expiresAt: opts.ex ? new Date(Date.now() + Number(opts.ex) * 1000) : null, updatedAt: Date.now() });
    return true;
  });
  return result ? 'OK' : null;
}
async function fsIncr(k, by) {
  const ref = db().collection('wb_kv').doc(docId(k));
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref); const d = snap.exists ? snap.data() : {};
    const expired = d.expiresAt && expiryMs(d.expiresAt) <= Date.now(); const old = expired ? 0 : Number(d.value || 0); const next = old + by;
    tx.set(ref, { key: String(k), value: next, expiresAt: expired ? null : (d.expiresAt ?? null), updatedAt: Date.now() }); return next;
  });
}
const getInflight = new Map();
export const kv = {
  // Concurrent reads of the same key share one round trip. Nothing is cached after the read settles, so this can
  // never serve stale data to a later caller (credits/locks stay exact).
  get(k) {
    const key = String(k);
    const inflight = getInflight.get(key);
    if (inflight) return inflight;
    const p = withStorage(() => fsGet(k), () => supaGet(k)).finally(() => { if (getInflight.get(key) === p) getInflight.delete(key); });
    getInflight.set(key, p);
    return p;
  },
  async set(k, value, opts = {}) { getInflight.delete(String(k)); return withStorage(() => fsSet(k, value, opts), () => supaSet(k, value, opts)); },
  async del(k) { getInflight.delete(String(k)); return withStorage(async () => { await db().collection('wb_kv').doc(docId(k)).delete(); return 1; }, () => supaDel(k)); },
  async incr(k) { getInflight.delete(String(k)); return withStorage(() => fsIncr(k, 1), () => supaIncr(k, 1)); },
  async decr(k) { getInflight.delete(String(k)); return withStorage(() => fsIncr(k, -1), () => supaIncr(k, -1)); },
  async expire(k, seconds) { getInflight.delete(String(k)); return withStorage(async () => { await db().collection('wb_kv').doc(docId(k)).set({ expiresAt: new Date(Date.now() + Number(seconds) * 1000) }, { merge: true }); return 1; }, () => supaExpire(k, seconds)); },
  async sadd(k, member) { return withStorage(async () => { await db().collection('wb_set').doc(`${docId(k)}_${docId(member)}`).set({ setKey: String(k), member: String(member) }, { merge: true }); return 1; }, () => supaSadd(k, member)); },
  async srem(k, member) { return withStorage(async () => { await db().collection('wb_set').doc(`${docId(k)}_${docId(member)}`).delete(); return 1; }, () => supaSrem(k, member)); },
  async smembers(k) { return withStorage(async () => { const snap = await db().collection('wb_set').where('setKey', '==', String(k)).get(); return snap.docs.map((d) => d.data().member); }, () => supaSmembers(k)); },
};
