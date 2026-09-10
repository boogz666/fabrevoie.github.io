import { access, mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNeonCommerceStorage, createSqliteCommerceStorage } from '../lib/commerce-storage.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function inside(parent, target) {
  const relative = path.relative(parent, target);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function summarizeOrder(order) {
  return {
    reference: order.reference, mode: order.mode, status: order.status,
    quantity: order.quantity, amountTotal: order.amount_total,
    currency: order.currency, refundedAmount: order.refunded_amount,
    createdAt: new Date(order.created_at).toISOString(),
    payment: order.stripe_payment_intent_id
      ? `https://dashboard.stripe.com/${order.mode === 'test' ? 'test/' : ''}payments/${encodeURIComponent(order.stripe_payment_intent_id)}`
      : null,
  };
}

export async function writePrivateExport(orders, { destination, siteRoot = root }) {
  const file = path.resolve(destination);
  const directory = path.dirname(file);
  const forbidden = [path.join(siteRoot, 'public'), path.join(siteRoot, 'dist')];
  if (path.extname(file) !== '.json' || forbidden.some(dir => inside(dir, file))) {
    throw new Error('Order exports must be private JSON files outside public and dist.');
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const actualDirectory = await realpath(directory);
  const roots = await Promise.all(forbidden.map(dir => realpath(dir).catch(() => dir)));
  if (roots.some(dir => inside(dir, actualDirectory))) throw new Error('Order export directory resolves inside the public website.');
  // Exclusive creation also refuses an existing file or final-component symlink.
  const rows = orders.map(order => ({
    ...summarizeOrder(order), taxAmount: order.tax_amount, shippingAmount: order.shipping_amount,
    dispatchNotice: order.dispatch_notice, customer: order.customer, shipping: order.shipping,
  }));
  await writeFile(file, JSON.stringify({ exportedAt: new Date().toISOString(), orders: rows }, null, 2),
    { flag: 'wx', mode: 0o600 });
  return rows.length;
}

export async function runOrders({ args = process.argv.slice(2), env = process.env, log = console.log } = {}) {
  if (args.some(arg => !['--cloud', '--export'].includes(arg))) throw new Error('Usage: npm run orders -- [--cloud] [--export]');
  const dataDir = path.resolve(root, env.DATA_DIR || 'data');
  const cloud = args.includes('--cloud');
  if (cloud && !env.DATABASE_URL) throw new Error('Cloud order storage is not configured; no local fallback was used.');
  if (!cloud) {
    try { await access(path.join(dataDir, 'commerce.sqlite')); }
    catch { throw new Error('No local order database exists. Use --cloud explicitly to read deployed orders.'); }
  }
  const storage = cloud ? await createNeonCommerceStorage(env.DATABASE_URL) : await createSqliteCommerceStorage(dataDir);
  try {
    const orders = await storage.listOrders({ limit: 10000 });
    if (orders.length >= 10000) throw new Error('Order count exceeds this export limit; use a database export to avoid an incomplete report.');
    if (args.includes('--export')) {
      const destination = path.join(dataDir, `orders-${cloud ? 'cloud' : 'local'}-${Date.now()}.json`);
      const count = await writePrivateExport(orders, { destination });
      log(`${count} orders exported to private data/${path.basename(destination)}. Includes delivery data; no customer details printed.`);
    } else {
      log(JSON.stringify({ source: cloud ? 'cloud' : 'local', totalOrders: orders.length,
        shown: Math.min(orders.length, 25), orders: orders.slice(0, 25).map(summarizeOrder),
        note: 'Payment status only. Paid orders still require merchant fulfillment.' }, null, 2));
    }
  } finally { await storage.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runOrders(); }
  catch (error) {
    // Do not echo database/provider exception text: connection strings can appear there.
    const safe = /^(Usage:|Cloud order|No local|Order count|Order exports|Order export directory)/.test(error.message);
    console.error(safe ? error.message : 'Order report unavailable. Check private storage configuration; no customer data was printed.');
    process.exitCode = 1;
  }
}
