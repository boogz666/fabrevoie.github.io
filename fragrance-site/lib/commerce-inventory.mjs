import { createHash, randomUUID } from 'node:crypto';

export const PRODUCT_SKU = 'ULTRAMACHO-100ML-IRIS';
export const INVENTORY = 'fabrevoie_commerce_inventory';
export const AUDIT = 'fabrevoie_commerce_inventory_audit';
const ORDERS = 'fabrevoie_commerce_orders';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InventoryError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export function validSku(sku) { return typeof sku === 'string' && /^[A-Z0-9][A-Z0-9._-]{2,79}$/.test(sku); }

export function inventoryIdentity(mode, sku) {
  if (!['test', 'live'].includes(mode) || !validSku(sku)) throw new InventoryError('INVALID_INVENTORY_INPUT', 'A valid mode and SKU are required.');
}

export function operation(value) {
  if (!UUID.test(value.operationId ?? '') || typeof value.reason !== 'string' || !/^[a-z][a-z0-9_-]{2,63}$/.test(value.reason)) {
    throw new InventoryError('INVALID_OPERATION', 'Use a UUID operation ID and a non-personal reason code.');
  }
  return value.operationId.toLowerCase();
}

export function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }

export const inventorySchema = [
  `CREATE TABLE IF NOT EXISTS ${INVENTORY} (
    mode TEXT NOT NULL CHECK (mode IN ('test','live')), sku TEXT NOT NULL,
    configured INTEGER NOT NULL DEFAULT 0 CHECK (configured IN (0,1)),
    capacity BIGINT NOT NULL DEFAULT 0 CHECK (capacity >= 0), updated_at BIGINT NOT NULL,
    PRIMARY KEY(mode, sku)
  )`,
  `CREATE TABLE IF NOT EXISTS ${AUDIT} (
    operation_id TEXT PRIMARY KEY, operation_hash TEXT NOT NULL, claim_nonce TEXT NOT NULL,
    mode TEXT NOT NULL, sku TEXT NOT NULL, order_id TEXT REFERENCES ${ORDERS}(id),
    action TEXT NOT NULL, reason TEXT NOT NULL, units BIGINT NOT NULL,
    from_state TEXT, to_state TEXT, created_at BIGINT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS fabrevoie_commerce_inventory_audit_time ON ${AUDIT}(mode,sku,created_at)`,
];

export const orderInventoryColumns = {
  sku: `TEXT NOT NULL DEFAULT '${PRODUCT_SKU}'`,
  allocation_state: "TEXT NOT NULL DEFAULT 'unallocated'",
  fulfillment_status: 'TEXT',
  fulfillment_carrier: 'TEXT',
  fulfillment_tracking_number: 'TEXT',
  fulfillment_tracking_url: 'TEXT',
  shipped_at: 'BIGINT', returned_at: 'BIGINT',
};

export const allocatedUnits = (mode = '$1', sku = '$2') => `(SELECT COALESCE(SUM(quantity),0) FROM ${ORDERS}
  WHERE mode = ${mode} AND sku = ${sku} AND allocation_state IN ('held','committed'))`;

// Every transaction touching inventory and orders locks inventory first. SKU and
// mode are immutable on an order, so the lookup itself needs no order lock.
export const lockInventoryForOrder = id => [`SELECT mode FROM ${INVENTORY}
  WHERE (mode,sku) = (SELECT mode,sku FROM ${ORDERS} WHERE id = $1) FOR UPDATE`, [id]];

function inventory(row, mode, sku) {
  return row ? { mode, sku, configured: Number(row.configured) === 1,
    capacity: Number(row.capacity), held: Number(row.held), committed: Number(row.committed),
    available: Number(row.capacity) - Number(row.held) - Number(row.committed) }
    : { mode, sku, configured: false, capacity: 0, held: 0, committed: 0, available: 0 };
}

