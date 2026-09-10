import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import Stripe from 'stripe';
import { createCommerceHandlers, readWebhookBody } from '../lib/commerce.mjs';
import { createSqliteCommerceStorage } from '../lib/commerce-storage.mjs';
import { INTEGRATION_IDENTIFIER, readCommerceConfiguration } from '../lib/commerce-config.mjs';

const ORIGIN = 'https://fabrevoie.example';
const SECRET = ['rk', 'test', randomBytes(24).toString('hex')].join('_');
const WEBHOOK_SECRET = `whsec_${randomBytes(24).toString('hex')}`;
const ENV = {
  COMMERCE_MODE: 'test', STRIPE_SECRET_KEY: SECRET, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PRICE_ID: 'price_fixture', STRIPE_SHIPPING_RATE_IDS: 'shr_fixture',
  COMMERCE_ALLOWED_SHIPPING_COUNTRIES: 'FR,DE', COMMERCE_DISPATCH_NOTICE: 'Dispatch timing confirmed in this test fixture.',
  ORDER_TOKEN_SECRET: randomBytes(32).toString('hex'), RATE_LIMIT_SECRET: randomBytes(32).toString('hex'),
  PUBLIC_SITE_URL: ORIGIN, VERCEL: '1', VERCEL_ENV: 'preview',
};
const signer = new Stripe(SECRET);
const sessionUrl = id => `https://checkout.stripe.com/c/pay/${id}#fixture`;

async function invoke(handler, { method = 'POST', body, headers = {}, raw } = {}) {
  const request = Readable.from(raw === undefined ? [] : [raw]);
  request.method = method;
  request.headers = { host: 'fabrevoie.example', origin: ORIGIN, 'content-type': 'application/json',
    'x-forwarded-for': '203.0.113.20', ...headers };
  request.socket = { remoteAddress: '127.0.0.1' };
  if (raw === undefined) request.body = body;
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = JSON.parse(body); this.writableEnded = true; },
  };
  await handler(request, response);
  return response;
}

async function setup(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'fabrevoie-commerce-'));
  const db = await createSqliteCommerceStorage(directory);
  const env = { ...ENV, ...options.env };
  const calls = [];
  const sessions = new Map();
  const createKeys = new Map();
  const state = {
    price: { id: env.STRIPE_PRICE_ID, active: true, livemode: false, type: 'one_time', billing_scheme: 'per_unit',
      currency: 'eur', unit_amount: 10000, tax_behavior: 'inclusive',
      product: { id: 'prod_fixture', active: true, livemode: false, tax_code: 'txcd_fixture' } },
    settings: { status: 'active', livemode: false, head_office: { address: { country: 'FR' } } },
    registrations: { data: [{ id: 'taxreg_fixture', status: 'active', livemode: false, active_from: 1, expires_at: null }], has_more: false },
    shipping: { id: 'shr_fixture', active: true, livemode: false, type: 'fixed_amount',
      fixed_amount: { currency: 'eur', amount: 500 }, tax_behavior: 'inclusive' },
    refunds: [],
  };
  const stripe = {
    webhooks: signer.webhooks,
    prices: { async retrieve() { calls.push(['price']); return state.price; } },
    tax: { settings: { async retrieve() { return state.settings; } }, registrations: { async list() { return state.registrations; } } },
    shippingRates: { async retrieve() { return state.shipping; } },
    checkout: { sessions: {
      async create(parameters, requestOptions) {
        calls.push(['create', parameters, requestOptions]);
        const durable = await db.getOrder(parameters.client_reference_id);
        assert.ok(durable, 'order intent must precede the Stripe request');
        if (options.beforeCreate) await options.beforeCreate(parameters, requestOptions);
        if (createKeys.has(requestOptions.idempotencyKey)) return sessions.get(createKeys.get(requestOptions.idempotencyKey));
        const id = `cs_test_${parameters.client_reference_id.replaceAll('-', '')}`;
        const session = {
          id, url: sessionUrl(id), mode: 'payment', livemode: false, status: 'open', payment_status: 'unpaid',
          currency: 'eur', client_reference_id: parameters.client_reference_id, metadata: parameters.metadata,
          automatic_tax: { enabled: true, status: 'complete' }, amount_total: parameters.line_items[0].quantity * 10000 + 500,
          total_details: { amount_tax: 0, amount_shipping: 500, amount_discount: 0 },
          payment_intent: `pi_${parameters.client_reference_id.replaceAll('-', '')}`,
          line_items: { data: [{ quantity: parameters.line_items[0].quantity,
            price: { id: env.STRIPE_PRICE_ID, currency: 'eur', unit_amount: 10000 } }], has_more: false },
          customer_details: { name: 'Fixture Buyer', email: 'buyer@example.test', phone: null, address: { country: 'FR' } },
          collected_information: { shipping_details: { name: 'Fixture Buyer', address: { country: 'FR', city: 'Fixture City', line1: 'Test address' } } },
        };
        sessions.set(id, session);
        createKeys.set(requestOptions.idempotencyKey, id);
        return session;
      },
      async retrieve(id) { calls.push(['retrieve', id]); return sessions.get(id); },
      async list({ payment_intent }) { return { data: [...sessions.values()].filter(item => item.payment_intent === payment_intent) }; },
    } },
    refunds: { async list() { return { data: state.refunds, has_more: false }; } },
  };
  const logs = [];
  const handlers = createCommerceHandlers({ env, storage: db, stripe, logger: { error: (...args) => logs.push(args) } });
  t.after(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });
  return { ...handlers, env, db, directory, calls, state, stripe, sessions, logs };
}

