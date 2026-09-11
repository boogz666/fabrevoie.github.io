import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { AUDIT, INVENTORY, PRODUCT_SKU, InventoryError, allocatedUnits, fingerprint,
  inventoryIdentity, inventoryMethods, inventorySchema, lockInventoryForOrder, orderInventoryColumns } from './commerce-inventory.mjs';

const ORDERS = 'fabrevoie_commerce_orders';
const EVENTS = 'fabrevoie_commerce_events';
const LIMITS = 'fabrevoie_commerce_rate_limits';
const REFUNDS = 'fabrevoie_commerce_refunds';

const schema = [
  `CREATE TABLE IF NOT EXISTS ${ORDERS} (
    id TEXT PRIMARY KEY, reference TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL UNIQUE, token_hash TEXT NOT NULL UNIQUE,
    client_hash TEXT NOT NULL, mode TEXT NOT NULL CHECK (mode IN ('test','live')),
    price_id TEXT NOT NULL, unit_amount BIGINT NOT NULL CHECK (unit_amount > 0),
    currency TEXT NOT NULL, quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 10),
    dispatch_notice TEXT NOT NULL, checkout_snapshot TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    stripe_session_id TEXT UNIQUE, stripe_payment_intent_id TEXT UNIQUE,
    checkout_url TEXT, session_expires_at BIGINT NOT NULL,
    creation_owner TEXT, creation_lease_until BIGINT NOT NULL DEFAULT 0,
    amount_total BIGINT, tax_amount BIGINT, shipping_amount BIGINT,
    refunded_amount BIGINT NOT NULL DEFAULT 0,
    customer_json TEXT, shipping_json TEXT,
    reconciliation_version BIGINT NOT NULL DEFAULT 0,
    last_event_created BIGINT NOT NULL DEFAULT 0,
    created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL, paid_at BIGINT
  )`,
  `CREATE TABLE IF NOT EXISTS ${EVENTS} (
    event_id TEXT PRIMARY KEY, order_id TEXT REFERENCES ${ORDERS}(id),
    type TEXT NOT NULL, stripe_created BIGINT NOT NULL,
    claim_nonce TEXT NOT NULL, processed_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${LIMITS} (
    client_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${REFUNDS} (
    refund_id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES ${ORDERS}(id),
    status TEXT NOT NULL, amount BIGINT NOT NULL, currency TEXT NOT NULL,
    last_event_created BIGINT NOT NULL, updated_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS fabrevoie_commerce_limit_expiry ON ${LIMITS}(expires_at)`,
  `CREATE INDEX IF NOT EXISTS fabrevoie_commerce_order_created ON ${ORDERS}(created_at)`,
];

function order(row) {
  if (!row) return null;
  const value = { ...row };
  for (const key of ['unit_amount', 'quantity', 'session_expires_at', 'creation_lease_until',
    'amount_total', 'tax_amount', 'shipping_amount', 'refunded_amount', 'last_event_created',
    'created_at', 'updated_at', 'paid_at', 'reconciliation_version', 'shipped_at', 'returned_at']) {
    if (value[key] !== null && value[key] !== undefined) value[key] = Number(value[key]);
  }
  value.checkout_snapshot = JSON.parse(value.checkout_snapshot);
  value.customer = value.customer_json ? JSON.parse(value.customer_json) : null;
  value.shipping = value.shipping_json ? JSON.parse(value.shipping_json) : null;
  delete value.customer_json;
  delete value.shipping_json;
  return value;
}