export function inventoryMethods(driver, getOrder) {
  const getAudit = async id => (await driver.query(`SELECT * FROM ${AUDIT} WHERE operation_id = $1`, [id]))[0];
  function checkRepeat(row, expected) {
    if (row && row.operation_hash !== expected) throw new InventoryError('OPERATION_CONFLICT', 'This operation ID was already used with different parameters.');
    return Boolean(row);
  }
  const methods = {
    async getInventory({ mode, sku = PRODUCT_SKU }) {
      inventoryIdentity(mode, sku);
      const rows = await driver.query(`SELECT i.mode,i.sku,i.configured,i.capacity,
        COALESCE(SUM(CASE WHEN o.allocation_state = 'held' THEN o.quantity ELSE 0 END),0) AS held,
        COALESCE(SUM(CASE WHEN o.allocation_state = 'committed' THEN o.quantity ELSE 0 END),0) AS committed
        FROM ${INVENTORY} i LEFT JOIN ${ORDERS} o ON o.mode = i.mode AND o.sku = i.sku
        WHERE i.mode = $1 AND i.sku = $2 GROUP BY i.mode,i.sku,i.configured,i.capacity`, [mode, sku]);
      return inventory(rows[0], mode, sku);
    },

    async adjustInventory({ mode, sku = PRODUCT_SKU, delta, reason, operationId }) {
      inventoryIdentity(mode, sku);
      operationId = operation({ operationId, reason });
      if (!Number.isSafeInteger(delta) || Math.abs(delta) > 1000000) throw new InventoryError('INVALID_INVENTORY_INPUT', 'Stock adjustments must be whole units within the allowed range.');
      const digest = fingerprint({ action: 'capacity_adjusted', mode, sku, delta, reason });
      if (checkRepeat(await getAudit(operationId), digest)) return methods.getInventory({ mode, sku });
      const nonce = randomUUID();
      const now = Date.now();
      await driver.transaction([
        [`INSERT INTO ${INVENTORY} (mode,sku,configured,capacity,updated_at) VALUES ($1,$2,0,0,$3)
          ON CONFLICT (mode,sku) DO NOTHING`, [mode, sku, now]],
        [`SELECT mode FROM ${INVENTORY} WHERE mode = $1 AND sku = $2 FOR UPDATE`, [mode, sku]],
        [`INSERT INTO ${AUDIT} (operation_id,operation_hash,claim_nonce,mode,sku,order_id,action,reason,units,created_at)
          SELECT $3,$4,$5,mode,sku,NULL,'capacity_adjusted',$6,$7,$8 FROM ${INVENTORY}
          WHERE mode = $1 AND sku = $2 AND capacity + $7 >= ${allocatedUnits()} AND capacity + $7 BETWEEN 0 AND 1000000000
          ON CONFLICT (operation_id) DO NOTHING`, [mode, sku, operationId, digest, nonce, reason, delta, now]],
        [`UPDATE ${INVENTORY} SET capacity = capacity + $3, configured = 1, updated_at = $4
          WHERE mode = $1 AND sku = $2 AND EXISTS (SELECT 1 FROM ${AUDIT} WHERE operation_id = $5 AND claim_nonce = $6)`,
        [mode, sku, delta, now, operationId, nonce]],
      ]);
      const recorded = await getAudit(operationId);
      if (!recorded) throw new InventoryError('STOCK_ADJUSTMENT_REJECTED', 'The adjustment would leave fewer units than existing allocations.');
      checkRepeat(recorded, digest);
      return methods.getInventory({ mode, sku });
    },

    async listInventoryAudit({ mode, sku = PRODUCT_SKU, limit = 100 } = {}) {
      inventoryIdentity(mode, sku);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new InventoryError('INVALID_INVENTORY_INPUT', 'Invalid audit limit.');
      const rows = await driver.query(`SELECT operation_id,mode,sku,order_id,action,reason,units,from_state,to_state,created_at
        FROM ${AUDIT} WHERE mode = $1 AND sku = $2 ORDER BY created_at DESC,operation_id DESC LIMIT $3`, [mode, sku, limit]);
      return rows.map(row => ({ ...row, units: Number(row.units), created_at: Number(row.created_at) }));
    },

    async listHeldOrders({ mode, sku = PRODUCT_SKU, limit = 100 } = {}) {
      inventoryIdentity(mode, sku);
      if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new InventoryError('INVALID_INVENTORY_INPUT', 'Invalid hold limit.');
      const rows = await driver.query(`SELECT id FROM ${ORDERS} WHERE mode = $1 AND sku = $2 AND allocation_state = 'held'
        ORDER BY created_at ASC LIMIT $3`, [mode, sku, limit]);
      return Promise.all(rows.map(row => getOrder(row.id)));
    },

    async resolveAllocation({ orderId, reason, operationId }) {
      operationId = operation({ operationId, reason });
      if (!UUID.test(orderId ?? '')) throw new InventoryError('INVALID_INVENTORY_INPUT', 'A valid order is required.');
      const digest = fingerprint({ action: 'allocation_resolved', orderId, reason });
      if (checkRepeat(await getAudit(operationId), digest)) return getOrder(orderId);
      const nonce = randomUUID();
      const now = Date.now();
      await driver.transaction([
        lockInventoryForOrder(orderId),
        [`SELECT id FROM ${ORDERS} WHERE id = $1 FOR UPDATE`, [orderId]],
        [`INSERT INTO ${AUDIT} (operation_id,operation_hash,claim_nonce,mode,sku,order_id,action,reason,units,from_state,to_state,created_at)
          SELECT $2,$3,$4,o.mode,o.sku,o.id,'allocation_resolved',$5,o.quantity,o.allocation_state,'committed',$6
          FROM ${ORDERS} o JOIN ${INVENTORY} i ON i.mode = o.mode AND i.sku = o.sku
          WHERE o.id = $1 AND o.status = 'paid' AND o.paid_at IS NOT NULL AND o.refunded_amount = 0
            AND o.shipped_at IS NULL AND o.returned_at IS NULL AND o.allocation_state IN ('released','unallocated')
            AND (o.fulfillment_status IS NULL OR o.fulfillment_status = 'needs_review') AND i.configured = 1
            AND i.capacity - (SELECT COALESCE(SUM(allocated.quantity),0) FROM ${ORDERS} allocated
              WHERE allocated.mode = o.mode AND allocated.sku = o.sku AND allocated.allocation_state IN ('held','committed')) >= o.quantity
          ON CONFLICT (operation_id) DO NOTHING`, [orderId, operationId, digest, nonce, reason, now]],
        [`UPDATE ${ORDERS} SET allocation_state = 'committed', fulfillment_status = 'awaiting_dispatch',
          reconciliation_version = reconciliation_version + 1, updated_at = $2
          WHERE id = $1 AND EXISTS (SELECT 1 FROM ${AUDIT} WHERE operation_id = $3 AND claim_nonce = $4)`,
        [orderId, now, operationId, nonce]],
      ]);
      const recorded = await getAudit(operationId);
      if (!recorded) throw new InventoryError('ALLOCATION_RESOLUTION_REJECTED', 'The order is not eligible or sufficient unallocated stock is unavailable.');
      checkRepeat(recorded, digest);
      return getOrder(orderId);
    },

    // Internal Checkout recovery only. The caller must have a definitive Stripe
    // validation rejection; the database additionally requires the same worker's
    // creation lease and no known Session, payment or prior allocation release.
    async releaseFailedCreation({ orderId, owner, operationId }) {
      const reason = 'stripe_validation_rejected';
      operationId = operation({ operationId, reason });
      if (!UUID.test(orderId ?? '') || !UUID.test(owner ?? '')) throw new InventoryError('INVALID_OPERATION', 'Valid order and creation-owner UUIDs are required.');
      const digest = fingerprint({ action: 'creation_rejected', orderId, owner, reason });
      if (checkRepeat(await getAudit(operationId), digest)) return { released: true };
      const nonce = randomUUID();
      const now = Date.now();
      await driver.transaction([
        lockInventoryForOrder(orderId),
        [`SELECT id FROM ${ORDERS} WHERE id = $1 FOR UPDATE`, [orderId]],
        [`INSERT INTO ${AUDIT} (operation_id,operation_hash,claim_nonce,mode,sku,order_id,action,reason,units,from_state,to_state,created_at)
          SELECT $3,$4,$5,mode,sku,id,'allocation_released','stripe_validation_rejected',quantity,'held','released',$6 FROM ${ORDERS}
          WHERE id = $1 AND creation_owner = $2 AND stripe_session_id IS NULL AND paid_at IS NULL
            AND status = 'pending' AND allocation_state = 'held' ON CONFLICT (operation_id) DO NOTHING`,
        [orderId, owner, operationId, digest, nonce, now]],
        [`UPDATE ${ORDERS} SET allocation_state = 'released', status = 'payment_failed',
          creation_owner = NULL, creation_lease_until = 0, reconciliation_version = reconciliation_version + 1, updated_at = $2
          WHERE id = $1 AND EXISTS (SELECT 1 FROM ${AUDIT} WHERE operation_id = $3 AND claim_nonce = $4)`,
        [orderId, now, operationId, nonce]],
      ]);
      const recorded = await getAudit(operationId);
      checkRepeat(recorded, digest);
      return { released: Boolean(recorded) };
    },

    async setFulfillment({ orderId, status, carrier = '', trackingNumber = '', trackingUrl = '', reason, operationId }) {
      operationId = operation({ operationId, reason });
      if (!UUID.test(orderId ?? '') || !['awaiting_dispatch', 'shipped', 'returned', 'needs_review'].includes(status)) {
        throw new InventoryError('INVALID_FULFILLMENT_INPUT', 'A valid order and fulfillment status are required.');
      }
      for (const value of [carrier, trackingNumber, trackingUrl]) {
        if (typeof value !== 'string' || value.length > 500 || /[\u0000-\u001f\u007f]/u.test(value)) throw new InventoryError('INVALID_FULFILLMENT_INPUT', 'Invalid tracking details.');
      }
      carrier = carrier.trim(); trackingNumber = trackingNumber.trim(); trackingUrl = trackingUrl.trim();
      if (status === 'shipped' && !trackingNumber) throw new InventoryError('INVALID_FULFILLMENT_INPUT', 'A tracking number is required to confirm shipment.');
      if (status !== 'shipped' && (carrier || trackingNumber || trackingUrl)) throw new InventoryError('INVALID_FULFILLMENT_INPUT', 'Tracking details are set only when confirming shipment.');
      if (trackingUrl) {
        let url;
        try { url = new URL(trackingUrl); } catch { throw new InventoryError('INVALID_FULFILLMENT_INPUT', 'A valid HTTPS tracking link is required.'); }
        if (url.protocol !== 'https:' || url.username || url.password) throw new InventoryError('INVALID_FULFILLMENT_INPUT', 'A valid HTTPS tracking link is required.');
      }
      const digest = fingerprint({ action: 'fulfillment_updated', orderId, status, carrier, trackingNumber, trackingUrl, reason });
      if (checkRepeat(await getAudit(operationId), digest)) return getOrder(orderId);
      const snapshot = await getOrder(orderId);
      if (!snapshot) throw new InventoryError('FULFILLMENT_TRANSITION_REJECTED', 'This order could not be found.');
      if (status === 'shipped' && (!snapshot.shipping?.name || !snapshot.shipping?.address?.line1 || !snapshot.shipping?.address?.country)) {
        throw new InventoryError('FULFILLMENT_TRANSITION_REJECTED', 'Verified delivery details are required before dispatch.');
      }
      const nonce = randomUUID();
      const now = Date.now();
      const paidAllocation = `status = 'paid' AND paid_at IS NOT NULL AND refunded_amount = 0 AND allocation_state = 'committed'`;
      const eligibility = status === 'shipped'
        ? `${paidAllocation} AND fulfillment_status = 'awaiting_dispatch' AND shipped_at IS NULL AND shipping_json IS NOT NULL`
        : status === 'awaiting_dispatch'
          ? `${paidAllocation} AND shipped_at IS NULL AND (fulfillment_status IS NULL OR fulfillment_status IN ('awaiting_dispatch','needs_review'))`
          : status === 'returned'
            ? `shipped_at IS NOT NULL AND returned_at IS NULL AND fulfillment_status IN ('shipped','needs_review')`
            : `returned_at IS NULL`;
      await driver.transaction([
        lockInventoryForOrder(orderId),
        [`SELECT id FROM ${ORDERS} WHERE id = $1 FOR UPDATE`, [orderId]],
        [`INSERT INTO ${AUDIT} (operation_id,operation_hash,claim_nonce,mode,sku,order_id,action,reason,units,from_state,to_state,created_at)
          SELECT $2,$3,$4,mode,sku,id,'fulfillment_updated',$5,0,fulfillment_status,$6,$7 FROM ${ORDERS}
          WHERE id = $1 AND ${eligibility} AND reconciliation_version = CAST($8 AS BIGINT)
          ON CONFLICT (operation_id) DO NOTHING`,
        [orderId, operationId, digest, nonce, reason, status, now, snapshot.reconciliation_version]],
        [`UPDATE ${ORDERS} SET fulfillment_status = $2,
          fulfillment_carrier = CASE WHEN $2 = 'shipped' THEN $3 ELSE fulfillment_carrier END,
          fulfillment_tracking_number = CASE WHEN $2 = 'shipped' THEN $4 ELSE fulfillment_tracking_number END,
          fulfillment_tracking_url = CASE WHEN $2 = 'shipped' THEN $5 ELSE fulfillment_tracking_url END,
          shipped_at = CASE WHEN $2 = 'shipped' THEN CAST($6 AS BIGINT) ELSE shipped_at END,
          returned_at = CASE WHEN $2 = 'returned' THEN CAST($6 AS BIGINT) ELSE returned_at END,
          updated_at = $6, reconciliation_version = reconciliation_version + 1
          WHERE id = $1 AND EXISTS (SELECT 1 FROM ${AUDIT} WHERE operation_id = $7 AND claim_nonce = $8)`,
        [orderId, status, carrier || null, trackingNumber || null, trackingUrl || null, now, operationId, nonce]],
      ]);
      const recorded = await getAudit(operationId);
      if (!recorded) throw new InventoryError('FULFILLMENT_TRANSITION_REJECTED', 'This order is not eligible for that fulfillment transition.');
      checkRepeat(recorded, digest);
      return getOrder(orderId);
    },
  };
  return methods;
}