async function checkout(fixture, quantity = 1, requestId = randomUUID()) {
  const response = await invoke(fixture.checkout, { body: { quantity, requestId } });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const order = (await fixture.db.listOrders()).find(item => item.checkout_url === response.body.url);
  const create = fixture.calls.find(call => call[0] === 'create' && call[1].client_reference_id === order.id);
  const token = new URL(create[1].success_url).hash.slice('#order='.length);
  return { response, order, token, session: fixture.sessions.get(order.stripe_session_id), requestId };
}

async function webhook(fixture, session, type = 'checkout.session.completed', options = {}) {
  const event = { id: options.id ?? `evt_${randomBytes(12).toString('hex')}`, type,
    created: options.created ?? Math.floor(Date.now() / 1000), livemode: options.livemode ?? false,
    data: { object: options.object ?? session } };
  const raw = Buffer.from(JSON.stringify(event));
  const signature = signer.webhooks.generateTestHeaderString({ payload: raw.toString(), secret: WEBHOOK_SECRET,
    ...(options.timestamp ? { timestamp: options.timestamp } : {}) });
  const response = await invoke(fixture.webhook, { raw, headers: { 'stripe-signature': signature, ...options.headers } });
  return { response, event, raw, signature };
}

test('commerce defaults disabled and key/environment mismatches fail closed without Stripe calls', async t => {
  for (const values of [{ COMMERCE_MODE: undefined }, { COMMERCE_MODE: 'disabled' },
    { COMMERCE_MODE: 'live' }, { COMMERCE_MODE: 'test', VERCEL_ENV: 'production' },
    { ORDER_TOKEN_SECRET: ENV.RATE_LIMIT_SECRET }, { STRIPE_PRICE_ID: '' }, { STRIPE_SHIPPING_RATE_IDS: '' },
    { COMMERCE_ALLOWED_SHIPPING_COUNTRIES: '' }, { COMMERCE_DISPATCH_NOTICE: '' }]) {
    const fixture = await setup(t, { env: values });
    const response = await invoke(fixture.commerce, { method: 'GET' });
    assert.deepEqual(response.body, { ok: true, available: false, mode: 'disabled', quantityMax: 3, dispatchNotice: '' });
    assert.equal(fixture.calls.length, 0);
  }
  assert.doesNotThrow(() => readCommerceConfiguration({ ...ENV, PUBLIC_SITE_URL: 'http://127.0.0.1:4000', VERCEL: '' }, { hasStorage: true }));
  assert.throws(() => readCommerceConfiguration({ ...ENV, PUBLIC_SITE_URL: 'http://public.example' }, { hasStorage: true }));
});

