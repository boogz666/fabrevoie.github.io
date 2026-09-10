import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createSignupHandler } from '../api/signup.js';
import { assertSameOrigin, clientKey, normalizeEmail, readJson } from '../lib/cloud-signups.mjs';

const ENV = { PUBLIC_ORIGIN: 'https://fabrevoie.example', RATE_LIMIT_SECRET: 'a'.repeat(64), VERCEL: '1' };
const TOKEN = 'W'.repeat(43);
const FORM = { email: 'Reader@example.com', consent: true, website: '' };

function fixture(overrides = {}) {
  const calls = [];
  const logs = [];
  const storage = {
    async consume(key, signal) { calls.push(['rate', key]); assert.ok(signal instanceof AbortSignal); return 0; },
    async save(email) { calls.push(['save', email]); return TOKEN; },
    async remove(token) { calls.push(['remove', token]); },
    ...overrides.storage,
  };
  const handler = createSignupHandler({ env: ENV, logger: { error: (...args) => logs.push(args) }, storage, ...overrides });
  return { handler, calls, logs };
}

async function invoke(handler, { method = 'POST', body = FORM, headers = {}, raw, badGetter = false } = {}) {
  const request = Readable.from(raw === undefined ? [] : [raw]);
  request.method = method;
  request.headers = {
    host: 'fabrevoie.example', origin: 'https://fabrevoie.example',
    'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9',
    ...headers,
  };
  request.socket = { remoteAddress: '127.0.0.1' };
  if (raw === undefined) request.body = body;
  if (badGetter) Object.defineProperty(request, 'body', { get() { throw new SyntaxError('Provider parser rejected JSON'); } });
  const response = {
    writeHead(status, values) { this.status = status; this.headers = values; },
    end(value) { this.body = JSON.parse(value); this.writableEnded = true; },
  };
  await handler(request, response);
  return response;
}

test('new signup returns its withdrawal capability; duplicate confirms without leaking one', async () => {
  const saved = new Set();
  const setup = fixture({ storage: {
    async consume() { return 0; },
    async save(email) {
      assert.equal(email, 'reader@example.com');
      if (saved.has(email)) return undefined;
      saved.add(email);
      return TOKEN;
    },
  } });
  const first = await invoke(setup.handler);
  assert.equal(first.status, 200);
  assert.equal(first.body.removalToken, TOKEN);
  assert.equal(first.headers['Cache-Control'], 'no-store');
  assert.equal(first.headers['Access-Control-Allow-Origin'], undefined);
  const duplicate = await invoke(setup.handler);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.ok, true);
  assert.equal(duplicate.body.message, first.body.message);
  assert.equal(Object.hasOwn(duplicate.body, 'removalToken'), false);
});

test('withdrawal is idempotent and requires a full capability token', async () => {
  const setup = fixture();
  for (let i = 0; i < 2; i += 1) {
    const response = await invoke(setup.handler, { method: 'DELETE', body: { token: TOKEN } });
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
  }
  assert.deepEqual(setup.calls.filter(call => call[0] === 'remove'), [['remove', TOKEN], ['remove', TOKEN]]);
  setup.calls.length = 0;
  for (const token of [null, 'short', 'A'.repeat(42), 'A'.repeat(44), '/'.repeat(43)]) {
    assert.equal((await invoke(setup.handler, { method: 'DELETE', body: { token } })).status, 400);
  }
  assert.deepEqual(setup.calls, []);
});

test('invalid consent, email and honeypot never reach durable storage', async () => {
  const setup = fixture();
  for (const body of [
    { ...FORM, consent: false }, { ...FORM, consent: 'true' },
    { ...FORM, email: 'someone@localhost' }, { ...FORM, website: 'spam' },
    { ...FORM, website: null }, {},
  ]) assert.equal((await invoke(setup.handler, { body })).status, 400);
  assert.deepEqual(setup.calls, []);
});

