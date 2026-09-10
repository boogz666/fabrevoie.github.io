import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { stripeReadiness, formatReadiness, ReadinessError, STRIPE_API_VERSION, WEBHOOK_EVENTS } from '../scripts/stripe-readiness.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/stripe-readiness.mjs', import.meta.url));
const env = {
  STRIPE_SECRET_KEY: 'rk_test_fixture',
  STRIPE_WEBHOOK_SECRET: 'whsec_PRIVATEWEBHOOKVALUE123456789',
  ORDER_TOKEN_SECRET: 'private-order-secret-with-at-least-32-characters',
  RATE_LIMIT_SECRET: 'private-rate-limit-secret-with-at-least-32-characters',
  DATABASE_URL: 'postgres://private:password@database.invalid/store',
  COMMERCE_MODE: 'test',
  STRIPE_PRICE_ID: 'price_configured',
  STRIPE_SHIPPING_RATE_IDS: 'shr_configured',
  COMMERCE_ALLOWED_SHIPPING_COUNTRIES: 'FR,BE',
  COMMERCE_DISPATCH_NOTICE: 'Dispatch after the announced release date.',
  PUBLIC_SITE_URL: 'https://example.invalid'
};

function fixture(overrides = {}) {
  const values = {
    account: { business_profile: { name: 'FABREVOIE', support_email: 'PRIVATE-EMAIL', support_address: { line1: 'PRIVATE-STREET' } }, individual: { first_name: 'PRIVATE-FIRST-NAME' }, country: 'FR', charges_enabled: true, payouts_enabled: true },
    tax: { status: 'active', head_office: { address: { line1: 'PRIVATE-TAX-STREET', country: 'FR' } }, livemode: false },
    registrations: [{ id: 'taxreg_one', country: 'FR', status: 'active', livemode: false, active_from: 1, expires_at: null, country_options: { private: 'PRIVATE-REGISTRATION' } }],
    price: { id: env.STRIPE_PRICE_ID, active: true, livemode: false, type: 'one_time', recurring: null, billing_scheme: 'per_unit', currency: 'eur', unit_amount: 12500, tax_behavior: 'inclusive', product: { id: 'prod_private', active: true, livemode: false, tax_code: 'txcd_12345678', metadata: { confidential: 'PRIVATE-PRODUCT', fabrevoie_sku: 'ULTRAMACHO-100ML-IRIS' } } },
    rates: [{ id: 'shr_configured', active: true, livemode: false, type: 'fixed_amount', fixed_amount: { amount: 500, currency: 'eur' }, tax_behavior: 'inclusive', tax_code: 'txcd_92010001' }],
    endpoints: [{ id: 'we_one', url: `${env.PUBLIC_SITE_URL}/api/stripe-webhook`, status: 'enabled', livemode: false, api_version: STRIPE_API_VERSION, enabled_events: [...WEBHOOK_EVENTS], secret: 'PRIVATE-ENDPOINT-SECRET' }],
    codes: [{ id: 'txcd_12345678', name: 'Perfumes', description: 'Perfumes and fragrance products.' }],
    ...overrides
  };
  const calls = [];
  function call(name, fn) {
    return async (...args) => {
      calls.push({ name, args });
      if (overrides.errors?.[name]) throw overrides.errors[name];
      return fn(...args);
    };
  }
  function page(rows, params) {
    const start = params.starting_after ? rows.findIndex(row => row.id === params.starting_after) + 1 : 0;
    return { data: rows.slice(start, start + params.limit), has_more: start + params.limit < rows.length };
  }
  const client = {
    accounts: { retrieve: call('account.retrieve', () => values.account) },
    tax: {
      settings: { retrieve: call('tax.settings.retrieve', () => values.tax) },
      registrations: { list: call('tax.registrations.list', params => page(values.registrations, params)) }
    },
    prices: { retrieve: call('prices.retrieve', () => values.price) },
    shippingRates: { retrieve: call('shippingRates.retrieve', id => values.rates.find(rate => rate.id === id)) },
    webhookEndpoints: { list: call('webhookEndpoints.list', params => page(values.endpoints, params)) },
    taxCodes: { list: call('taxCodes.list', params => page(values.codes, params)) }
  };
  for (const resource of Object.values(client).filter(value => value.retrieve || value.list)) {
    for (const mutation of ['create', 'update', 'del']) Object.defineProperty(resource, mutation, { get() { throw new Error('Mutation attempted'); } });
  }
  for (const resource of ['customers', 'paymentIntents', 'charges', 'refunds', 'checkout']) {
    Object.defineProperty(client, resource, { get() { throw new Error('Unnecessary business-data API attempted'); } });
  }
  return { client, calls, values, options: { env: { ...env }, client } };
}