test('readiness requires active tax settings/registration, coded Product, Price and shipping', async t => {
  for (const change of [
    state => { state.settings.status = 'pending'; }, state => { state.settings.head_office = null; },
    state => { state.registrations.data = []; }, state => { state.registrations.data[0].expires_at = 2; },
    state => { state.price.product.tax_code = null; }, state => { state.price.tax_behavior = 'unspecified'; },
    state => { state.price.livemode = true; }, state => { state.price.active = false; },
    state => { state.price.currency = 'usd'; }, state => { state.shipping.active = false; },
  ]) {
    const fixture = await setup(t); change(fixture.state);
    assert.equal((await invoke(fixture.commerce, { method: 'GET' })).body.available, false);
    assert.equal((await fixture.db.listOrders()).length, 0);
  }
  const fixture = await setup(t);
  const response = await invoke(fixture.commerce, { method: 'GET' });
  assert.equal(response.body.available, true);
  assert.deepEqual(response.body.product, { name: 'ULTRA MACHO', unitAmount: 10000, currency: 'eur' });
  assert.equal(JSON.stringify(response.body).includes('price_'), false);
  assert.equal(response.headers['Cache-Control'], 'no-store');
});

test('strict origins, quantity, UUID, JSON byte bounds and server-only pricing are enforced', async t => {
  const fixture = await setup(t);
  const body = { quantity: 1, requestId: randomUUID() };
  for (const headers of [{ origin: undefined }, { origin: 'null' }, { origin: `${ORIGIN}.evil.test` },
    { origin: `${ORIGIN}/` }, { host: 'other.example', origin: 'https://other.example' },
    { 'sec-fetch-site': 'cross-site' }, { origin: 'https://other.example', 'x-forwarded-host': 'other.example' }]) {
    assert.equal((await invoke(fixture.checkout, { body, headers })).status, 403);
  }
  for (const invalid of [{ ...body, quantity: 0 }, { ...body, quantity: 4 }, { ...body, quantity: '1' },
    { ...body, quantity: 1.5 }, { ...body, requestId: 'simple-id' }, { ...body, unitAmount: 1 },
    { ...body, currency: 'jpy' }, { ...body, price: 'price_other' }]) {
    assert.equal((await invoke(fixture.checkout, { body: invalid })).status, 400);
  }
  assert.equal((await invoke(fixture.checkout, { body, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await invoke(fixture.checkout, { raw: Buffer.alloc(4097, 32) })).status, 413);
  assert.equal((await invoke(fixture.checkout, { raw: Buffer.from([0xff]) })).status, 400);
  assert.equal((await fixture.db.listOrders()).length, 0);
  assert.equal(fixture.calls.filter(call => call[0] === 'create').length, 0);
});

test('persistent order precedes Checkout, parameters are server-controlled and capability stays private', async t => {
  const fixture = await setup(t);
  const result = await checkout(fixture, 2);
  const [, parameters, options] = fixture.calls.find(call => call[0] === 'create');
  assert.deepEqual(parameters.line_items, [{ price: ENV.STRIPE_PRICE_ID, quantity: 2 }]);
  assert.deepEqual(parameters.automatic_tax, { enabled: true });
  assert.equal(parameters.integration_identifier, INTEGRATION_IDENTIFIER);
  assert.match(parameters.integration_identifier, /[a-z]{8}$/);
  assert.equal(Object.hasOwn(parameters, 'payment_method_types'), false);
  assert.equal(Object.hasOwn(parameters, 'ui_mode'), false);
  assert.equal(Object.hasOwn(parameters, 'phone_number_collection'), false);
  assert.equal(Object.hasOwn(parameters, 'billing_address_collection'), false);
  assert.equal(options.idempotencyKey, `fabrevoie-checkout-${result.order.id}`);
  assert.match(result.token, /^[a-zA-Z0-9_-]{43}$/);
  assert.equal(JSON.stringify(result.order).includes(result.token), false);
  assert.deepEqual(Object.keys(result.response.body).sort(), ['ok', 'url']);
  const status = await invoke(fixture.orderStatus, { body: { token: result.token } });
  assert.equal(status.body.order.status, 'pending');
  assert.equal(status.body.order.amountTotal, null);
  assert.deepEqual(Object.keys(status.body.order).sort(), ['amountTotal', 'currency', 'dispatchNotice', 'mode', 'quantity', 'reference', 'status']);
});

test('simultaneous retries share one persisted order, one create lease and one Checkout URL', async t => {
  const fixture = await setup(t, { beforeCreate: () => new Promise(resolve => setTimeout(resolve, 100)) });
  const body = { quantity: 1, requestId: randomUUID() };
  const responses = await Promise.all(Array.from({ length: 6 }, () => invoke(fixture.checkout, { body })));
  assert.ok(responses.every(value => value.status === 200));
  assert.equal(new Set(responses.map(value => value.body.url)).size, 1);
  assert.equal(fixture.calls.filter(call => call[0] === 'create').length, 1);
  assert.equal((await fixture.db.listOrders()).length, 1);
  const mismatch = await invoke(fixture.checkout, { body: { ...body, quantity: 2 } });
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.code, 'CHECKOUT_RESTART_REQUIRED');
});

test('ambiguous Stripe failure retries the same order/key and leaks no provider details', async t => {
  let attempts = 0;
  const fixture = await setup(t, { beforeCreate() { if (++attempts === 1) throw new Error(`provider secret ${SECRET} buyer@example.test`); } });
  const body = { quantity: 1, requestId: randomUUID() };
  const failed = await invoke(fixture.checkout, { body });
  assert.equal(failed.status, 503);
  const succeeded = await invoke(fixture.checkout, { body });
  assert.equal(succeeded.status, 200);
  const calls = fixture.calls.filter(call => call[0] === 'create');
  assert.equal(calls.length, 2);
  assert.equal(calls[0][2].idempotencyKey, calls[1][2].idempotencyKey);
  assert.deepEqual(calls[0][1], calls[1][1]);
  assert.equal((await fixture.db.listOrders()).length, 1);
  assert.equal(JSON.stringify([failed.body, fixture.logs]).includes(SECRET), false);
  assert.equal(JSON.stringify([failed.body, fixture.logs]).includes('buyer@example.test'), false);
});

test('only a verified Stripe-hosted URL is returned', async t => {
  const fixture = await setup(t);
  fixture.stripe.checkout.sessions.create = async () => ({ id: 'cs_test_fixture', livemode: false, url: 'https://checkout.stripe.com.evil.example/c/pay/fake' });
  const response = await invoke(fixture.checkout, { body: { quantity: 1, requestId: randomUUID() } });
  assert.equal(response.status, 503);
  assert.equal(response.body.url, undefined);
});

test('checkout rate limits persist across storage instances and block new order creation', async t => {
  const fixture = await setup(t);
  const second = await createSqliteCommerceStorage(fixture.directory);
  try {
    for (let i = 0; i < 3; i += 1) assert.equal(await fixture.db.consume('fixture-client', 3, 60000, 1000), 0);
    assert.equal(await second.consume('fixture-client', 3, 60000, 1000), 60);
    assert.equal(await second.consume('fixture-client', 3, 60000, 61001), 0);
  } finally { await second.close(); }
  for (let i = 0; i < 12; i += 1) await checkout(fixture);
  const denied = await invoke(fixture.checkout, { body: { quantity: 1, requestId: randomUUID() } });
  assert.equal(denied.status, 429);
  assert.ok(Number(denied.headers['Retry-After']) > 0);
  assert.equal((await fixture.db.listOrders()).length, 12);
});

test('webhook verifies exact bytes, rejects altered/stale signatures and wrong mode', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  item.session.payment_status = 'paid';
  const valid = await webhook(fixture, item.session, 'checkout.session.completed', { id: 'evt_validraw' });
  assert.equal(valid.response.status, 200);
  const altered = await invoke(fixture.webhook, { raw: Buffer.concat([valid.raw, Buffer.from(' ')]), headers: { 'stripe-signature': valid.signature } });
  assert.equal(altered.status, 400);
  assert.equal((await webhook(fixture, item.session, 'checkout.session.completed', { timestamp: 1 })).response.status, 400);
  assert.equal((await webhook(fixture, item.session, 'checkout.session.completed', { livemode: true })).response.status, 400);
  assert.equal((await invoke(fixture.webhook, { raw: valid.raw })).status, 400);
  const oversized = Readable.from([Buffer.alloc(1048577)]); oversized.headers = {};
  await assert.rejects(readWebhookBody(oversized), { status: 413 });
});

