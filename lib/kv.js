// Supabase-backed replacement for @vercel/kv (same method names/semantics the app uses).
// Talks to PostgREST RPC functions defined in supabase/schema.sql. Server-side only.
const base = () => (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const key = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

async function rpc(fn, args) {
  if (!base() || !key()) throw new Error('Supabase is not configured (set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)');
  const r = await fetch(`${base()}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: key(), Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${fn} failed (${r.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export const kv = {
  async get(k) {
    const v = await rpc('wb_kv_get', { p_key: k });
    return v === undefined ? null : v;
  },
  // returns 'OK', or null when {nx:true} and the key already exists (Upstash-compatible)
  async set(k, value, opts = {}) {
    const ok = await rpc('wb_kv_set', { p_key: k, p_value: value, p_nx: !!opts.nx, p_ex: opts.ex ?? null });
    return ok ? 'OK' : null;
  },
  async del(k) { await rpc('wb_kv_del', { p_key: k }); return 1; },
  async incr(k) { return Number(await rpc('wb_kv_incr', { p_key: k, p_by: 1 })); },
  async decr(k) { return Number(await rpc('wb_kv_incr', { p_key: k, p_by: -1 })); },
  async expire(k, seconds) { await rpc('wb_kv_expire', { p_key: k, p_ex: seconds }); return 1; },
  async sadd(k, member) { await rpc('wb_set_add', { p_set: k, p_member: String(member) }); return 1; },
  async srem(k, member) { await rpc('wb_set_rem', { p_set: k, p_member: String(member) }); return 1; },
  async smembers(k) { return (await rpc('wb_set_members', { p_set: k })) || []; },
};