function check(report, id) {
  const result = report.checks.find(value => value.id === id);
  assert.ok(result, `Expected check ${id}`);
  return result;
}

test('complete sandbox configuration uses only targeted read APIs and returns a sanitized report', async () => {
  const f = fixture();
  const report = await stripeReadiness(f.options);
  assert.equal(report.status, 'checks-passed');
  assert.equal(report.mode, 'test');
  assert.deepEqual(report.account, { name: 'FABREVOIE', country: 'FR', chargesEnabled: true, payoutsEnabled: true });
  assert.deepEqual(f.calls.map(call => call.name).sort(), ['account.retrieve', 'prices.retrieve', 'shippingRates.retrieve', 'tax.registrations.list', 'tax.settings.retrieve', 'webhookEndpoints.list'].sort());
  assert.deepEqual(f.calls.find(call => call.name === 'account.retrieve').args, [null]);
  assert.deepEqual(f.calls.find(call => call.name === 'prices.retrieve').args, ['price_configured', { expand: ['product'] }]);
  assert.deepEqual(f.calls.find(call => call.name === 'tax.registrations.list').args, [{ status: 'active', limit: 100 }]);
  assert.match(formatReadiness(report), /No payment, delivery, tax obligation/);
  assert.doesNotMatch(JSON.stringify(report) + formatReadiness(report), /PRIVATE-|private:password|prod_private|we_one|price_configured|shr_configured/);
});

test('missing/invalid credentials never initialize the SDK or call Stripe, including an injected client', async () => {
  for (const key of ['', 'pk_test_PUBLICKEY', 'not-a-key']) {
    const f = fixture();
    const report = await stripeReadiness({ ...f.options, env: { STRIPE_SECRET_KEY: key }, loadStripe: () => { throw new Error('Must not initialize'); } });
    assert.equal(report.status, 'needs-attention');
    assert.equal(report.mode, 'unknown');
    assert.equal(f.calls.length, 0);
    assert.equal(check(report, 'secret-key').status, key ? 'fail' : 'missing');
  }
});

test('default SDK initialization pins the API version with bounded requests; initialization errors are sanitized', async () => {
  const f = fixture();
  let options;
  class FakeStripe {
    constructor(key, configuration) { assert.equal(key, env.STRIPE_SECRET_KEY); options = configuration; return f.client; }
  }
  const report = await stripeReadiness({ env, loadStripe: async () => ({ default: FakeStripe }) });
  assert.equal(report.status, 'checks-passed');
  assert.deepEqual(options, { apiVersion: '2026-08-26.dahlia', timeout: 10000, maxNetworkRetries: 1 });
  const failed = await stripeReadiness({ env, loadStripe: async () => { throw new Error(env.STRIPE_SECRET_KEY); } });
  assert.equal(check(failed, 'stripe-client').status, 'unverified');
  assert.ok(!JSON.stringify(failed).includes(env.STRIPE_SECRET_KEY));
});

test('missing deployment configuration is identified without scanning catalogs or printing supplied values', async () => {
  const f = fixture();
  const report = await stripeReadiness({ ...f.options, env: { STRIPE_SECRET_KEY: env.STRIPE_SECRET_KEY } });
  assert.equal(report.commerceMode, 'disabled');
  assert.equal(check(report, 'commerce-mode').status, 'warning');
  for (const id of ['STRIPE_WEBHOOK_SECRET', 'DATABASE_URL', 'COMMERCE_DISPATCH_NOTICE', 'price-configuration', 'shipping-configuration', 'public-origin']) assert.equal(check(report, id).status, 'missing');
  assert.equal(report.status, 'needs-attention');
  assert.deepEqual(f.calls.map(call => call.name).sort(), ['account.retrieve', 'tax.settings.retrieve', 'tax.registrations.list'].sort());
});