test('unpaid completion stays processing; asynchronous verified payment advances exactly once', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  const unpaid = await webhook(fixture, item.session, 'checkout.session.completed', { created: 100 });
  assert.equal(unpaid.response.status, 200);
  assert.equal((await fixture.db.getOrder(item.order.id)).status, 'processing');
  item.session.payment_status = 'paid';
  const responses = await Promise.all(Array.from({ length: 5 }, () => webhook(fixture, item.session,
    'checkout.session.async_payment_succeeded', { id: 'evt_concurrentpayment', created: 200 })));
  assert.ok(responses.every(item => item.response.status === 200));
  const paid = await fixture.db.getOrder(item.order.id);
  assert.equal(paid.status, 'paid');
  assert.equal(paid.amount_total, 10500);
  assert.ok(paid.paid_at);
  assert.equal(paid.customer.email, 'buyer@example.test');
  assert.equal(paid.shipping.address.city, 'Fixture City');
  const status = await invoke(fixture.orderStatus, { body: { token: item.token } });
  assert.equal(JSON.stringify(status.body).includes('buyer@example.test'), false);
  assert.equal(JSON.stringify(status.body).includes('Fixture City'), false);
});

test('late unpaid failures and expiry cannot downgrade payment or refund states', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  item.session.payment_status = 'paid';
  assert.equal((await webhook(fixture, item.session, 'checkout.session.completed', { created: 200 })).response.status, 200);
  item.session.payment_status = 'unpaid';
  for (const type of ['checkout.session.async_payment_failed', 'checkout.session.expired']) {
    assert.equal((await webhook(fixture, item.session, type, { created: 300 })).response.status, 200);
    assert.equal((await fixture.db.getOrder(item.order.id)).status, 'paid');
  }
});

