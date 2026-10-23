import crypto from 'node:crypto';
export const handoffKey = (code) => `wb:native-handoff:${crypto.createHash('sha256').update(String(code)).digest('hex')}`;
export const pkceChallenge = (verifier) => crypto.createHash('sha256').update(String(verifier)).digest('base64url');
export async function consumeHandoff({ kv, code, verifier, now = Date.now() }) {
  if (!/^[A-Za-z0-9_-]{20,128}$/.test(String(code || '')) || !/^[A-Za-z0-9._~-]{43,128}$/.test(String(verifier || ''))) throw Object.assign(new Error('The sign-in code or verifier is invalid.'), { code: 'BAD_HANDOFF', status: 400 });
  const digest = crypto.createHash('sha256').update(String(code)).digest('hex'); const key = handoffKey(code);
  const record = await kv.get(key);
  if (!record || now - Number(record.createdAt || 0) > 120000 || now < Number(record.createdAt || 0)) throw Object.assign(new Error('This sign-in code has expired or was already used. Start sign-in again.'), { code: 'HANDOFF_EXPIRED', status: 400 });
  const actual = pkceChallenge(verifier); const expected = String(record.challenge || '');
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw Object.assign(new Error('This sign-in code does not match this app request.'), { code: 'HANDOFF_PKCE_MISMATCH', status: 400 });
  const claim = await kv.set(`wb:native-handoff-used:${digest}`, { at: now }, { nx: true, ex: 300 });
  if (!claim) throw Object.assign(new Error('This sign-in code has already been used.'), { code: 'HANDOFF_REPLAY', status: 400 });
  await kv.del(key);
  return record;
}
