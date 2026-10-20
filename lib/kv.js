// WyBuild storage uses Firestore only. The Firebase project is inferred from
// FIREBASE_SERVICE_ACCOUNT_JSON.project_id; no separate project ID or Supabase
// runtime credentials are required.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

let firestore;
function db() {
  if (firestore) return firestore;
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) throw new Error('Storage is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON in the server environment to the Firebase service-account JSON (raw JSON or base64 encoded).');
  let serviceAccount;
  try {
    serviceAccount = JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  } catch {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid Firebase service-account JSON (raw JSON or base64 encoded).');
  }
  if (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must include project_id, client_email and private_key from a Firebase service-account key.');
  }
  const app = getApps().find((a) => a.name === 'wybuild-admin') || initializeApp({ credential: cert(serviceAccount) }, 'wybuild-admin');
  firestore = getFirestore(app);
  firestore.settings({ ignoreUndefinedProperties: true });
  return firestore;
}
const docId = (v) => Buffer.from(String(v)).toString('base64url');
const expiryMs = (v) => v?.toMillis?.() ?? (v instanceof Date ? v.getTime() : Number(v || 0));

async function fsGet(k) {
  const ref = db().collection('wb_kv').doc(docId(k));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data();
  if (data.expiresAt && expiryMs(data.expiresAt) <= Date.now()) { await ref.delete().catch(() => {}); return null; }
  return data.value ?? null;
}
async function fsSet(k, value, opts = {}) {
  const ref = db().collection('wb_kv').doc(docId(k));
  const result = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const old = snap.exists ? snap.data() : null;
    const expired = old?.expiresAt && expiryMs(old.expiresAt) <= Date.now();
    if (opts.nx && old && !expired) return false;
    tx.set(ref, { key: String(k), value, expiresAt: opts.ex ? new Date(Date.now() + Number(opts.ex) * 1000) : null, updatedAt: Date.now() });
    return true;
  });
  return result ? 'OK' : null;
}

export const kv = {
  async get(k) { return fsGet(k); },
  async set(k, value, opts = {}) { return fsSet(k, value, opts); },
  async del(k) { await db().collection('wb_kv').doc(docId(k)).delete(); return 1; },
  async incr(k) {
    const ref = db().collection('wb_kv').doc(docId(k));
    return db().runTransaction(async (tx) => { const snap = await tx.get(ref); const d = snap.exists ? snap.data() : {}; const expired = d.expiresAt && expiryMs(d.expiresAt) <= Date.now(); const old = expired ? 0 : Number(d.value || 0); const next = old + 1; tx.set(ref, { key: String(k), value: next, expiresAt: expired ? null : (d.expiresAt ?? null), updatedAt: Date.now() }); return next; });
  },
  async decr(k) {
    const ref = db().collection('wb_kv').doc(docId(k));
    return db().runTransaction(async (tx) => { const snap = await tx.get(ref); const d = snap.exists ? snap.data() : {}; const expired = d.expiresAt && expiryMs(d.expiresAt) <= Date.now(); const old = expired ? 0 : Number(d.value || 0); const next = old - 1; tx.set(ref, { key: String(k), value: next, expiresAt: expired ? null : (d.expiresAt ?? null), updatedAt: Date.now() }); return next; });
  },
  async expire(k, seconds) { const ref = db().collection('wb_kv').doc(docId(k)); await ref.set({ expiresAt: new Date(Date.now() + Number(seconds) * 1000) }, { merge: true }); return 1; },
  async sadd(k, member) { await db().collection('wb_set').doc(`${docId(k)}_${docId(member)}`).set({ setKey: String(k), member: String(member) }, { merge: true }); return 1; },
  async srem(k, member) { await db().collection('wb_set').doc(`${docId(k)}_${docId(member)}`).delete(); return 1; },
  async smembers(k) { const snap = await db().collection('wb_set').where('setKey', '==', String(k)).get(); return snap.docs.map((d) => d.data().member); },
};