function storageFromDriver(driver) {
  const one = async (field, value) => order((await driver.query(`SELECT * FROM ${ORDERS} WHERE ${field} = $1`, [value]))[0]);
  return {
    ...inventoryMethods(driver, id => one('id', id)),
    getOrder: id => one('id', id),
    getByRequestHash: hash => one('request_hash', hash),
    getByTokenHash: hash => one('token_hash', hash),
    getBySession: id => one('stripe_session_id', id),
    getByPaymentIntent: id => one('stripe_payment_intent_id', id),

    async consume(key, limit, windowMs, now = Date.now()) {
      const [, rows] = await driver.transaction([
        [`DELETE FROM ${LIMITS} WHERE expires_at < $1`, [now - 3600000]],
        [`INSERT INTO ${LIMITS} (client_hash, attempts, expires_at) VALUES ($1, 1, $2)
          ON CONFLICT (client_hash) DO UPDATE SET
            attempts = CASE WHEN ${LIMITS}.expires_at <= $3 THEN 1
              WHEN ${LIMITS}.attempts < $4 THEN ${LIMITS}.attempts + 1 ELSE $4 END,
            expires_at = CASE WHEN ${LIMITS}.expires_at <= $3 THEN $2 ELSE ${LIMITS}.expires_at END
          RETURNING attempts, expires_at`, [key, now + windowMs, now, limit + 1]],
      ]);
      return Number(rows[0].attempts) > limit ? Math.max(1, Math.ceil((Number(rows[0].expires_at) - now) / 1000)) : 0;
    },

    async createOrder(value) {
      value = { ...value, sku: value.sku ?? PRODUCT_SKU, allocation_state: 'held' };
      inventoryIdentity(value.mode, value.sku);
      const fields = ['id', 'reference', 'request_hash', 'token_hash', 'client_hash', 'mode',
        'price_id', 'unit_amount', 'currency', 'quantity', 'dispatch_notice', 'checkout_snapshot',
        'session_expires_at', 'created_at', 'updated_at', 'sku', 'allocation_state'];
      const values = fields.map(key => key === 'checkout_snapshot' ? JSON.stringify(value[key]) : value[key]);
      const [, , , rows] = await driver.transaction([
        [`SELECT mode FROM ${INVENTORY} WHERE mode = $1 AND sku = $2 FOR UPDATE`, [value.mode, value.sku]],
        [`INSERT INTO ${ORDERS} (${fields.join(',')}) SELECT ${fields.map((_, i) => `$${i + 1}`).join(',')}
          FROM ${INVENTORY} WHERE mode = $6 AND sku = $16 AND configured = 1
            AND capacity - ${allocatedUnits('$6', '$16')} >= CAST($10 AS INTEGER)
          ON CONFLICT (request_hash) DO NOTHING`, values],
        [`INSERT INTO ${AUDIT} (operation_id,operation_hash,claim_nonce,mode,sku,order_id,action,reason,units,from_state,to_state,created_at)
          SELECT $2,$3,$4,mode,sku,id,'allocation_held','checkout_reservation',quantity,'unallocated','held',$5
          FROM ${ORDERS} WHERE id = $1 AND allocation_state = 'held' ON CONFLICT (operation_id) DO NOTHING`,
        [value.id, `reserve:${value.id}`, fingerprint({ orderId: value.id, mode: value.mode, sku: value.sku, quantity: value.quantity }), randomUUID(), Date.now()]],
        [`SELECT * FROM ${ORDERS} WHERE request_hash = $1`, [value.request_hash]],
      ]);
      const result = order(rows[0]);
      if (!result) {
        const inventory = await this.getInventory({ mode: value.mode, sku: value.sku });
        throw new InventoryError(inventory.configured ? 'STOCK_UNAVAILABLE' : 'INVENTORY_UNCONFIGURED', 'This selection is not available for purchase.');
      }
      if (result.mode !== value.mode || result.sku !== value.sku || result.quantity !== value.quantity
        || result.price_id !== value.price_id || result.unit_amount !== value.unit_amount) {
        throw new InventoryError('OPERATION_CONFLICT', 'This checkout request already has a different selection.');
      }
      return result;
    },

    async claimCreation(id, owner, now = Date.now()) {
      const rows = await driver.query(`UPDATE ${ORDERS} SET creation_owner = $2, creation_lease_until = $3
        WHERE id = $1 AND stripe_session_id IS NULL AND creation_lease_until <= $4
        AND session_expires_at > $4 AND status = 'pending' AND allocation_state = 'held' RETURNING id`, [id, owner, now + 45000, now]);
      return rows.length === 1;
    },

    async releaseCreation(id, owner) {
      await driver.query(`UPDATE ${ORDERS} SET creation_owner = NULL, creation_lease_until = 0
        WHERE id = $1 AND creation_owner = $2`, [id, owner]);
    },

    async attachSession(id, owner, session) {
      const rows = await driver.query(`UPDATE ${ORDERS} SET stripe_session_id = $3,
        checkout_url = $4, creation_owner = NULL, creation_lease_until = 0, updated_at = $5
        WHERE id = $1 AND creation_owner = $2
          AND (stripe_session_id IS NULL OR stripe_session_id = $3) RETURNING *`,
      [id, owner, session.id, session.url, Date.now()]);
      if (!rows.length) throw new Error('Checkout attachment conflict');
      return order(rows[0]);
    },

    async ignoreEvent(event) {
      await driver.query(`INSERT INTO ${EVENTS} (event_id, order_id, type, stripe_created, claim_nonce, processed_at)
        VALUES ($1, NULL, $2, $3, $4, $5) ON CONFLICT (event_id) DO NOTHING`,
      [event.id, event.type, event.created, randomUUID(), Date.now()]);
    },

    async hasEvent(id) {
      return (await driver.query(`SELECT event_id FROM ${EVENTS} WHERE event_id = $1`, [id])).length > 0;
    },
    async getEvent(id) {
      return (await driver.query(`SELECT event_id,order_id,type,stripe_created FROM ${EVENTS} WHERE event_id = $1`, [id]))[0] ?? null;
    },

    async applyEvent(event, update) {
      if (!Number.isSafeInteger(update.expectedVersion) || update.expectedVersion < 0) {
        throw new Error('Order snapshot version required');
      }
      // A transaction-scoped row lock plus a unique event claim makes the update
      // atomic across processes. A duplicate cannot reuse this invocation's nonce.
      const nonce = randomUUID();
      const now = Date.now();
      const predicate = `id = $1 AND mode = $2 AND (stripe_session_id IS NULL OR stripe_session_id = $3)
        AND reconciliation_version = CAST($4 AS BIGINT)`;
      const identity = [update.orderId, update.mode, update.sessionId, update.expectedVersion];
      const refundTotal = '(CASE WHEN $16 = 1 THEN $4 ELSE refunded_amount END)';
      // Operator snapshots are current reads, but their wall-clock timestamp is
      // not a Stripe event timestamp. Advancing the Stripe watermark with it
      // would suppress a delayed, valid async-failure webhook and strand stock.
      const internalReconciliation = event.type === 'operator.checkout_reconciled';
      const stripeEventTime = '(CASE WHEN $18 = 1 THEN last_event_created ELSE $7 END)';
      const allocation = `(CASE WHEN allocation_state = 'held' AND $6 = 1 THEN 'committed'
        WHEN allocation_state = 'held' AND $17 = 1 AND paid_at IS NULL AND ${stripeEventTime} >= last_event_created
          THEN 'released' ELSE allocation_state END)`;
      const eventValues = [update.orderId, update.sessionId, update.paymentIntentId ?? null, update.refundedAmount ?? 0,
        update.amountTotal ?? null, update.paymentConfirmed ? 1 : 0, event.created, update.status,
        update.taxAmount ?? null, update.shippingAmount ?? null,
        update.customer ? JSON.stringify(update.customer) : null,
        update.shipping ? JSON.stringify(update.shipping) : null,
        now, event.id, nonce, Array.isArray(update.refunds) ? 1 : 0,
        update.inventoryAction === 'release' && !update.paymentConfirmed ? 1 : 0, internalReconciliation ? 1 : 0];
      const auditAllocation = `(CASE WHEN allocation_state = 'held' AND $6 = 1 THEN 'committed'
        WHEN allocation_state = 'held' AND $8 = 1 AND paid_at IS NULL
          AND (CASE WHEN $9 = 1 THEN last_event_created ELSE $7 END) >= last_event_created
          THEN 'released' ELSE allocation_state END)`;
      const [, , inserted, , changed] = await driver.transaction([
        lockInventoryForOrder(update.orderId),
        [`SELECT id FROM ${ORDERS} WHERE ${predicate} FOR UPDATE`, identity],
        [`INSERT INTO ${EVENTS} (event_id, order_id, type, stripe_created, claim_nonce, processed_at)
          SELECT $5, id, $6, $7, $8, $9 FROM ${ORDERS} WHERE ${predicate}
          ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
        [...identity, event.id, event.type, event.created, nonce, now]],
        [`INSERT INTO ${AUDIT} (operation_id,operation_hash,claim_nonce,mode,sku,order_id,action,reason,units,from_state,to_state,created_at)
          SELECT $2 || ':stock',$4,$3,mode,sku,id,
            CASE WHEN $6 = 1 THEN 'allocation_committed' ELSE 'allocation_released' END,
            CASE WHEN $6 = 1 THEN 'verified_payment' ELSE 'verified_terminal_unpaid' END,
            quantity,allocation_state,${auditAllocation},$5 FROM ${ORDERS}
          WHERE id = $1 AND allocation_state <> ${auditAllocation}
            AND EXISTS (SELECT 1 FROM ${EVENTS} WHERE event_id = $2 AND claim_nonce = $3)
          ON CONFLICT (operation_id) DO NOTHING`,
        [update.orderId, event.id, nonce, fingerprint({ eventId: event.id, orderId: update.orderId }), now,
          update.paymentConfirmed ? 1 : 0, event.created, update.inventoryAction === 'release' && !update.paymentConfirmed ? 1 : 0,
          internalReconciliation ? 1 : 0]],
        [`UPDATE ${ORDERS} SET
          stripe_session_id = $2,
          stripe_payment_intent_id = COALESCE($3, stripe_payment_intent_id),
          status = CASE
            WHEN ${refundTotal} > 0 THEN CASE
              WHEN ${refundTotal} >= COALESCE($5, amount_total)
                THEN 'refunded' ELSE 'partially_refunded' END
            WHEN paid_at IS NOT NULL OR $6 = 1 THEN 'paid'
            WHEN ${stripeEventTime} >= last_event_created THEN $8 ELSE status END,
          refunded_amount = ${refundTotal},
          allocation_state = ${allocation},
          fulfillment_status = CASE
            WHEN fulfillment_status IN ('shipped','returned') THEN fulfillment_status
            WHEN paid_at IS NOT NULL OR $6 = 1 THEN CASE
              WHEN ${refundTotal} > 0 OR ${allocation} <> 'committed' OR fulfillment_status = 'needs_review'
                THEN 'needs_review' ELSE COALESCE(fulfillment_status,'awaiting_dispatch') END
            ELSE fulfillment_status END,
          amount_total = COALESCE($5, amount_total),
          tax_amount = COALESCE($9, tax_amount), shipping_amount = COALESCE($10, shipping_amount),
          customer_json = COALESCE($11, customer_json), shipping_json = COALESCE($12, shipping_json),
          paid_at = COALESCE(paid_at, CASE WHEN $6 = 1 THEN CAST($13 AS BIGINT) ELSE NULL END),
          last_event_created = CASE WHEN $18 = 1 OR last_event_created > $7 THEN last_event_created ELSE $7 END,
          reconciliation_version = reconciliation_version + 1,
          updated_at = $13
          WHERE id = $1 AND EXISTS (SELECT 1 FROM ${EVENTS} WHERE event_id = $14 AND claim_nonce = $15)
          RETURNING id`,
        eventValues],
        ...(update.refunds ?? []).map(refund => [
          `INSERT INTO ${REFUNDS} (refund_id, order_id, status, amount, currency, last_event_created, updated_at)
            SELECT $1, $2, $3, $4, $5, $6, $7
            WHERE EXISTS (SELECT 1 FROM ${EVENTS} WHERE event_id = $8 AND claim_nonce = $9)
            ON CONFLICT (refund_id) DO UPDATE SET
              status = $3, last_event_created = $6,
              updated_at = $7`,
          [refund.id, update.orderId, refund.status, refund.amount, refund.currency, event.created, now, event.id, nonce],
        ]),
      ]);
      if (inserted.length && !changed.length) throw new Error('Order event update failed');
      if (!inserted.length) {
        const recorded = await this.getEvent(event.id);
        if (!recorded || recorded.order_id !== update.orderId || recorded.type !== event.type) throw new Error('Order event identity conflict');
      }
      return { applied: inserted.length === 1 };
    },

    // Private operator use only; never expose this method from a public route.
    async listOrders({ limit = 1000, before = Number.MAX_SAFE_INTEGER } = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('Invalid export limit');
      return (await driver.query(`SELECT * FROM ${ORDERS} WHERE created_at < $1 ORDER BY created_at DESC LIMIT $2`, [before, limit])).map(order);
    },
    close: () => driver.close?.(),
  };
}

/** Local orders use a separate file, never the consented waitlist database. */
export async function createSqliteCommerceStorage(dataDir) {
  if (!dataDir) throw new Error('Commerce data directory required');
  await mkdir(dataDir, { recursive: true });
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(path.join(dataDir, 'commerce.sqlite'));
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  for (const statement of schema) database.exec(statement);
  if (!database.prepare(`PRAGMA table_info(${ORDERS})`).all().some(column => column.name === 'reconciliation_version')) {
    database.exec(`ALTER TABLE ${ORDERS} ADD COLUMN reconciliation_version BIGINT NOT NULL DEFAULT 0`);
  }
  const existingColumns = new Set(database.prepare(`PRAGMA table_info(${ORDERS})`).all().map(column => column.name));
  for (const [name, type] of Object.entries(orderInventoryColumns)) {
    if (!existingColumns.has(name)) database.exec(`ALTER TABLE ${ORDERS} ADD COLUMN ${name} ${type}`);
  }
  for (const statement of inventorySchema) database.exec(statement);
  database.exec(`UPDATE ${ORDERS} SET fulfillment_status = 'needs_review', reconciliation_version = reconciliation_version + 1
    WHERE paid_at IS NOT NULL AND allocation_state = 'unallocated' AND fulfillment_status IS NULL`);
  function query(text, values = []) {
    const bindings = [];
    const sql = text.replace(/ FOR UPDATE\b/g, '').replace(/\$(\d+)/g, (_, index) => {
      bindings.push(values[Number(index) - 1]);
      return '?';
    });
    return database.prepare(sql).all(...bindings);
  }
  return storageFromDriver({
    query: async (text, values) => query(text, values),
    async transaction(statements) {
      database.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(([text, values]) => query(text, values));
        database.exec('COMMIT');
        return results;
      } catch (error) { database.exec('ROLLBACK'); throw error; }
    },
    close: () => database.close(),
  });
}

/** HTTP transactions are supported by Neon without a long-lived connection. */
export async function createNeonCommerceStorage(databaseUrl) {
  if (!databaseUrl) throw new Error('Commerce storage unavailable');
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(databaseUrl);
  let initialized;
  async function initialize() {
    if (!initialized) initialized = sql.transaction([
      sql`SELECT pg_advisory_xact_lock(683177500)`,
      ...schema.map(text => sql.query(text, [])),
      sql.query(`ALTER TABLE ${ORDERS} ADD COLUMN IF NOT EXISTS reconciliation_version BIGINT NOT NULL DEFAULT 0`, []),
      ...Object.entries(orderInventoryColumns).map(([name, type]) => sql.query(`ALTER TABLE ${ORDERS} ADD COLUMN IF NOT EXISTS ${name} ${type}`, [])),
      ...inventorySchema.map(text => sql.query(text, [])),
      sql.query(`UPDATE ${ORDERS} SET fulfillment_status = 'needs_review', reconciliation_version = reconciliation_version + 1
        WHERE paid_at IS NOT NULL AND allocation_state = 'unallocated' AND fulfillment_status IS NULL`, []),
    ], { fetchOptions: { signal: AbortSignal.timeout(8000) } }).catch(error => {
      initialized = undefined;
      throw error;
    });
    await initialized;
  }
  return storageFromDriver({
    async query(text, values = []) {
      await initialize();
      return sql.query(text, values, { fetchOptions: { signal: AbortSignal.timeout(8000) } });
    },
    async transaction(statements) {
      await initialize();
      return sql.transaction(statements.map(([text, values]) => sql.query(text, values)),
        { fetchOptions: { signal: AbortSignal.timeout(10000) } });
    },
  });
}