test('failed/expired unpaid sessions stay unfulfilled and old processing events do not revive them', async t => {
  const fixture = await setup(t);
  for (const [type, status] of [['checkout.session.async_payment_failed', 'payment_failed'], ['checkout.session.expired', 'expired']]) {
    const item = await checkout(fixture);
    assert.equal((await webhook(fixture, item.session, type, { created: 300 })).response.status, 200);
    assert.equal((await webhook(fixture, item.session, 'checkout.session.completed', { created: 100 })).response.status, 200);
    const order = await fixture.db.getOrder(item.order.id);
    assert.equal(order.status, status);
    assert.equal(order.paid_at, null);
    const restart = await invoke(fixture.checkout, { body: { quantity: 1, requestId: item.requestId } });
    assert.equal(restart.body.code, 'CHECKOUT_RESTART_REQUIRED');
  }
});

test('mismatched session Price, quantity, shipping destination or incomplete tax never marks paid', async t => {
  for (const change of [
    session => { session.line_items.data[0].price.id = 'price_wrong'; },
    session => { session.line_items.data[0].quantity = 9; },
    session => { session.currency = 'usd'; },
    session => { session.automatic_tax.status = 'failed'; },
    session => { session.collected_information.shipping_details.address.country = 'US'; },
  ]) {
    const fixture = await setup(t);
    const item = await checkout(fixture);
    item.session.payment_status = 'paid'; change(item.session);
    const result = await webhook(fixture, item.session);
    assert.equal(result.response.status, 503);
    assert.equal((await fixture.db.getOrder(item.order.id)).status, 'pending');
    assert.equal(await fixture.db.hasEvent(result.event.id), false);
  }
});

