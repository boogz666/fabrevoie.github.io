import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRODUCT_SKU, validSku } from '../lib/commerce-inventory.mjs';

export const STRIPE_API_VERSION = '2026-08-26.dahlia';
export const WEBHOOK_EVENTS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed', 'checkout.session.expired',
  'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed'
];
const USAGE = 'Usage: node scripts/stripe-readiness.mjs [--tax-codes] [--json]';
const ID = { price: /^price_[a-zA-Z0-9]+$/, shipping: /^shr_[a-zA-Z0-9]+$/, tax: /^txcd_\d+$/ };
const TAX_BEHAVIORS = new Set(['inclusive', 'exclusive']);

export class ReadinessError extends Error {}

function argumentsFor(argv) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) return { help: true };
  if (new Set(argv).size !== argv.length || argv.some(value => !['--tax-codes', '--json'].includes(value))) {
    throw new ReadinessError(USAGE);
  }
  return { taxCodes: argv.includes('--tax-codes'), json: argv.includes('--json') };
}

function sanitizer(env) {
  const secrets = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'ORDER_TOKEN_SECRET', 'RATE_LIMIT_SECRET', 'DATABASE_URL']
    .map(name => env[name]).filter(value => typeof value === 'string' && value.length > 0).sort((a, b) => b.length - a.length);
  return (value, maxLength = 160) => {
    let text = typeof value === 'string' ? value : '';
    for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
    return text.replace(/\b(?:[srp]k_(?:test|live)_|whsec_)[a-zA-Z0-9_-]+/g, '[redacted]')
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, maxLength);
  };
}

function safeReadFailure(error) {
  if (error?.statusCode === 401 || error?.type === 'StripeAuthenticationError') return 'Authentication failed; check the configured key.';
  if (error?.statusCode === 403 || error?.type === 'StripePermissionError') return 'Read access denied; check restricted-key permissions.';
  if (error?.statusCode === 404 || error?.code === 'resource_missing') return 'Configured object was not found in this Stripe account and mode.';
  if (error?.statusCode === 429) return 'Stripe rate limited this read; retry later.';
  return 'Read could not complete; check connectivity and access, then retry.';
}

// No create, update, delete, payment, customer or order APIs belong in this command.
async function read(operation) {
  try { return { ok: true, value: await operation() }; }
  catch (error) { return { ok: false, detail: safeReadFailure(error) }; }
}

async function listAll(list, params = {}) {
  const rows = [];
  const cursors = new Set();
  let cursor;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await list({ ...params, limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    if (!Array.isArray(page?.data)) throw new ReadinessError('Invalid list response.');
    rows.push(...page.data);
    if (!page.has_more) return rows;
    cursor = page.data.at(-1)?.id;
    if (typeof cursor !== 'string' || !cursor || cursors.has(cursor)) throw new ReadinessError('Incomplete list response.');
    cursors.add(cursor);
  }
  throw new ReadinessError('List exceeded the read limit.');
}

function publicOrigin(value) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return null;
    return url.origin;
  } catch { return null; }
}