test('cross-origin, missing origin, forged forwarded-host and lookalike origins are rejected', async () => {
  const setup = fixture();
  for (const headers of [
    { origin: undefined }, { origin: 'null' }, { origin: 'https://elsewhere.example' },
    { origin: 'https://fabrevoie.example.evil.example' },
    { origin: 'https://fabrevoie.example/path' },
    { origin: 'https://elsewhere.example', 'x-forwarded-host': 'elsewhere.example' },
    { 'sec-fetch-site': 'cross-site' },
  ]) assert.equal((await invoke(setup.handler, { headers })).status, 403);
  assert.deepEqual(setup.calls, []);
  for (const host of ['good.example@bad.example', 'bad.example/path', ['fabrevoie.example'], '']) {
    assert.equal((await invoke(setup.handler, { headers: { host } })).status, 400);
  }
});

test('production and preview hosts can submit only from their own origin', () => {
  const env = { ...ENV, VERCEL_URL: 'fabrevoie-abc.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'fabrevoie.vercel.app' };
  for (const host of ['fabrevoie.example', 'fabrevoie-abc.vercel.app', 'fabrevoie.vercel.app']) {
    assert.doesNotThrow(() => assertSameOrigin({ headers: { host, origin: `https://${host}` } }, env));
  }
  assert.throws(() => assertSameOrigin({ headers: { host: 'fabrevoie.example', origin: 'https://fabrevoie-abc.vercel.app' } }, env), { status: 403 });
  assert.throws(() => assertSameOrigin({ headers: { host: 'fabrevoie.example', origin: 'https://fabrevoie.example' } }, { PUBLIC_ORIGIN: 'https://fabrevoie.example/path' }), { status: 503 });
});

test('only POST and DELETE are accepted, with an explicit Allow header', async () => {
  const setup = fixture();
  for (const method of ['GET', 'PUT', 'PATCH', 'OPTIONS', 'HEAD']) {
    const response = await invoke(setup.handler, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.Allow, 'POST, DELETE');
  }
  assert.deepEqual(setup.calls, []);
});

test('storage failure returns 503 without echoing email, token or provider error', async () => {
  for (const failedOperation of ['consume', 'save', 'remove']) {
    const calls = [];
    const setup = fixture({ storage: {
      async consume() { calls.push('consume'); if (failedOperation === 'consume') throw new Error('postgres://secret + Reader@example.com'); return 0; },
      async save() { calls.push('save'); if (failedOperation === 'save') throw new Error(TOKEN); },
      async remove() { calls.push('remove'); throw new Error(TOKEN); },
    } });
    const response = await invoke(setup.handler, failedOperation === 'remove' ? { method: 'DELETE', body: { token: TOKEN } } : {});
    assert.equal(response.status, 503);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.removalToken, undefined);
    const exposed = JSON.stringify([response.body, setup.logs]);
    assert.equal(exposed.includes('secret'), false);
    assert.equal(exposed.includes('Reader@example.com'), false);
    assert.equal(exposed.includes(TOKEN), false);
    if (failedOperation === 'consume') assert.deepEqual(calls, ['consume']);
  }
});

test('unconfigured storage or rate secret fails closed', async () => {
  const logs = [];
  const missingDatabase = createSignupHandler({ env: ENV, logger: { error: value => logs.push(value) } });
  assert.equal((await invoke(missingDatabase)).status, 503);
  const setup = fixture({ env: { PUBLIC_ORIGIN: ENV.PUBLIC_ORIGIN } });
  assert.equal((await invoke(setup.handler)).status, 503);
  assert.deepEqual(setup.calls, []);
});

test('durable rate limit returns retry time and prevents signup and withdrawal writes', async () => {
  const setup = fixture({ storage: {
    async consume() { return 247; },
    async save() { assert.fail('Rate-limited signup reached storage'); },
    async remove() { assert.fail('Rate-limited withdrawal reached storage'); },
  } });
  for (const options of [{}, { method: 'DELETE', body: { token: TOKEN } }]) {
    const response = await invoke(setup.handler, options);
    assert.equal(response.status, 429);
    assert.equal(response.headers['Retry-After'], '247');
    assert.equal(response.body.ok, false);
  }
});

