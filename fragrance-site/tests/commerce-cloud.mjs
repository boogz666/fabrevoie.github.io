// Explicit, isolated Neon transaction verification. This is not a Stripe payment test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createNeonCommerceStorage } from '../lib/commerce-storage.mjs';
import { neon } from '@neondatabase/serverless';

if (!process.argv.includes('--cloud-write') || !process.env.DATABASE_URL) {
  console.error('Use --cloud-write with the intended DATABASE_URL to create and remove isolated QA records.');
  process.exit(1);
}
const id = randomUUID();
const prefix = `integration-qa-${id}`;
const now = Date.now();
const sql = neon(process.env.DATABASE_URL);
const storage = await createNeonCommerceStorage(process.env.DATABASE_URL);
const order = { id, reference: prefix, request_hash: prefix, token_hash: prefix,
  client_hash: prefix, mode: 'test', price_id: 'price_qa_fixture', unit_amount: 100,
  currency: 'eur', quantity: 1, dispatch_notice: 'Integration QA only; no physical order.',
  checkout_snapshot: { qa: true }, session_expires_at: now + 3600000, created_at: now, updated_at: now };
const event = { id: `evt_${id.replaceAll('-', '')}`, type: 'checkout.session.completed', created: Math.floor(now / 1000) };
let stage = 'createOrder';
try {
  await storage.createOrder(order);
  assert.equal((await storage.getByRequestHash(prefix)).id, id);
  await storage.createOrder(order);
  const update = { orderId: id, mode: 'test', sessionId: `cs_test_${id}`, paymentIntentId: `pi_${id}`,
    status: 'paid', paymentConfirmed: true, amountTotal: 100, taxAmount: 0, shippingAmount: 0,
    expectedVersion: (await storage.getOrder(id)).reconciliation_version };
  stage = 'concurrent applyEvent';
  const applied = await Promise.all([storage.applyEvent(event, update), storage.applyEvent(event, update)]);
  assert.equal(applied.filter(result => result.applied).length, 1);
  assert.equal((await storage.getOrder(id)).status, 'paid');
  stage = 'late applyEvent';
  await storage.applyEvent({ ...event, id: event.id + 'late', type: 'checkout.session.async_payment_failed', created: event.created + 1 },
    { ...update, status: 'payment_failed', paymentConfirmed: false, expectedVersion: (await storage.getOrder(id)).reconciliation_version });
  assert.equal((await storage.getOrder(id)).status, 'paid');
  stage = 'refund reconciliation';
  const refund = {id:`re_${id.replaceAll('-', '')}`,status:'succeeded',amount:100,currency:'eur'};
  const refundEvent = {...event,id:event.id+'refund',type:'refund.updated',created:event.created+2};
  const refundUpdate = {...update,refundedAmount:100,refunds:[refund],expectedVersion:(await storage.getOrder(id)).reconciliation_version};
  await storage.applyEvent(refundEvent, refundUpdate);
  assert.equal((await storage.getOrder(id)).status,'refunded');
  const returnedEvent = {...refundEvent,id:refundEvent.id+'return',created:refundEvent.created+1};
  await assert.rejects(storage.applyEvent(returnedEvent,{...refundUpdate,refundedAmount:0,refunds:[{...refund,status:'failed'}]}));
  assert.equal(await storage.hasEvent(returnedEvent.id),false);
  await storage.applyEvent(returnedEvent,{...refundUpdate,refundedAmount:0,refunds:[{...refund,status:'failed'}],expectedVersion:(await storage.getOrder(id)).reconciliation_version});
  assert.equal((await storage.getOrder(id)).status,'paid');
  assert.equal((await storage.getOrder(id)).refunded_amount,0);
  stage = 'consume';
  assert.equal(await storage.consume(prefix, 1, 60000), 0);
  assert.ok(await storage.consume(prefix, 1, 60000) > 0);
  console.log('PASS: actual Neon persistence, idempotent creation, concurrent event deduplication, paid-state protection, refund reversals, stale-snapshot rejection and shared rate limits. Synthetic database fixtures only; no Stripe payment or tax calculation.');
} catch (error) {
  const code = /^[A-Z0-9_]{3,30}$/.test(error.code || '') ? error.code : 'unspecified';
  console.error(`FAIL: cloud commerce storage check at ${stage}; code ${code}. Provider details withheld to protect connection credentials.`);
  process.exitCode = 1;
} finally {
  await sql.transaction([
    sql.query('DELETE FROM fabrevoie_commerce_refunds WHERE order_id = $1', [id]),
    sql.query('DELETE FROM fabrevoie_commerce_events WHERE order_id = $1', [id]),
    sql.query('DELETE FROM fabrevoie_commerce_orders WHERE id = $1 AND reference = $2', [id, prefix]),
    sql.query('DELETE FROM fabrevoie_commerce_rate_limits WHERE client_hash = $1', [prefix]),
  ]).then(() => console.log('Isolated QA records removed.')).catch(() => {
    console.error('QA cleanup failed; the isolated integration-qa records need private review.');
    process.exitCode = 1;
  });
}