test('mode and deployment mismatches are blocked without inferring live readiness from test objects', async () => {
  for (const configuration of [{ COMMERCE_MODE: 'live' }, { VERCEL_ENV: 'production' }, { STRIPE_SECRET_KEY: 'sk_live_PRIVATE12345', COMMERCE_MODE: 'live', VERCEL_ENV: 'preview' }]) {
    const f = fixture();
    const report = await stripeReadiness({ ...f.options, env: { ...env, ...configuration } });
    assert.equal(report.status, 'needs-attention');
    assert.equal(check(report, configuration.VERCEL_ENV ? 'deployment-mode' : 'commerce-mode').status, 'fail');
    if (configuration.STRIPE_SECRET_KEY) for (const id of ['price', 'product', 'tax-settings', 'tax-registrations', 'shipping-rate-1']) assert.equal(check(report, id).status, 'fail');
  }
});

test('invalid configuration values do not become API identifiers or appear in output', async () => {
  const f = fixture();
  const report = await stripeReadiness({ ...f.options, env: { ...env, STRIPE_PRICE_ID: 'PRIVATE-INVALID-PRICE', STRIPE_SHIPPING_RATE_IDS: 'shr_one,shr_one', PUBLIC_SITE_URL: 'https://user:PRIVATE-CREDENTIAL@example.invalid', COMMERCE_ALLOWED_SHIPPING_COUNTRIES: 'FR,FR', COMMERCE_QUANTITY_MAX: '11', ORDER_TOKEN_SECRET: env.RATE_LIMIT_SECRET } });
  for (const id of ['price-configuration', 'shipping-configuration', 'public-origin', 'shipping-countries', 'quantity-limit', 'ORDER_TOKEN_SECRET']) assert.equal(check(report, id).status, 'fail');
  assert.ok(!f.calls.some(call => /prices|shippingRates|webhookEndpoints/.test(call.name)));
  assert.doesNotMatch(JSON.stringify(report), /PRIVATE-INVALID|PRIVATE-CREDENTIAL/);
});

test('tax setup and registration failures remain distinct from unverified permission failures', async () => {
  const f = fixture({ tax: { status: 'pending', head_office: null, livemode: false }, registrations: [] });
  const report = await stripeReadiness(f.options);
  assert.equal(check(report, 'tax-settings').status, 'fail');
  assert.equal(check(report, 'tax-registrations').status, 'fail');
  assert.equal(check(report, 'tax-scope').status, 'warning');
  const denied = fixture({ errors: { 'tax.settings.retrieve': Object.assign(new Error(`Server response ${env.STRIPE_SECRET_KEY} PRIVATE-ADDRESS`), { statusCode: 403 }) } });
  const deniedReport = await stripeReadiness(denied.options);
  assert.equal(check(deniedReport, 'tax-settings').status, 'unverified');
  assert.match(check(deniedReport, 'tax-settings').detail, /Read access denied/);
  assert.equal(check(deniedReport, 'price').status, 'pass');
  assert.doesNotMatch(JSON.stringify(deniedReport), /PRIVATE-ADDRESS|PRIVATEKEYVALUE/);
});

test('inactive, recurring, variable, non-EUR and unspecified-tax prices cannot pass', async () => {
  const f = fixture();
  for (const difference of [{ active: false }, { id: 'price_other' }, { recurring: {} }, { billing_scheme: 'tiered' }, { transform_quantity: { divide_by: 10, round: 'up' } }, { unit_amount: null }, { unit_amount: 0 }, { unit_amount: 99999999 }, { currency: 'usd' }, { tax_behavior: 'unspecified' }]) {
    const candidate = fixture({ price: { ...f.values.price, ...difference } });
    assert.equal(check(await stripeReadiness(candidate.options), 'price').status, 'fail');
  }
  for (const product of ['prod_not_expanded', { deleted: true }, { active: true, livemode: false, tax_code: null }]) {
    const candidate = fixture({ price: { ...f.values.price, product } });
    const report = await stripeReadiness(candidate.options);
    assert.equal(report.status, 'needs-attention');
    assert.equal(check(report, 'product-tax-code').status, 'fail');
  }
});