export async function stripeReadiness({ argv = [], env = process.env, client, loadStripe = () => import('stripe'), now = () => Date.now() } = {}) {
  const flags = argumentsFor(argv);
  if (flags.help) return { help: true };
  const safe = sanitizer(env);
  const checks = [];
  const add = (id, status, detail) => checks.push({ id, status, detail });
  const verify = (id, valid, detail, missing = false) => add(id, valid ? 'pass' : missing ? 'missing' : 'fail', detail);
  const key = env.STRIPE_SECRET_KEY || '';
  const keyMatch = /^(?:sk|rk)_(test|live)_[a-zA-Z0-9]+$/.exec(key);
  const mode = keyMatch?.[1] || 'unknown';
  const configuredMode = env.COMMERCE_MODE || 'disabled';
  const report = { mode, commerceMode: ['disabled', 'test', 'live'].includes(configuredMode) ? configuredMode : 'invalid', account: null, checks, taxCodes: [], taxCodesRequested: flags.taxCodes };
  const finish = () => ({ ...report, status: checks.some(check => ['fail', 'missing', 'unverified'].includes(check.status)) ? 'needs-attention' : 'checks-passed' });

  verify('secret-key', Boolean(keyMatch), key ? 'STRIPE_SECRET_KEY must be a standard test/live secret or restricted key.' : 'STRIPE_SECRET_KEY is missing.', !key);
  if (!keyMatch) return finish();
  if (configuredMode === 'disabled') add('commerce-mode', 'warning', 'Commerce is disabled. Read-only checks use the configured key mode.');
  else verify('commerce-mode', configuredMode === mode, 'COMMERCE_MODE must match the configured key mode.');
  if (env.VERCEL_ENV === 'production' && mode === 'test') add('deployment-mode', 'fail', 'Test checkout must not be enabled on the production deployment.');
  if (env.VERCEL_ENV === 'preview' && mode === 'live') add('deployment-mode', 'fail', 'Live checkout must not be enabled on a preview deployment.');
  const required = [
    ['STRIPE_WEBHOOK_SECRET', value => /^whsec_[a-zA-Z0-9]{16,}$/.test(value), 'Webhook signing secret must use the expected format; a signed delivery must verify it.'],
    ['ORDER_TOKEN_SECRET', value => value.length >= 32 && value !== env.RATE_LIMIT_SECRET, 'Order-token secret must contain at least 32 characters and differ from the rate-limit secret.'],
    ['RATE_LIMIT_SECRET', value => value.length >= 32, 'Rate-limit secret must contain at least 32 characters.'],
    ['DATABASE_URL', value => Boolean(value), 'Persistent cloud database configuration is present; database access is not tested here.'],
    ['COMMERCE_DISPATCH_NOTICE', value => value.trim().length >= 8 && value.length <= 240 && !/[\u0000-\u001f\u007f]/u.test(value), 'Dispatch notice must contain 8–240 characters without control characters.']
  ];
  for (const [name, validate, detail] of required) {
    const value = env[name] || '';
    verify(name, Boolean(value) && validate(value), value ? detail : `${name} is missing.`, !value);
  }
  const quantity = env.COMMERCE_QUANTITY_MAX === undefined ? 3 : Number(env.COMMERCE_QUANTITY_MAX);
  verify('quantity-limit', Number.isInteger(quantity) && quantity >= 1 && quantity <= 10, 'Quantity limit must be an integer from 1 to 10.');
  const sku=env.COMMERCE_SKU??PRODUCT_SKU;
  verify('inventory-sku',validSku(sku),'Inventory SKU must identify the configured bottle.');
  add('inventory-stock','warning','Stock quantities and allocations are verified separately with the private inventory status command.');
  if(env.COMMERCE_OPENS_AT) {
    const dateValid=/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/.test(env.COMMERCE_OPENS_AT)&&Number.isFinite(Date.parse(env.COMMERCE_OPENS_AT));
    verify('launch-time',dateValid,'The opening instant must be an ISO timestamp with a timezone.');
    if(dateValid&&mode==='live'&&now()<Date.parse(env.COMMERCE_OPENS_AT))add('launch-not-open','warning','The configured live opening instant is in the future; new purchases remain gated.');
  }
  const countries = env.COMMERCE_ALLOWED_SHIPPING_COUNTRIES ? env.COMMERCE_ALLOWED_SHIPPING_COUNTRIES.split(',').map(value => value.trim()) : [];
  verify('shipping-countries', countries.length >= 1 && countries.length <= 30 && countries.every(value => /^[A-Z]{2}$/.test(value)) && new Set(countries).size === countries.length,
    'COMMERCE_ALLOWED_SHIPPING_COUNTRIES must contain 1–30 distinct uppercase ISO country codes.', !countries.length);
  const origin = publicOrigin(env.PUBLIC_SITE_URL);
  verify('public-origin', Boolean(origin) && (mode !== 'live' || origin.startsWith('https:')), 'PUBLIC_SITE_URL must be an HTTPS origin without credentials, path, query or fragment; local HTTP is allowed in test mode.', !env.PUBLIC_SITE_URL);
  const priceId = env.STRIPE_PRICE_ID || '';
  const validPrice = ID.price.test(priceId);
  verify('price-configuration', validPrice, 'STRIPE_PRICE_ID must identify the configured product price.', !priceId);
  const shippingIds = env.STRIPE_SHIPPING_RATE_IDS ? env.STRIPE_SHIPPING_RATE_IDS.split(',').map(value => value.trim()) : [];
  const validShipping = shippingIds.length >= 1 && shippingIds.length <= 5 && new Set(shippingIds).size === shippingIds.length && shippingIds.every(value => ID.shipping.test(value));
  verify('shipping-configuration', validShipping, 'STRIPE_SHIPPING_RATE_IDS must contain 1–5 distinct shipping-rate IDs.', !shippingIds.length);

  if (!client) {
    try {
      const { default: Stripe } = await loadStripe();
      client = new Stripe(key, { apiVersion: STRIPE_API_VERSION, timeout: 10000, maxNetworkRetries: 1 });
    } catch { add('stripe-client', 'unverified', 'Stripe SDK could not be initialized. Check the installed dependency and configuration.'); return finish(); }
  }

  const accountResult = await read(() => client.accounts.retrieve(null));
  if (accountResult.ok) {
    const account = accountResult.value;
    report.account = {
      name: safe(account.business_profile?.name || account.company?.name || account.settings?.dashboard?.display_name) || 'Business name unavailable',
      country: /^[A-Z]{2}$/.test(account.country) ? account.country : 'unknown',
      chargesEnabled: account.charges_enabled === true,
      payoutsEnabled: account.payouts_enabled === true
    };
    verify('account-payments', report.account.chargesEnabled, 'Account payment capability must be enabled.');
    add('account-payouts', report.account.payoutsEnabled ? 'pass' : 'warning', report.account.payoutsEnabled ? 'Account payouts are enabled.' : 'Account payouts are not enabled; review before going live.');
  } else add('account', 'unverified', accountResult.detail);

  const [taxResult, registrationsResult, priceResult, ratesResult, webhooksResult, codesResult] = await Promise.all([
    read(() => client.tax.settings.retrieve()),
    read(() => listAll(params => client.tax.registrations.list(params), { status: 'active' })),
    validPrice ? read(() => client.prices.retrieve(priceId, { expand: ['product'] })) : null,
    validShipping ? Promise.all(shippingIds.map(id => read(() => client.shippingRates.retrieve(id)))) : null,
    origin?.startsWith('https:') ? read(() => listAll(params => client.webhookEndpoints.list(params))) : null,
    flags.taxCodes ? read(() => listAll(params => client.taxCodes.list(params))) : null
  ]);
  if (taxResult.ok) {
    const settings = taxResult.value;
    verify('tax-settings', settings.status === 'active' && Boolean(settings.head_office?.address?.country) && settings.livemode === (mode === 'live'),
      'Tax settings must be active, with an origin address, in the configured mode. No address is printed.');
  } else add('tax-settings', 'unverified', taxResult.detail);
  if (registrationsResult.ok) {
    const timestamp = Math.floor(now() / 1000);
    const registrations = registrationsResult.value.filter(value => value.status === 'active' && value.livemode === (mode === 'live') && value.active_from <= timestamp && (!value.expires_at || value.expires_at > timestamp));
    const locations = [...new Set(registrations.map(value => value.country).filter(value => /^[A-Z]{2}$/.test(value)))].sort();
    verify('tax-registrations', registrations.length > 0, registrations.length ? `${registrations.length} active registration(s); countries: ${locations.join(', ') || 'unavailable'}.` : 'No active tax registrations were found in the configured mode.');
  } else add('tax-registrations', 'unverified', registrationsResult.detail);
  add('tax-scope', 'warning', 'Registration presence does not establish destination coverage or legal obligations. No tax calculation is performed by this read-only command.');

  if (priceResult?.ok) {
    const price = priceResult.value;
    const product = price.product;
    verify('price', price.id === priceId && price.active === true && price.livemode === (mode === 'live') && price.type === 'one_time' && !price.recurring && price.billing_scheme === 'per_unit' && !price.transform_quantity &&
      Number.isSafeInteger(price.unit_amount) && price.unit_amount > 0 && price.unit_amount * quantity <= 99999999 && price.currency === 'eur' && TAX_BEHAVIORS.has(price.tax_behavior),
    'Price must be active, one-time, fixed, positive EUR, in the configured mode, with explicit inclusive/exclusive tax behavior.');
    verify('product', Boolean(product && typeof product === 'object' && !product.deleted && product.active === true && product.livemode === (mode === 'live')),
      'The expanded product must be active in the configured mode.');
    verify('product-tax-code', ID.tax.test(typeof product?.tax_code === 'string' ? product.tax_code : product?.tax_code?.id || ''),
      'Product must have a tax code. Use --tax-codes to review canonical candidates; this command does not choose the classification.');
    verify('product-inventory-sku',product?.metadata?.fabrevoie_sku===sku,'Stripe Product metadata must match the configured inventory SKU.');
  } else if (priceResult) add('price', 'unverified', priceResult.detail);
  for (const [index, result] of (ratesResult || []).entries()) {
    if (!result.ok) { add(`shipping-rate-${index + 1}`, 'unverified', result.detail); continue; }
    const rate = result.value;
    verify(`shipping-rate-${index + 1}`, rate.id === shippingIds[index] && rate.active === true && rate.livemode === (mode === 'live') && rate.type === 'fixed_amount' &&
      rate.fixed_amount?.currency === 'eur' && Number.isSafeInteger(rate.fixed_amount?.amount) && rate.fixed_amount.amount >= 0 && TAX_BEHAVIORS.has(rate.tax_behavior),
    'Shipping rate must be active, fixed EUR, in the configured mode, with explicit inclusive/exclusive tax behavior.');
    const hasShippingCode = ID.tax.test(typeof rate.tax_code === 'string' ? rate.tax_code : rate.tax_code?.id || '');
    add(`shipping-tax-code-${index + 1}`, hasShippingCode ? 'pass' : 'warning', hasShippingCode ? 'Shipping rate has an explicit tax code for review.' : 'Shipping rate has no explicit tax code; review how shipping will be classified.');
  }

  if (webhooksResult?.ok) {
    const endpoints = webhooksResult.value.filter(endpoint => endpoint.url === `${origin}/api/stripe-webhook` && endpoint.livemode === (mode === 'live'));
    const usable = endpoints.filter(endpoint => endpoint.status === 'enabled' && endpoint.api_version === STRIPE_API_VERSION &&
      WEBHOOK_EVENTS.every(event => endpoint.enabled_events?.includes('*') || endpoint.enabled_events?.includes(event)));
    verify('webhook-endpoint', usable.length > 0, 'A matching enabled HTTPS webhook endpoint must use the pinned API version and subscribe to all eight required payment/refund events.', endpoints.length === 0);
    if (endpoints.length > 1) add('webhook-duplicates', 'warning', 'Multiple endpoints target this webhook URL. Confirm this is intentional; duplicate events must remain idempotent.');
  } else add('webhook-endpoint', 'unverified', webhooksResult?.detail || 'A public HTTPS origin is needed to compare deployed webhook configuration.');
  add('webhook-signature', 'warning', 'Stripe does not return an existing endpoint signing secret. Verify a real signed delivery in the configured mode separately.');
  if (codesResult?.ok) {
    report.taxCodes = codesResult.value.filter(code => ID.tax.test(code.id) && /perfum|fragrance|cosmetic/i.test(`${code.name || ''} ${code.description || ''}`))
      .map(code => ({ id: code.id, name: safe(code.name), description: safe(code.description, 800) }));
    add('tax-code-candidates', 'pass', `${report.taxCodes.length} canonical matching candidate(s) found. Owner confirmation is still required.`);
  } else if (codesResult) add('tax-code-candidates', 'unverified', codesResult.detail);
  return finish();
}

