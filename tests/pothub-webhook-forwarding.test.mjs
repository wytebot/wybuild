import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('WyBuild forwards PotHub only after direct Flutterwave charge lookup', async () => {
  const source = await readFile(new URL('../api/index.js', import.meta.url), 'utf8');
  const lookup = source.indexOf("/^kh[a-f0-9]{32}$/i.test(String(referenceHint || ''))");
  const forward = source.indexOf("/^kh[a-f0-9]{32}$/i.test(ref)");
  const getCharge = source.indexOf('charge = await getCharge(String(id))');
  assert.ok(lookup > getCharge, 'reference-only PotHub lookup is in webhook reconciliation');
  assert.ok(forward > 0, 'PotHub settlement forwarding branch exists');
  assert.match(source, /webhook\?\.data\?\.tx_ref/);
  assert.match(source, /POTHUB_PAYMENT_CONFIRM_URL/);
  assert.match(source, /POTHUB_WEBHOOK_SHARED_SECRET/);
  assert.match(source, /Flutterwave charge reference does not match the webhook reference/);
  assert.match(source, /AbortSignal\.timeout\(15000\)/);
});

test('setup docs keep WyBuild as the single registered Flutterwave webhook', async () => {
  const docs = await readFile(new URL('../FLUTTERWAVE-WEBHOOK-SETUP.md', import.meta.url), 'utf8');
  assert.match(docs, /https:\/\/wybuild-black\.vercel\.app\/api\/billing\/webhook/);
  assert.match(docs, /POTHUB_PAYMENT_CONFIRM_URL/);
  assert.match(docs, /WYBUILD_WEBHOOK_SHARED_SECRET/);
  assert.match(docs, /Do not register PotHub's own Flutterwave webhook URL/);
});
