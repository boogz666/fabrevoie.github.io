// Opt-in, isolated Neon inventory verification. No Stripe APIs or messages.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = 'Usage: node tests/inventory-cloud.mjs --cloud-write (with the intended DATABASE_URL in the environment).';
const QA_SKU = /^INVENTORY-QA-[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_CODES = new Set([
  'ERR_ASSERTION', 'INVENTORY_UNCONFIGURED', 'STOCK_UNAVAILABLE', 'OPERATION_CONFLICT',
  'STOCK_ADJUSTMENT_REJECTED', 'FULFILLMENT_TRANSITION_REJECTED', 'ALLOCATION_RESOLUTION_REJECTED',
  'INVALID_INVENTORY_INPUT', 'INVALID_FULFILLMENT_INPUT', 'INVALID_OPERATION',
  '23502', '23503', '23505', '23514', '40001', '40P01', '42P01', '42703',
  'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'
]);
const safeCode = error => SAFE_CODES.has(error?.code) ? error.code : 'UNEXPECTED';
const hash = value => createHash('sha256').update(value).digest('hex');

// A failed concurrent operation must not leave another write running while the
// finally block removes fixtures.
async function settledWrites(operations) {
  const results = await Promise.allSettled(operations);
  const failure = results.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results.map(result => result.value);
}

export async function runInventoryCloud({
  argv = process.argv.slice(2), env = process.env,
  loadNeon = () => import('@neondatabase/serverless'),
  loadStorage = () => import('../lib/commerce-storage.mjs'),
  log = console.log, errorLog = console.error
} = {}) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
    log(`${USAGE}\nCreates synthetic test-mode stock, orders and audit records, then removes only this run's records. Never calls Stripe or sends messages.`);
    return 0;
  }
  if (argv.length !== 1 || argv[0] !== '--cloud-write' || !env.DATABASE_URL) {
    errorLog(USAGE);
    return 1;
  }

  const runId = randomUUID();
  const compact = runId.replaceAll('-', '');
  const sku = `INVENTORY-QA-${runId.toUpperCase()}`;
  const scope = { mode: 'test', sku };
  const referencePrefix = `INVQA-${compact.toUpperCase()}-`;
  const ownedOrders = new Map();
  const ownedEvents = new Map();
  const operatorIds = new Set();
  const ownedRefunds = new Map();
  const eventTime = Math.floor(Date.now() / 1000);
  let eventCounter = 0;
  let stageName = 'initialize';
  let passed = 0;
  let failed = false;
  let sql;
  let storage;
  let cleanupNeeded = false;

  const operation = () => { const id = randomUUID(); operatorIds.add(id); return id; };
  function newOrder(label, quantity = 1) {
    const id = randomUUID();
    const created = Date.now();
    const reference = `${referencePrefix}${label}`;
    ownedOrders.set(id, reference);
    return {
      id, reference, request_hash: hash(`inventory-qa:request:${id}`),
      token_hash: hash(`inventory-qa:token:${id}`), client_hash: hash(`inventory-qa:client:${runId}`),
      mode: 'test', sku, price_id: 'price_inventoryqa', unit_amount: 12999, currency: 'eur', quantity,
      dispatch_notice: 'Synthetic inventory QA only; no purchase or physical shipment.',
      checkout_snapshot: { qa: true, qaRun: runId, origin: 'https://example.invalid', countries: ['FR'], shippingRateIds: [] },
      session_expires_at: created + 3600000, created_at: created, updated_at: created
    };
  }
  function newEvent(order, type) {
    eventCounter += 1;
    const event = { id: `evt_${compact}${eventCounter}`, type, created: eventTime + eventCounter };
    ownedEvents.set(event.id, order.id);
    return event;
  }
  function updateFor(order, changes = {}) {
    return {
      orderId: order.id, mode: 'test', sessionId: `cs_test_${order.id.replaceAll('-', '')}`,
      paymentIntentId: `pi_${order.id.replaceAll('-', '')}`, expectedVersion: order.reconciliation_version,
      status: 'processing', paymentConfirmed: false, amountTotal: order.unit_amount * order.quantity,
      taxAmount: 0, shippingAmount: 0, ...changes
    };
  }
  const shipping = { name: 'Synthetic QA Recipient', address: { line1: 'QA fixture only', city: 'Paris', postal_code: '75001', country: 'FR' } };
  async function apply(orderId, type, changes = {}) {
    const order = await storage.getOrder(orderId);
    const event = newEvent(order, type);
    await storage.applyEvent(event, updateFor(order, changes));
    return { event, order: await storage.getOrder(orderId) };
  }
  async function inventory(expected) {
    const actual = await storage.getInventory(scope);
    assert.equal(actual.mode, 'test');
    assert.equal(actual.sku, sku);
    for (const [key, value] of Object.entries(expected)) assert.equal(actual[key], value, `Inventory ${key}`);
    assert.equal(actual.available, actual.capacity - actual.held - actual.committed);
    assert.ok(actual.available >= 0, 'Inventory must never oversell');
    return actual;
  }
  async function audit() { return storage.listInventoryAudit({ ...scope, limit: 1000 }); }
  async function stage(name, run) {
    stageName = name;
    await run();
    passed += 1;
    log(`PASS inventory-cloud: ${name}.`);
  }

  // Every cleanup target is validated against exact generated IDs, SKU and mode.
  // There are no prefix-only DELETEs and no filesystem deletion.
  async function cleanup() {
    assert.ok(QA_SKU.test(sku));
    assert.equal(scope.mode, 'test');
    const ids = [...ownedOrders.keys()];
    assert.ok(ids.every(id => UUID.test(id)));
    const rows = await sql.query('SELECT id,reference,mode,sku FROM fabrevoie_commerce_orders WHERE sku=$1 OR id=ANY($2::text[])', [sku, ids]);
    for (const row of rows) {
      assert.equal(row.mode, 'test');
      assert.equal(row.sku, sku);
      assert.equal(row.reference, ownedOrders.get(row.id));
      assert.ok(row.reference.startsWith(referencePrefix));
    }
    const auditRows = await sql.query('SELECT operation_id,mode,sku,order_id FROM fabrevoie_commerce_inventory_audit WHERE sku=$1 OR order_id=ANY($2::text[])', [sku, ids]);
    const allowedAuditIds = new Set([...operatorIds, ...ids.map(id => `reserve:${id}`), ...[...ownedEvents.keys()].map(id => `${id}:stock`)]);
    for (const row of auditRows) {
      assert.equal(row.mode, 'test');
      assert.equal(row.sku, sku);
      assert.ok(allowedAuditIds.has(row.operation_id));
      assert.ok(row.order_id === null || ownedOrders.has(row.order_id));
    }
    const eventRows = await sql.query('SELECT event_id,order_id FROM fabrevoie_commerce_events WHERE order_id=ANY($1::text[]) OR event_id=ANY($2::text[])', [ids, [...ownedEvents.keys()]]);
    for (const row of eventRows) assert.equal(row.order_id, ownedEvents.get(row.event_id));
    const refundRows = await sql.query('SELECT refund_id,order_id FROM fabrevoie_commerce_refunds WHERE order_id=ANY($1::text[])', [ids]);
    for (const row of refundRows) assert.equal(row.order_id, ownedRefunds.get(row.refund_id));

    await sql.transaction([
      sql.query('DELETE FROM fabrevoie_commerce_inventory_audit WHERE mode=$1 AND sku=$2 AND operation_id=ANY($3::text[])', ['test', sku, [...allowedAuditIds]]),
      sql.query('DELETE FROM fabrevoie_commerce_refunds WHERE order_id=ANY($1::text[]) AND refund_id=ANY($2::text[])', [ids, [...ownedRefunds.keys()]]),
      sql.query('DELETE FROM fabrevoie_commerce_events WHERE order_id=ANY($1::text[]) AND event_id=ANY($2::text[])', [ids, [...ownedEvents.keys()]]),
      sql.query('DELETE FROM fabrevoie_commerce_orders WHERE id=ANY($1::text[]) AND mode=$2 AND sku=$3 AND reference=ANY($4::text[])', [ids, 'test', sku, [...ownedOrders.values()]]),
      sql.query('DELETE FROM fabrevoie_commerce_inventory WHERE mode=$1 AND sku=$2', ['test', sku])
    ], { fetchOptions: { signal: AbortSignal.timeout(10000) } });
    const [remaining] = await sql.query(`SELECT
      (SELECT COUNT(*) FROM fabrevoie_commerce_inventory WHERE mode=$1 AND sku=$2) AS inventory,
      (SELECT COUNT(*) FROM fabrevoie_commerce_inventory_audit WHERE mode=$1 AND sku=$2) AS audit,
      (SELECT COUNT(*) FROM fabrevoie_commerce_orders WHERE id=ANY($3::text[])) AS orders,
      (SELECT COUNT(*) FROM fabrevoie_commerce_events WHERE event_id=ANY($4::text[])) AS events,
      (SELECT COUNT(*) FROM fabrevoie_commerce_refunds WHERE refund_id=ANY($5::text[])) AS refunds`,
    ['test', sku, ids, [...ownedEvents.keys()], [...ownedRefunds.keys()]]);
    assert.ok(Object.values(remaining).every(value => Number(value) === 0), 'All owned QA records must be removed');
  }

  try {
    const [{ neon }, { createNeonCommerceStorage }] = await Promise.all([loadNeon(), loadStorage()]);
    sql = neon(env.DATABASE_URL);
    storage = await createNeonCommerceStorage(env.DATABASE_URL);
    // This read initializes the storage schema but creates no inventory rows.
    await inventory({ configured: false, capacity: 0, held: 0, committed: 0, available: 0 });
    cleanupNeeded = true;
    let primary;
    let blocker;
    let dispatchOrder;

    await stage('idempotent audited stock adjustment', async () => {
      const operationId = operation();
      const adjustment = { ...scope, delta: 1, reason: 'inventory_qa_seed', operationId };
      await settledWrites([storage.adjustInventory(adjustment), storage.adjustInventory(adjustment)]);
      await inventory({ configured: true, capacity: 1, held: 0, committed: 0, available: 1 });
      const entries = await audit();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].operation_id, operationId);
      assert.equal(entries[0].action, 'capacity_adjusted');
      assert.equal(entries[0].units, 1);
      await assert.rejects(storage.adjustInventory({ ...adjustment, delta: 2 }), error => error.code === 'OPERATION_CONFLICT');
      await inventory({ capacity: 1, available: 1 });
    });

    await stage('last unit concurrent checkouts reserve exactly once', async () => {
      const contenders = [newOrder('LAST-A'), newOrder('LAST-B')];
      const results = await Promise.allSettled(contenders.map(order => storage.createOrder(order)));
      const accepted = results.filter(result => result.status === 'fulfilled');
      const rejected = results.filter(result => result.status === 'rejected');
      assert.equal(accepted.length, 1);
      assert.equal(rejected.length, 1);
      assert.equal(rejected[0].reason.code, 'STOCK_UNAVAILABLE');
      primary = accepted[0].value;
      const saved = await Promise.all(contenders.map(order => storage.getOrder(order.id)));
      assert.equal(saved.filter(Boolean).length, 1);
      const duplicateIntent = { ...contenders.find(order => order.id === primary.id), ...newOrder('RETRY'), request_hash: primary.request_hash };
      const repeated = await storage.createOrder(duplicateIntent);
      assert.equal(repeated.id, primary.id);
      assert.equal(await storage.getOrder(duplicateIntent.id), null);
      await inventory({ capacity: 1, held: 1, committed: 0, available: 0 });
      const holds = await storage.listHeldOrders(scope);
      assert.deepEqual(holds.map(order => order.id), [primary.id]);
      assert.equal((await audit()).filter(entry => entry.action === 'allocation_held').length, 1);
    });

    await stage('stale reconciliation cannot release a hold or claim an event', async () => {
      const before = await storage.getOrder(primary.id);
      await apply(primary.id, 'checkout.session.completed');
      const event = newEvent(before, 'checkout.session.expired');
      const snapshot = await inventory({ held: 1, committed: 0, available: 0 });
      const auditBefore = await audit();
      await assert.rejects(storage.applyEvent(event, updateFor(before, { status: 'expired', inventoryAction: 'release' })));
      assert.equal(await storage.hasEvent(event.id), false);
      assert.deepEqual(await inventory({}), snapshot);
      assert.deepEqual(await audit(), auditBefore);
      assert.equal((await storage.getOrder(primary.id)).allocation_state, 'held');
    });

    await stage('verified unpaid expiry releases stock once', async () => {
      const order = await storage.getOrder(primary.id);
      const event = newEvent(order, 'checkout.session.expired');
      const update = updateFor(order, { status: 'expired', inventoryAction: 'release' });
      const result = await settledWrites([storage.applyEvent(event, update), storage.applyEvent(event, update)]);
      assert.equal(result.filter(value => value.applied).length, 1);
      assert.equal((await storage.getOrder(primary.id)).allocation_state, 'released');
      await inventory({ held: 0, committed: 0, available: 1 });
      assert.equal((await audit()).filter(entry => entry.action === 'allocation_released' && entry.order_id === primary.id).length, 1);
    });

    await stage('late paid after release records stock exception without overselling', async () => {
      blocker = await storage.createOrder(newOrder('BLOCKER'));
      await apply(primary.id, 'checkout.session.async_payment_succeeded', { status: 'paid', paymentConfirmed: true, shipping });
      const paid = await storage.getOrder(primary.id);
      assert.equal(paid.status, 'paid');
      assert.equal(paid.allocation_state, 'released');
      assert.equal(paid.fulfillment_status, 'needs_review');
      await inventory({ capacity: 1, held: 1, committed: 0, available: 0 });
      await assert.rejects(storage.setFulfillment({ orderId: paid.id, status: 'shipped', carrier: 'QA carrier', trackingNumber: 'QA-NOT-A-SHIPMENT', reason: 'inventory_qa_invalid_ship', operationId: operation() }), error => error.code === 'FULFILLMENT_TRANSITION_REJECTED');
      const auditBefore = await audit();
      await assert.rejects(storage.resolveAllocation({ orderId: paid.id, reason: 'inventory_qa_no_stock', operationId: operation() }), error => error.code === 'ALLOCATION_RESOLUTION_REJECTED');
      await inventory({ held: 1, committed: 0, available: 0 });
      assert.deepEqual(await audit(), auditBefore);
    });

    await stage('verified failed payment releases the competing hold', async () => {
      await apply(blocker.id, 'checkout.session.async_payment_failed', { status: 'payment_failed', inventoryAction: 'release' });
      assert.equal((await storage.getOrder(blocker.id)).allocation_state, 'released');
      await inventory({ capacity: 1, held: 0, committed: 0, available: 1 });
    });

    await stage('unpaid orders cannot be shipped', async () => {
      dispatchOrder = await storage.createOrder(newOrder('DISPATCH'));
      const before = await audit();
      await assert.rejects(storage.setFulfillment({ orderId: dispatchOrder.id, status: 'shipped', carrier: 'QA carrier', trackingNumber: 'QA-NOT-A-SHIPMENT', reason: 'inventory_qa_invalid_ship', operationId: operation() }), error => error.code === 'FULFILLMENT_TRANSITION_REJECTED');
      assert.equal((await storage.getOrder(dispatchOrder.id)).shipped_at, null);
      assert.deepEqual(await audit(), before);
      await inventory({ held: 1, committed: 0, available: 0 });
    });

    await stage('duplicate verified payment commits stock exactly once', async () => {
      const order = await storage.getOrder(dispatchOrder.id);
      const event = newEvent(order, 'checkout.session.completed');
      const update = updateFor(order, { status: 'paid', paymentConfirmed: true, shipping });
      const results = await settledWrites([storage.applyEvent(event, update), storage.applyEvent(event, update)]);
      assert.equal(results.filter(value => value.applied).length, 1);
      const paid = await storage.getOrder(order.id);
      assert.equal(paid.status, 'paid');
      assert.equal(paid.allocation_state, 'committed');
      assert.equal(paid.fulfillment_status, 'awaiting_dispatch');
      await inventory({ capacity: 1, held: 0, committed: 1, available: 0 });
      assert.equal((await audit()).filter(entry => entry.action === 'allocation_committed' && entry.order_id === order.id).length, 1);
    });

    await stage('paid shipment is audited and idempotent without stock changes', async () => {
      const before = await inventory({});
      const operationId = operation();
      const shipment = { orderId: dispatchOrder.id, status: 'shipped', carrier: 'QA carrier', trackingNumber: 'QA-NOT-A-SHIPMENT', trackingUrl: 'https://example.invalid/qa-tracking', reason: 'inventory_qa_dispatch', operationId };
      await settledWrites([storage.setFulfillment(shipment), storage.setFulfillment(shipment)]);
      const saved = await storage.getOrder(dispatchOrder.id);
      assert.equal(saved.fulfillment_status, 'shipped');
      assert.ok(saved.shipped_at > 0);
      assert.equal(saved.fulfillment_tracking_number, shipment.trackingNumber);
      assert.deepEqual(await inventory({}), before);
      assert.equal((await audit()).filter(entry => entry.operation_id === operationId).length, 1);
    });

    await stage('recording a physical return does not restock automatically', async () => {
      const before = await inventory({});
      const operationId = operation();
      const returned = { orderId: dispatchOrder.id, status: 'returned', reason: 'inventory_qa_return', operationId };
      await storage.setFulfillment(returned);
      await storage.setFulfillment(returned);
      const saved = await storage.getOrder(dispatchOrder.id);
      assert.equal(saved.fulfillment_status, 'returned');
      assert.equal(saved.allocation_state, 'committed');
      assert.ok(saved.returned_at >= saved.shipped_at);
      assert.deepEqual(await inventory({}), before);
      assert.equal((await audit()).filter(entry => entry.operation_id === operationId).length, 1);
    });

    await stage('refund and returned refund funds never auto-restock', async () => {
      const before = await inventory({});
      const refundId = `re_${compact}`;
      ownedRefunds.set(refundId, dispatchOrder.id);
      const refund = { id: refundId, status: 'succeeded', amount: 12999, currency: 'eur' };
      await apply(dispatchOrder.id, 'refund.updated', { status: 'paid', paymentConfirmed: true, refundedAmount: 12999, refunds: [refund], shipping });
      assert.equal((await storage.getOrder(dispatchOrder.id)).status, 'refunded');
      assert.deepEqual(await inventory({}), before);
      await apply(dispatchOrder.id, 'refund.failed', { status: 'paid', paymentConfirmed: true, refundedAmount: 0, refunds: [{ ...refund, status: 'failed' }], shipping });
      const order = await storage.getOrder(dispatchOrder.id);
      assert.equal(order.status, 'paid');
      assert.equal(order.fulfillment_status, 'returned');
      assert.equal(order.allocation_state, 'committed');
      assert.deepEqual(await inventory({}), before);
    });

    await stage('operator restock is explicit audited and cannot undercut allocations', async () => {
      const operationId = operation();
      const adjustment = { ...scope, delta: 1, reason: 'inventory_qa_return_restock', operationId };
      await storage.adjustInventory(adjustment);
      await storage.adjustInventory(adjustment);
      await inventory({ capacity: 2, held: 0, committed: 1, available: 1 });
      const entries = await audit();
      const entry = entries.find(value => value.operation_id === operationId);
      assert.equal(entry.reason, 'inventory_qa_return_restock');
      assert.equal(entry.units, 1);
      await assert.rejects(storage.adjustInventory({ ...scope, delta: -2, reason: 'inventory_qa_invalid_reduction', operationId: operation() }), error => error.code === 'STOCK_ADJUSTMENT_REJECTED');
      await inventory({ capacity: 2, held: 0, committed: 1, available: 1 });
      assert.deepEqual(await audit(), entries);
    });

    await stage('operator reacquires available stock for the paid exception exactly once', async () => {
      const before = await storage.getOrder(primary.id);
      const operationId = operation();
      const resolution = { orderId: primary.id, reason: 'inventory_qa_allocation_review', operationId };
      await settledWrites([storage.resolveAllocation(resolution), storage.resolveAllocation(resolution)]);
      const resolved = await storage.getOrder(primary.id);
      assert.equal(resolved.status, 'paid');
      assert.equal(resolved.allocation_state, 'committed');
      assert.equal(resolved.fulfillment_status, 'awaiting_dispatch');
      assert.equal(resolved.shipped_at, null);
      assert.equal(resolved.reconciliation_version, before.reconciliation_version + 1);
      await inventory({ capacity: 2, held: 0, committed: 2, available: 0 });
      const entries = await audit();
      const resolutionEntries = entries.filter(entry => entry.operation_id === operationId);
      assert.equal(resolutionEntries.length, 1);
      assert.equal(resolutionEntries[0].action, 'allocation_resolved');
      assert.equal(resolutionEntries[0].from_state, 'released');
      assert.equal(resolutionEntries[0].to_state, 'committed');
      assert.equal(resolutionEntries[0].units, 1);
      const stale = newEvent(before, 'checkout.session.async_payment_failed');
      await assert.rejects(storage.applyEvent(stale, updateFor(before, { status: 'payment_failed', inventoryAction: 'release' })));
      assert.equal(await storage.hasEvent(stale.id), false);
      await inventory({ capacity: 2, held: 0, committed: 2, available: 0 });
      assert.deepEqual(await audit(), entries);
    });

    await stage('definite creation rejection releases only the unattached same-worker hold', async () => {
      await storage.adjustInventory({ ...scope, delta: 1, reason: 'inventory_qa_rejection_seed', operationId: operation() });
      const rejectedOrder = await storage.createOrder(newOrder('CREATE-REJECTED'));
      const owner = randomUUID();
      assert.equal(await storage.claimCreation(rejectedOrder.id, owner), true);
      const before = await storage.getOrder(rejectedOrder.id);
      const auditBefore = await audit();
      const stockBefore = await inventory({ capacity: 3, held: 1, committed: 2, available: 0 });

      const wrongOwner = await storage.releaseFailedCreation({ orderId: rejectedOrder.id, owner: randomUUID(), operationId: operation() });
      assert.deepEqual(wrongOwner, { released: false });
      assert.deepEqual(await storage.getOrder(rejectedOrder.id), before);
      assert.deepEqual(await inventory({}), stockBefore);
      assert.deepEqual(await audit(), auditBefore);

      const operationId = operation();
      const rejection = { orderId: rejectedOrder.id, owner, operationId };
      const results = await settledWrites([storage.releaseFailedCreation(rejection), storage.releaseFailedCreation(rejection)]);
      assert.ok(results.every(result => result.released === true));
      const released = await storage.getOrder(rejectedOrder.id);
      assert.equal(released.status, 'payment_failed');
      assert.equal(released.allocation_state, 'released');
      assert.equal(released.stripe_session_id, null);
      assert.equal(released.creation_owner, null);
      assert.equal(released.creation_lease_until, 0);
      assert.equal(released.reconciliation_version, before.reconciliation_version + 1);
      await inventory({ capacity: 3, held: 0, committed: 2, available: 1 });
      const entries = (await audit()).filter(entry => entry.operation_id === operationId);
      assert.equal(entries.length, 1);
      assert.equal(entries[0].action, 'allocation_released');
      assert.equal(entries[0].reason, 'stripe_validation_rejected');
      assert.equal(entries[0].from_state, 'held');
      assert.equal(entries[0].to_state, 'released');
      assert.equal(entries[0].units, 1);

      const attachedOrder = await storage.createOrder(newOrder('CREATE-ATTACHED'));
      const attachedOwner = randomUUID();
      assert.equal(await storage.claimCreation(attachedOrder.id, attachedOwner), true);
      const session = { id: `cs_test_${attachedOrder.id.replaceAll('-', '')}`, url: `https://checkout.stripe.com/c/pay/inventory-qa-${compact}` };
      await storage.attachSession(attachedOrder.id, attachedOwner, session);
      const attachedBefore = await storage.getOrder(attachedOrder.id);
      const attachedAudit = await audit();
      assert.equal(attachedBefore.stripe_session_id, session.id);
      assert.deepEqual(await storage.releaseFailedCreation({ orderId: attachedOrder.id, owner: attachedOwner, operationId: operation() }), { released: false });
      assert.deepEqual(await storage.getOrder(attachedOrder.id), attachedBefore);
      await inventory({ capacity: 3, held: 1, committed: 2, available: 0 });
      assert.deepEqual(await audit(), attachedAudit);
      await assert.rejects(storage.releaseFailedCreation({ orderId: attachedOrder.id, owner: attachedOwner, operationId }), error => error.code === 'OPERATION_CONFLICT');
      assert.deepEqual(await storage.getOrder(attachedOrder.id), attachedBefore);
      assert.deepEqual(await audit(), attachedAudit);
    });

    await stage('operator reconciliation preserves Stripe chronology and later failure releases stock', async () => {
      await storage.adjustInventory({ ...scope, delta: 1, reason: 'inventory_qa_chronology_seed', operationId: operation() });
      const intent = await storage.createOrder(newOrder('CHRONOLOGY'));
      const { order: processing } = await apply(intent.id, 'checkout.session.completed');
      const watermark = processing.last_event_created;
      const operatorEvent = newEvent(processing, 'operator.checkout_reconciled');
      operatorEvent.created = watermark + 3600;
      const operatorUpdate = updateFor(processing);
      const initialStock = await inventory({ capacity: 4, held: 2, committed: 2, available: 0 });
      const auditBefore = await audit();
      await storage.applyEvent(operatorEvent, operatorUpdate);
      const reconciled = await storage.getOrder(intent.id);
      assert.equal(reconciled.last_event_created, watermark);
      assert.equal(reconciled.status, 'processing');
      assert.equal(reconciled.allocation_state, 'held');
      assert.deepEqual(await inventory({}), initialStock);
      assert.deepEqual(await audit(), auditBefore);

      const failure = newEvent(reconciled, 'checkout.session.async_payment_failed');
      assert.ok(failure.created > watermark && failure.created < operatorEvent.created);
      await storage.applyEvent(failure, updateFor(reconciled, { status: 'payment_failed', inventoryAction: 'release' }));
      const failedOrder = await storage.getOrder(intent.id);
      assert.equal(failedOrder.status, 'payment_failed');
      assert.equal(failedOrder.allocation_state, 'released');
      assert.equal(failedOrder.last_event_created, failure.created);
      const releasedStock = await inventory({ capacity: 4, held: 1, committed: 2, available: 1 });
      const releasedAudit = await audit();
      assert.equal(releasedAudit.filter(entry => entry.order_id === intent.id && entry.action === 'allocation_released').length, 1);

      assert.deepEqual(await storage.applyEvent(operatorEvent, operatorUpdate), { applied: false });
      const lateCompletion = newEvent(failedOrder, 'checkout.session.completed');
      lateCompletion.created = watermark;
      await storage.applyEvent(lateCompletion, updateFor(failedOrder));
      const finalOrder = await storage.getOrder(intent.id);
      assert.equal(finalOrder.status, 'payment_failed');
      assert.equal(finalOrder.allocation_state, 'released');
      assert.equal(finalOrder.last_event_created, failure.created);
      assert.deepEqual(await inventory({}), releasedStock);
      assert.deepEqual(await audit(), releasedAudit);
    });
  } catch (error) {
    failed = true;
    errorLog(`FAIL inventory-cloud at ${stageName}; code ${safeCode(error)}. Provider and assertion details withheld.`);
  } finally {
    if (cleanupNeeded && sql) {
      try { await cleanup(); log('PASS inventory-cloud: all owned QA records removed.'); }
      catch (error) {
        failed = true;
        errorLog(`FAIL inventory-cloud cleanup; code ${safeCode(error)}. No broad cleanup attempted. Private review target: ${sku}.`);
      }
    }
    try { await storage?.close?.(); } catch { failed = true; errorLog('FAIL inventory-cloud: storage close failed. Provider details withheld.'); }
  }
  if (!failed) log(`PASS: ${passed} actual Neon inventory scenarios. Synthetic database records only; no Stripe payment, email, carrier booking or shipment.`);
  return failed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runInventoryCloud(); }
  catch { console.error('Inventory cloud verification could not initialize. Provider details withheld.'); process.exitCode = 1; }
}
