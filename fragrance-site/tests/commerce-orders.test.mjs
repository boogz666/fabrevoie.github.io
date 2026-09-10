import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { summarizeOrder, writePrivateExport, runOrders } from '../scripts/commerce-orders.mjs';

const order = { reference: 'FF-TEST', mode: 'test', status: 'paid', quantity: 1, amount_total: 100,
  currency: 'eur', refunded_amount: 0, created_at: 1789171200000, stripe_payment_intent_id: 'pi_test',
  token_hash: 'private', checkout_url: 'private', customer: {email:'buyer@example.test'}, shipping: {name:'Example'},
  checkout_snapshot: {secret: 'private'}, client_hash: 'private', tax_amount: 10, shipping_amount: 0 };

test('operator summary excludes all contact, token, request and checkout data', () => {
  const summary = summarizeOrder(order);
  assert.equal(summary.status, 'paid');
  assert.equal(summary.payment, 'https://dashboard.stripe.com/test/payments/pi_test');
  assert.doesNotMatch(JSON.stringify(summary), /private|buyer@|Example|customer|shipping|checkout/);
});

test('private export includes fulfillment data but excludes internal secrets and refuses public paths/overwrite', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fabrevoie-orders-'));
  try {
    await mkdir(path.join(root, 'public'));
    await mkdir(path.join(root, 'dist'));
    const destination = path.join(root, 'data', 'orders.json');
    assert.equal(await writePrivateExport([order], {destination, siteRoot:root}), 1);
    const content = await readFile(destination, 'utf8');
    assert.match(content, /buyer@example.test/);
    assert.doesNotMatch(content, /private|token_hash|checkout_snapshot/);
    await assert.rejects(writePrivateExport([order], {destination, siteRoot:root}));
    for (const folder of ['public', 'dist']) await assert.rejects(writePrivateExport([order], {destination:path.join(root, folder, 'orders.json'), siteRoot:root}), /private JSON/);
    const alias = path.join(root, 'alias');
    await symlink(path.join(root, 'public'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(writePrivateExport([order], {destination:path.join(alias, 'orders.json'), siteRoot:root}), /resolves inside/);
  } finally {
    assert.equal(path.dirname(root), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith('fabrevoie-orders-'));
    await rm(root, {recursive:true, force:true});
  }
});

test('cloud mode requires explicit configured cloud storage and never falls back', async () => {
  await assert.rejects(runOrders({args:['--cloud'], env:{}, log(){}}), /no local fallback/);
  await assert.rejects(runOrders({args:['--delete'], env:{}, log(){}}), /Usage:/);
});
