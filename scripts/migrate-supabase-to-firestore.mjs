import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const rawAccount = (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim();
if (!supabaseUrl || !supabaseKey || !rawAccount) throw new Error('For one-time migration only, set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and FIREBASE_SERVICE_ACCOUNT_JSON.');
const account = JSON.parse(rawAccount.startsWith('{') ? rawAccount : Buffer.from(rawAccount, 'base64').toString('utf8'));
const app = getApps().find((a) => a.name === 'wybuild-migration') || initializeApp({ credential: cert(account) }, 'wybuild-migration');
const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });
const id = (v) => Buffer.from(String(v)).toString('base64url');
async function readTable(table, select) {
  const rows = []; let offset = 0;
  while (true) {
    const r = await fetch(`${supabaseUrl}/rest/v1/${table}?select=${select}&limit=1000&offset=${offset}`, { headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` } });
    const body = await r.json().catch(() => []);
    if (!r.ok) throw new Error(`Supabase ${table} export failed (${r.status}): ${JSON.stringify(body).slice(0, 300)}`);
    rows.push(...body); if (body.length < 1000) break; offset += body.length;
  }
  return rows;
}
const kvRows = await readTable('wb_kv', 'key,value,expires_at');
const setRows = await readTable('wb_set', 'set_key,member');
console.log(`Migrating ${kvRows.length} key/value records and ${setRows.length} set members to Firestore project ${account.project_id}.`);
for (let i = 0; i < kvRows.length; i += 400) {
  const batch = db.batch();
  for (const row of kvRows.slice(i, i + 400)) {
    const ref = db.collection('wb_kv').doc(id(row.key));
    batch.set(ref, { key: row.key, value: row.value, expiresAt: row.expires_at ? new Date(row.expires_at) : null, updatedAt: Date.now() }, { merge: false });
  }
  await batch.commit();
  console.log(`Migrated KV ${Math.min(i + 400, kvRows.length)}/${kvRows.length}`);
}
for (let i = 0; i < setRows.length; i += 400) {
  const batch = db.batch();
  for (const row of setRows.slice(i, i + 400)) batch.set(db.collection('wb_set').doc(`${id(row.set_key)}_${id(row.member)}`), { setKey: row.set_key, member: row.member }, { merge: false });
  await batch.commit();
  console.log(`Migrated sets ${Math.min(i + 400, setRows.length)}/${setRows.length}`);
}
console.log('Migration complete. Verify key counts and test login/build/payment workflows. The deployed WyBuild app uses Firestore only; these Supabase credentials are for this one-time migration script only.');