test('body parser handles Vercel parsed objects, parser errors and invalid JSON values', async () => {
  const setup = fixture();
  assert.equal((await invoke(setup.handler, { headers: { 'content-type': 'application/json; charset=utf-8' } })).status, 200);
  assert.equal((await invoke(setup.handler, { badGetter: true })).status, 400);
  for (const body of [null, [], 'null', '{', '[]', '3', false]) {
    assert.equal((await invoke(setup.handler, { body })).status, 400);
  }
  assert.equal((await invoke(setup.handler, { headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await invoke(setup.handler, { headers: { 'content-length': '4097' } })).status, 413);
  assert.equal((await invoke(setup.handler, { body: { ...FORM, extra: 'é'.repeat(2100) } })).status, 413);
});

test('raw streams enforce the byte limit even without content-length and reject invalid UTF-8', async () => {
  const setup = fixture();
  assert.equal((await invoke(setup.handler, { raw: Buffer.from(JSON.stringify(FORM)) })).status, 200);
  assert.equal((await invoke(setup.handler, { raw: Buffer.from(' '.repeat(4097)) })).status, 413);
  assert.equal((await invoke(setup.handler, { raw: Buffer.from([0xff, 0xfe, 0x7b]) })).status, 400);
  assert.equal((await invoke(setup.handler, { raw: Buffer.from('{bad json') })).status, 400);
  const request = Readable.from([Buffer.from('{}' + ' '.repeat(4094))]);
  request.headers = { 'content-type': 'application/json' };
  assert.deepEqual(await readJson(request), {});
});

test('email normalization supports international domains and rejects ambiguous or unsafe addresses', () => {
  assert.equal(normalizeEmail('  Person+News@EXAMPLE.COM '), 'person+news@example.com');
  assert.equal(normalizeEmail('Reader@bücher.de'), 'reader@xn--bcher-kva.de');
  for (const email of [
    'a..b@example.com', '.a@example.com', 'a.@example.com', 'a@-example.com', 'a@example-.com',
    'a@example..com', 'a@@example.com', 'a@localhost', 'a@b.c', 'a\nb@example.com',
    'a b@example.com', `${'a'.repeat(65)}@example.com`, 'é@example.com', null, {},
  ]) assert.equal(normalizeEmail(email), null, String(email));
});

test('client IPs are keyed, secret-dependent hashes and forwarded IPs are trusted only on Vercel', () => {
  const request = { headers: { 'x-forwarded-for': '203.0.113.9' }, socket: { remoteAddress: '127.0.0.1' } };
  const hash = clientKey(request, ENV.RATE_LIMIT_SECRET, ENV);
  assert.match(hash, /^[a-f0-9]{64}$/);
  assert.equal(hash.includes('203.0.113.9'), false);
  assert.notEqual(hash, clientKey(request, 'b'.repeat(64), ENV));
  const local = clientKey(request, ENV.RATE_LIMIT_SECRET, {});
  assert.notEqual(hash, local);
  request.headers['x-forwarded-for'] = '192.0.2.7';
  assert.equal(local, clientKey(request, ENV.RATE_LIMIT_SECRET, {}));
  assert.throws(() => clientKey(request, 'short', ENV));
});

test('real Node HTTP request streams receive JSON success and withdrawal responses', async t => {
  const setup = fixture({ env: { ...ENV, PUBLIC_ORIGIN: undefined } });
  const server = createServer(setup.handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const host = `127.0.0.1:${server.address().port}`;
  const headers = { origin: `https://${host}`, 'content-type': 'application/json' };
  const response = await fetch(`http://${host}`, { method: 'POST', headers, body: JSON.stringify(FORM) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).removalToken, TOKEN);
  const removed = await fetch(`http://${host}`, { method: 'DELETE', headers, body: JSON.stringify({ token: TOKEN }) });
  assert.equal(removed.status, 200);
  assert.equal((await removed.json()).ok, true);
});