test('every configured shipping rate is read and validated, including free shipping', async () => {
  const f = fixture();
  f.values.rates.push({ ...f.values.rates[0], id: 'shr_free', fixed_amount: { amount: 0, currency: 'eur' } });
  const report = await stripeReadiness({ ...f.options, env: { ...env, STRIPE_SHIPPING_RATE_IDS: 'shr_configured,shr_free' } });
  assert.equal(check(report, 'shipping-rate-2').status, 'pass');
  f.values.rates[1].tax_behavior = 'unspecified';
  const invalid = await stripeReadiness({ ...f.options, env: { ...env, STRIPE_SHIPPING_RATE_IDS: 'shr_configured,shr_free' } });
  assert.equal(check(invalid, 'shipping-rate-2').status, 'fail');
});

test('readiness rejects configuration edge cases that would keep the backend disabled', async () => {
  for (const [field, value, id] of [
    ['STRIPE_WEBHOOK_SECRET', 'whsec_short', 'STRIPE_WEBHOOK_SECRET'],
    ['COMMERCE_DISPATCH_NOTICE', 'A notice\nwith controls', 'COMMERCE_DISPATCH_NOTICE'],
    ['COMMERCE_ALLOWED_SHIPPING_COUNTRIES', 'FR,', 'shipping-countries'],
    ['STRIPE_SHIPPING_RATE_IDS', 'shr_configured,', 'shipping-configuration'],
    ['PUBLIC_SITE_URL', 'http://example.invalid', 'public-origin']
  ]) {
    const f = fixture();
    assert.equal(check(await stripeReadiness({ ...f.options, env: { ...env, [field]: value } }), id).status, 'fail');
  }
  const f = fixture();
  for (const period of [{ active_from: 200, expires_at: null }, { active_from: 1, expires_at: 99 }]) {
    f.values.registrations[0] = { ...f.values.registrations[0], ...period };
    assert.equal(check(await stripeReadiness({ ...f.options, now: () => 100000 }), 'tax-registrations').status, 'fail');
  }
});

test('webhook readiness requires an exact URL, mode, enabled status, version and complete event set', async () => {
  const f = fixture();
  for (const difference of [{ url: 'https://other.invalid/api/stripe-webhook' }, { livemode: true }, { status: 'disabled' }, { api_version: null }, { enabled_events: ['checkout.session.completed'] }]) {
    const candidate = fixture({ endpoints: [{ ...f.values.endpoints[0], ...difference }] });
    assert.ok(['fail', 'missing'].includes(check(await stripeReadiness(candidate.options), 'webhook-endpoint').status));
  }
  const wildcard = fixture({ endpoints: [{ ...f.values.endpoints[0], enabled_events: ['*'] }] });
  const report = await stripeReadiness(wildcard.options);
  assert.equal(check(report, 'webhook-endpoint').status, 'pass');
  assert.equal(check(report, 'webhook-signature').status, 'warning');
});