test('refund reconciliation counts only succeeded refunds and survives duplicate/out-of-order events', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  item.session.payment_status = 'paid';
  await webhook(fixture, item.session, 'checkout.session.completed', { created: 100 });
  const makeRefund = (id, amount, status) => ({ id, amount, status, currency: 'eur', payment_intent: item.session.payment_intent });
  fixture.state.refunds = [makeRefund('re_pending', 3000, 'pending'), makeRefund('re_failed', 500, 'failed')];
  assert.equal((await webhook(fixture, item.session, 'refund.created', { object: fixture.state.refunds[0], created: 200 })).response.status, 200);
  assert.equal((await fixture.db.getOrder(item.order.id)).status, 'paid');
  fixture.state.refunds[0].status = 'succeeded';
  assert.equal((await webhook(fixture, item.session, 'refund.updated', { object: fixture.state.refunds[0], created: 300 })).response.status, 200);
  assert.equal((await fixture.db.getOrder(item.order.id)).status, 'partially_refunded');
  assert.equal((await fixture.db.getOrder(item.order.id)).refunded_amount, 3000);
  fixture.state.refunds.push(makeRefund('re_remaining', 7500, 'succeeded'));
  const event = { id: 'evt_fullrefund', object: { id: 'ch_fixture', payment_intent: item.session.payment_intent }, created: 400 };
  await Promise.all([webhook(fixture, item.session, 'charge.refunded', event), webhook(fixture, item.session, 'charge.refunded', event)]);
  const order = await fixture.db.getOrder(item.order.id);
  assert.equal(order.status, 'refunded');
  assert.equal(order.refunded_amount, 10500);
  await webhook(fixture, item.session, 'checkout.session.completed', { created: 500 });
  assert.equal((await fixture.db.getOrder(item.order.id)).status, 'refunded');
});

test('refund arriving before payment webhook recovers the persisted intent from the Session', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  item.session.payment_status = 'paid';
  fixture.state.refunds = [{ id: 're_early', payment_intent: item.session.payment_intent, status: 'succeeded', amount: 10500, currency: 'eur' }];
  const result = await webhook(fixture, item.session, 'refund.updated', { object: fixture.state.refunds[0] });
  assert.equal(result.response.status, 200);
  assert.equal((await fixture.db.getOrder(item.order.id)).status, 'refunded');
});

test('bank-returned refunds replace the succeeded total instead of permanently locking refunded status', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  item.session.payment_status = 'paid';
  fixture.state.refunds = [{ id: 're_bankreturn', payment_intent: item.session.payment_intent, status: 'succeeded', amount: 10500, currency: 'eur' }];
  assert.equal((await webhook(fixture, item.session, 'refund.updated', { object: fixture.state.refunds[0], created: 500 })).response.status, 200);
  assert.equal((await fixture.db.getOrder(item.order.id)).status, 'refunded');
  fixture.state.refunds[0].status = 'requires_action';
  assert.equal((await webhook(fixture, item.session, 'refund.updated', { object: fixture.state.refunds[0], created: 600 })).response.status, 200);
  let order = await fixture.db.getOrder(item.order.id);
  assert.equal(order.status, 'paid');
  assert.equal(order.refunded_amount, 0);
  fixture.state.refunds[0].status = 'failed';
  // Even an old triggering event reconciles a fresh Stripe snapshot. Its created
  // timestamp does not override the snapshot's concurrency/version safeguard.
  assert.equal((await webhook(fixture, item.session, 'refund.failed', { object: fixture.state.refunds[0], created: 400 })).response.status, 200);
  order = await fixture.db.getOrder(item.order.id);
  assert.equal(order.status, 'paid');
  assert.equal(order.refunded_amount, 0);
  assert.equal(order.reconciliation_version, 3);
});