export function formatReadiness(report) {
  if (report.help) return `${USAGE}\nRead-only configuration checks. Reads STRIPE_SECRET_KEY only from the process environment.\n--tax-codes lists canonical candidates for owner review; it never selects or saves a tax code.`;
  const lines = [
    `Stripe configuration: ${report.status}; key mode: ${report.mode}; commerce mode: ${report.commerceMode}.`,
    ...(report.account ? [`Account: ${report.account.name}; country: ${report.account.country}.`] : []),
    ...report.checks.map(check => `[${check.status.toUpperCase()}] ${check.id}: ${check.detail}`)
  ];
  if (report.taxCodesRequested) {
    lines.push('Canonical tax-code candidates (https://docs.stripe.com/api/tax_codes):');
    for (const code of report.taxCodes) lines.push(`${code.id} | ${code.name}\n  ${code.description}`);
  }
  lines.push('Read-only report. No payment, delivery, tax obligation, database access or production readiness is certified.');
  return lines.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const report = await stripeReadiness({ argv });
    console.log(argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReadiness(report));
    process.exitCode = report.help || report.status === 'checks-passed' ? 0 : 2;
  } catch (error) {
    console.error(error instanceof ReadinessError && error.message === USAGE ? USAGE : 'Stripe readiness could not complete. No Stripe error details were printed.');
    process.exitCode = 1;
  }
}