test('registrations, webhook endpoints and optional canonical tax codes paginate completely', async () => {
  const f = fixture();
  f.values.registrations = Array.from({ length: 102 }, (_, index) => ({ ...f.values.registrations[0], id: `taxreg_${index}` }));
  f.values.endpoints = [...Array.from({ length: 101 }, (_, index) => ({ ...f.values.endpoints[0], id: `we_other${index}`, url: 'https://other.invalid/hook' })), f.values.endpoints[0]];
  f.values.codes = [...Array.from({ length: 201 }, (_, index) => ({ id: `txcd_${10000000 + index}`, name: 'Unrelated classification', description: 'Unrelated goods.' })),
    { id: 'txcd_98765431', name: 'Fragrances', description: 'Canonical fragrance description.' },
    { id: 'txcd_98765432', name: 'Cosmetics', description: 'Canonical cosmetic description.' },
    { id: 'txcd_98765433', name: 'Other', description: 'Includes perfumes.' }];
  const report = await stripeReadiness({ ...f.options, argv: ['--tax-codes'] });
  assert.equal(check(report, 'webhook-endpoint').status, 'pass');
  assert.match(check(report, 'tax-registrations').detail, /102 active/);
  assert.deepEqual(report.taxCodes.map(code => code.id), ['txcd_98765431', 'txcd_98765432', 'txcd_98765433']);
  assert.equal(f.calls.filter(call => call.name === 'taxCodes.list').length, 3);
  assert.deepEqual(f.calls.filter(call => call.name === 'taxCodes.list')[1].args, [{ limit: 100, starting_after: 'txcd_10000099' }]);
  assert.match(formatReadiness(report), /https:\/\/docs\.stripe\.com\/api\/tax_codes/);
});

test('broken pagination never produces a false complete tax-code list', async () => {
  const f = fixture();
  let reads = 0;
  f.client.taxCodes.list = async () => { reads += 1; return { data: [{ id: 'txcd_12345678', name: 'Perfumes' }], has_more: true }; };
  const report = await stripeReadiness({ ...f.options, argv: ['--tax-codes'] });
  assert.equal(reads, 2);
  assert.equal(check(report, 'tax-code-candidates').status, 'unverified');
  assert.deepEqual(report.taxCodes, []);
});

test('unexpected API errors and secret-like data never leak key values, fragments or private response fields', async () => {
  const f = fixture();
  f.values.account.business_profile.name = `FABREVOIE\u001b[31m ${env.STRIPE_SECRET_KEY} ${env.DATABASE_URL} sk_live_UNRELATEDSECRET`;
  f.values.codes[0].description = `${env.STRIPE_WEBHOOK_SECRET} ${env.ORDER_TOKEN_SECRET} fragrance`;
  f.client.shippingRates.retrieve = async () => { throw Object.assign(new Error(`${env.STRIPE_SECRET_KEY} ${env.DATABASE_URL} private@example.invalid`), { raw: { secret: 'PRIVATE-RAW-RESPONSE' } }); };
  const report = await stripeReadiness({ ...f.options, argv: ['--tax-codes'] });
  const output = JSON.stringify(report) + formatReadiness(report);
  for (const value of [env.STRIPE_SECRET_KEY, env.DATABASE_URL, env.STRIPE_WEBHOOK_SECRET, env.ORDER_TOKEN_SECRET, 'PRIVATEKEYVALUE', 'UNRELATEDSECRET', 'private@example.invalid', 'PRIVATE-RAW-RESPONSE']) assert.ok(!output.includes(value));
  assert.ok(!output.includes('\u001b'));
  assert.equal(check(report, 'shipping-rate-1').status, 'unverified');
});

test('CLI help and invalid arguments stay offline; missing key reports a sanitized nonzero JSON result', async () => {
  const help = await exec(process.execPath, [script, '--help'], { env: { ...process.env, STRIPE_SECRET_KEY: '' } });
  assert.match(help.stdout, /Read-only configuration checks/);
  await assert.rejects(stripeReadiness({ argv: ['--tax-codes', '--tax-codes'], env }), error => error instanceof ReadinessError && /Usage:/.test(error.message));
  await assert.rejects(exec(process.execPath, [script, '--unknown-PRIVATE-FLAG'], { env: { ...process.env, STRIPE_SECRET_KEY: '' } }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /Usage:/);
    assert.doesNotMatch(error.stderr, /PRIVATE-FLAG/);
    return true;
  });
  await assert.rejects(exec(process.execPath, [script, '--json'], { env: { ...process.env, STRIPE_SECRET_KEY: '' } }), error => {
    assert.equal(error.code, 2);
    assert.equal(JSON.parse(error.stdout).checks[0].status, 'missing');
    assert.equal(error.stderr, '');
    return true;
  });
});
