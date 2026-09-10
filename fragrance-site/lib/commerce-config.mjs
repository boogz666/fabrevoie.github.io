export const STRIPE_API_VERSION = '2026-08-26.dahlia';
// A stable flow label, with its eight-letter random suffix, is reused on retries.
export const INTEGRATION_IDENTIFIER = 'fabrevoie-ultra-macho-mvtrqxpa';
export const PRODUCT_NAME = 'ULTRA MACHO';
export const WEBHOOK_EVENTS = new Set([
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired',
  'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed',
]);

function unavailable() { throw new Error('Commerce configuration unavailable'); }

export function keyMode(key) {
  if (typeof key !== 'string') return null;
  return /^(?:sk|rk)_(test|live)_[a-zA-Z0-9]+$/.exec(key)?.[1] ?? null;
}

export function siteOrigin(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

function list(value, expression, maximum) {
  if (typeof value !== 'string') unavailable();
  const values = value.split(',').map(item => item.trim());
  if (!values.length || values.length > maximum || !values.every(item => expression.test(item))
    || new Set(values).size !== values.length) unavailable();
  return values;
}

export function readCommerceConfiguration(env, { hasStorage = false } = {}) {
  const mode = env.COMMERCE_MODE ?? 'disabled';
  if (mode === 'disabled') return { mode: 'disabled' };
  if (!['test', 'live'].includes(mode) || keyMode(env.STRIPE_SECRET_KEY) !== mode) unavailable();
  if ((mode === 'test' && env.VERCEL_ENV === 'production') || (mode === 'live' && env.VERCEL_ENV === 'preview')) unavailable();
  if (!env.DATABASE_URL && !hasStorage) unavailable();
  const origin = siteOrigin(env.PUBLIC_SITE_URL);
  if (!origin || (mode === 'live' && !origin.startsWith('https://'))) unavailable();
  if (typeof env.STRIPE_WEBHOOK_SECRET !== 'string' || !/^whsec_[a-zA-Z0-9]{16,}$/.test(env.STRIPE_WEBHOOK_SECRET)) unavailable();
  if (typeof env.STRIPE_PRICE_ID !== 'string' || !/^price_[a-zA-Z0-9]+$/.test(env.STRIPE_PRICE_ID)) unavailable();
  if (typeof env.ORDER_TOKEN_SECRET !== 'string' || env.ORDER_TOKEN_SECRET.length < 32
    || typeof env.RATE_LIMIT_SECRET !== 'string' || env.RATE_LIMIT_SECRET.length < 32
    || env.ORDER_TOKEN_SECRET === env.RATE_LIMIT_SECRET) unavailable();
  const quantityMax = env.COMMERCE_QUANTITY_MAX === undefined ? 3 : Number(env.COMMERCE_QUANTITY_MAX);
  if (!Number.isInteger(quantityMax) || quantityMax < 1 || quantityMax > 10) unavailable();
  const dispatchNotice = env.COMMERCE_DISPATCH_NOTICE;
  if (typeof dispatchNotice !== 'string' || dispatchNotice.trim().length < 8 || dispatchNotice.length > 240
    || /[\u0000-\u001f\u007f]/u.test(dispatchNotice)) unavailable();
  const sku = env.COMMERCE_SKU ?? PRODUCT_SKU;
  if (!validSku(sku)) unavailable();
  let opensAt = null;
  if (env.COMMERCE_OPENS_AT) {
    if (typeof env.COMMERCE_OPENS_AT !== 'string' || !/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(env.COMMERCE_OPENS_AT)) unavailable();
    opensAt = Date.parse(env.COMMERCE_OPENS_AT);
    if (!Number.isFinite(opensAt)) unavailable();
  }
  if (mode === 'live' && opensAt !== null && Date.now() < opensAt) unavailable();
  return {
    mode, origin, sku, opensAt, quantityMax, dispatchNotice: dispatchNotice.trim(), priceId: env.STRIPE_PRICE_ID,
    shippingRateIds: list(env.STRIPE_SHIPPING_RATE_IDS, /^shr_[a-zA-Z0-9]+$/, 5),
    countries: list(env.COMMERCE_ALLOWED_SHIPPING_COUNTRIES, /^[A-Z]{2}$/, 30),
  };
}

export async function createStripeClient(env) {
  if (!keyMode(env.STRIPE_SECRET_KEY)) unavailable();
  const { default: Stripe } = await import('stripe');
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: STRIPE_API_VERSION, timeout: 10000, maxNetworkRetries: 1,
    appInfo: { name: 'FABREVOIE ULTRA MACHO', version: '1.0.0' },
  });
}

export async function verifyCommerceReadiness(stripe, config) {
  if (config.mode === 'disabled') unavailable();
  const expectedLive = config.mode === 'live';
  const [price, settings, registrations, ...rates] = await Promise.all([
    stripe.prices.retrieve(config.priceId, { expand: ['product'] }),
    stripe.tax.settings.retrieve(),
    stripe.tax.registrations.list({ status: 'active', limit: 100 }),
    ...config.shippingRateIds.map(id => stripe.shippingRates.retrieve(id)),
  ]);
  const product = price.product;
  if (!price.active || price.id !== config.priceId || price.livemode !== expectedLive
    || price.type !== 'one_time' || price.recurring || price.billing_scheme !== 'per_unit'
    || price.transform_quantity || price.currency !== 'eur'
    || !Number.isSafeInteger(price.unit_amount) || price.unit_amount <= 0 || price.unit_amount * config.quantityMax > 99999999
    || !['inclusive', 'exclusive'].includes(price.tax_behavior)
    || !product || typeof product !== 'object' || product.deleted || !product.active
    || product.livemode !== expectedLive || !product.tax_code || product.metadata?.fabrevoie_sku !== config.sku) unavailable();
  if (settings.status !== 'active' || settings.livemode !== expectedLive
    || !settings.head_office?.address?.country) unavailable();
  const now = Math.floor(Date.now() / 1000);
  if (!registrations.data?.some(item => item.status === 'active' && item.livemode === expectedLive
    && item.active_from <= now && (!item.expires_at || item.expires_at > now))) unavailable();
  for (const [index, rate] of rates.entries()) {
    if (rate.id !== config.shippingRateIds[index] || !rate.active || rate.livemode !== expectedLive
      || rate.type !== 'fixed_amount' || rate.fixed_amount?.currency !== price.currency
      || !Number.isSafeInteger(rate.fixed_amount.amount) || rate.fixed_amount.amount < 0
      || !['inclusive', 'exclusive'].includes(rate.tax_behavior)) unavailable();
  }
  return {
    ...config, unitAmount: price.unit_amount, currency: price.currency,
    productTaxCode: typeof product.tax_code === 'string' ? product.tax_code : product.tax_code.id,
    taxBehavior: price.tax_behavior,
    shippingSummary: `Delivery to ${config.countries.join(', ')}. Shipping and tax are confirmed at checkout.`,
  };
}
import { PRODUCT_SKU, validSku } from './commerce-inventory.mjs';
export { PRODUCT_SKU } from './commerce-inventory.mjs';