test('a stale reconciliation fails atomically without consuming its event, then retries a fresh snapshot', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  const update = { orderId: item.order.id, mode: 'test', sessionId: item.session.id,
    paymentIntentId: item.session.payment_intent, expectedVersion: item.order.reconciliation_version,
    paymentConfirmed: true, status: 'paid', amountTotal: 10500, refundedAmount: 0 };
  const event = { id: 'evt_firstversion', type: 'checkout.session.completed', created: 100 };
  await assert.rejects(fixture.db.applyEvent(event, { ...update, expectedVersion: undefined }), /version required/);
  await fixture.db.applyEvent(event, update);
  const lateEvent = { id: 'evt_staleversion', type: 'refund.updated', created: 100 };
  const stale = { ...update, refundedAmount: 10500,
    refunds: [{ id: 're_stale', status: 'succeeded', amount: 10500, currency: 'eur' }] };
  await assert.rejects(fixture.db.applyEvent(lateEvent, stale), /conflict/);
  assert.equal(await fixture.db.hasEvent(lateEvent.id), false);
  assert.equal((await fixture.db.getOrder(item.order.id)).refunded_amount, 0);
  const fresh = await fixture.db.getOrder(item.order.id);
  await fixture.db.applyEvent(lateEvent, { ...stale, expectedVersion: fresh.reconciliation_version });
  assert.equal((await fixture.db.getOrder(item.order.id)).status, 'refunded');
  assert.deepEqual(await fixture.db.applyEvent(lateEvent, stale), { applied: false });
});

test('old unsaved Checkout intents restart before Stripe minimum expiry, saved sessions remain resumable', async t => {
  const fixture = await setup(t, { beforeCreate() { throw new Error('Simulated network failure'); } });
  const body = { quantity: 1, requestId: randomUUID() };
  assert.equal((await invoke(fixture.checkout, { body })).status, 503);
  const later = Date.now() + 31 * 60000;
  const clock = t.mock.method(Date, 'now', () => later);
  const restart = await invoke(fixture.checkout, { body });
  assert.equal(restart.status, 409);
  assert.equal(restart.body.code, 'CHECKOUT_RESTART_REQUIRED');
  assert.equal(fixture.calls.filter(call => call[0] === 'create').length, 1);
  clock.mock.restore();
  const resumable = await setup(t);
  const item = await checkout(resumable);
  const nearExpiry = Date.now() + 45 * 60000;
  t.mock.method(Date, 'now', () => nearExpiry);
  const response = await invoke(resumable.checkout, { body: { quantity: 1, requestId: item.requestId } });
  assert.equal(response.status, 200);
  assert.equal(response.body.url, item.response.body.url);
});

test('disabling new sales preserves signed payment processing and private status lookup', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  fixture.env.COMMERCE_MODE = 'disabled';
  fixture.env.STRIPE_PRICE_ID = '';
  fixture.env.COMMERCE_DISPATCH_NOTICE = '';
  fixture.state.settings.status = 'pending';
  item.session.payment_status = 'paid';
  assert.equal((await invoke(fixture.commerce, { method: 'GET' })).body.available, false);
  assert.equal((await invoke(fixture.checkout, { body: { quantity: 1, requestId: randomUUID() } })).status, 503);
  assert.equal((await webhook(fixture, item.session)).response.status, 200);
  const result = await invoke(fixture.orderStatus, { body: { token: item.token } });
  assert.equal(result.status, 200);
  assert.equal(result.body.order.status, 'paid');
});

test('private order lookup does not trust a session id, return URL or a guessed token', async t => {
  const fixture = await setup(t);
  const item = await checkout(fixture);
  for (const body of [{ token: item.order.stripe_session_id }, { token: item.token, paid: true }, { session_id: item.order.stripe_session_id }]) {
    assert.equal((await invoke(fixture.orderStatus, { body })).status, 400);
  }
  assert.equal((await invoke(fixture.orderStatus, { body: { token: randomBytes(32).toString('base64url') } })).status, 404);
  assert.equal((await invoke(fixture.orderStatus, { body: { token: item.token }, method: 'GET' })).status, 405);
  assert.equal((await fixture.db.getOrder(item.order.id)).status, 'pending');
});
