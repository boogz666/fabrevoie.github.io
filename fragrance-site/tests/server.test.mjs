import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { createSiteServer } from '../server.mjs';

const silent = { error() {} };

async function fixture(t, options = {}) {
  const base = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(base, 'fabrevoie-server-test-'));
  const publicDir = path.join(root, 'public');
  const dataDir = path.join(root, 'private');
  await mkdir(publicDir);
  await writeFile(path.join(publicDir, 'index.html'), '<!doctype html><title>FABREVOIE</title>');
  await writeFile(path.join(publicDir, 'site.css'), 'body { color: black; }');
  await writeFile(path.join(root, 'secret.txt'), 'PRIVATE DATA');
  if (options.brokenStorage) await writeFile(dataDir, 'not a directory');
  const server = await createSiteServer({ publicDir, dataDir, logger: silent, ...options });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    if (server.listening) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    assert.equal(path.dirname(path.resolve(root)), base);
    assert.ok(path.basename(root).startsWith('fabrevoie-server-test-'));
    await rm(root, { recursive: true, force: true });
  });
  return { server, origin, dataDir, publicDir };
}

function signup(origin, body = {}, options = {}) {
  return fetch(`${origin}/api/signup`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json', ...options.headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function rawGet(origin, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(origin, { path: requestPath, headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers }));
    });
    request.on('error', reject);
    request.end();
  });
}

function rows(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, 'signups.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT * FROM signups ORDER BY email').all(); }
  finally { db.close(); }
}

test('serves GET/HEAD assets with useful security headers and cache validation', async t => {
  const { origin } = await fixture(t);
  const response = await fetch(origin);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /FABREVOIE/);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const head = await fetch(`${origin}/site.css`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.match(head.headers.get('content-type'), /text\/css/);
  assert.ok(Number(head.headers.get('content-length')) > 0);
  const cached = await fetch(`${origin}/site.css`, { headers: { 'If-None-Match': head.headers.get('etag') } });
  assert.equal(cached.status, 304);
  assert.equal((await fetch(`${origin}/missing`)).status, 404);
});

test('success durably stores normalized email and consent; duplicates cannot obtain the removal token', async t => {
  const { origin, dataDir } = await fixture(t);
  const first = await signup(origin, { email: '  NAME+Test@EXAMPLE.COM  ', consent: true, website: '' });
  assert.equal(first.status, 200);
  const original = await first.json();
  assert.equal(original.ok, true);
  assert.match(original.removalToken, /^[a-zA-Z0-9_-]{43}$/);
  const duplicate = await signup(origin, { email: 'name+test@example.com', consent: true });
  assert.deepEqual(await duplicate.json(), { ok: original.ok, message: original.message });
  const saved = rows(dataDir);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].email, 'name+test@example.com');
  assert.equal(saved[0].consent_version, 'fabrevoie-launch-2026-01');
  assert.equal(saved[0].source, 'website');
  assert.ok(Number.isFinite(Date.parse(saved[0].consented_at)));
  assert.equal(saved[0].removal_token_hash, createHash('sha256').update(original.removalToken).digest('hex'));
  assert.ok(!JSON.stringify(saved).includes(original.removalToken));
  assert.equal(first.headers.get('cache-control'), 'no-store');
});

test('saved entries survive closing and reopening the server', async t => {
  const context = await fixture(t);
  assert.equal((await signup(context.origin, { email: 'persist@example.com', consent: true })).status, 200);
  await new Promise(resolve => { context.server.close(resolve); context.server.closeAllConnections(); });
  const reopened = await createSiteServer({ publicDir: context.publicDir, dataDir: context.dataDir, logger: silent });
  await new Promise(resolve => reopened.listen(0, '127.0.0.1', resolve));
  assert.equal(rows(context.dataDir)[0].email, 'persist@example.com');
  await new Promise(resolve => reopened.close(resolve));
});

test('rejects invalid email, malformed input, missing consent and filled honeypot without persistence', async t => {
  const { origin, dataDir } = await fixture(t, { rateLimitMax: 30 });
  for (const body of [
    { email: 'invalid', consent: true },
    { email: 'a..b@example.com', consent: true },
    { email: 'hello@example.com\r\nBcc:somebody@example.com', consent: true },
    { email: 'person@example.com' },
    { email: 'person@example.com', consent: false },
    { email: 'person@example.com', consent: 'true' },
    { email: 'person@example.com', consent: true, website: 'https://bot.example' },
    { email: 'person@example.com', consent: true, website: false },
    '{broken json',
    '[]',
    'null',
  ]) {
    const response = await signup(origin, body);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).ok, false);
  }
  assert.equal(rows(dataDir).length, 0);
});

test('rejects cross-origin and missing-origin submissions and unrecognized hosts', async t => {
  const { origin, dataDir } = await fixture(t);
  const valid = { email: 'person@example.com', consent: true };
  const crossOrigin = await signup(origin, valid, { headers: { Origin: 'https://other.example' } });
  assert.equal(crossOrigin.status, 403);
  const noOrigin = await fetch(`${origin}/api/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(valid),
  });
  assert.equal(noOrigin.status, 403);
  const metadata = await signup(origin, valid, { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  assert.equal(metadata.status, 403);
  assert.equal((await rawGet(origin, '/', { Host: 'untrusted.example' })).status, 400);
  assert.equal(rows(dataDir).length, 0);
});

test('bounds body size and rejects unsupported content types and methods', async t => {
  const { origin } = await fixture(t);
  const large = await signup(origin, { email: 'a'.repeat(4200), consent: true });
  assert.equal(large.status, 413);
  const wrongType = await signup(origin, 'email=person@example.com', { headers: { 'Content-Type': 'text/plain' } });
  assert.equal(wrongType.status, 415);
  const get = await fetch(`${origin}/api/signup`);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST, DELETE');
});

test('rate limits by socket address without trusting spoofed forwarding headers', async t => {
  let timestamp = Date.now();
  const { origin, dataDir } = await fixture(t, { rateLimitMax: 2, rateLimitWindowMs: 1000, now: () => timestamp });
  const body = { email: 'limited@example.com', consent: true };
  assert.equal((await signup(origin, body)).status, 200);
  assert.equal((await signup(origin, body)).status, 200);
  const limited = await signup(origin, body, { headers: { 'X-Forwarded-For': '203.0.113.5' } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '1');
  timestamp += 1001;
  assert.equal((await signup(origin, body)).status, 200);
  assert.equal(rows(dataDir).length, 1);
});

test('blocks raw and encoded traversal, Windows paths and dotfiles', async t => {
  const { origin } = await fixture(t);
  for (const requestPath of [
    '/../secret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/%2eenv', '/C:%5cWindows%5cwin.ini', '/%00',
  ]) {
    const response = await rawGet(origin, requestPath);
    assert.equal(response.status, 403, requestPath);
    assert.doesNotMatch(response.body, /PRIVATE DATA/);
  }
  assert.equal((await rawGet(origin, '/%ZZ')).status, 400);
  assert.equal((await rawGet(origin, '/data/signups.sqlite')).status, 404);
});

test('storage failure returns honest 503 while the static site remains usable', async t => {
  const { origin } = await fixture(t, { brokenStorage: true });
  assert.equal((await fetch(origin)).status, 200);
  const response = await signup(origin, { email: 'person@example.com', consent: true });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /couldn’t save/);
});

test('configured public origin supports an HTTPS reverse proxy without trusting request forwarding headers', async t => {
  const { origin, dataDir } = await fixture(t, { publicOrigin: 'https://fabrevoie.example' });
  const body = { email: 'person@example.com', consent: true };
  assert.equal((await signup(origin, body)).status, 403);
  const accepted = await signup(origin, body, { headers: { Origin: 'https://fabrevoie.example' } });
  assert.equal(accepted.status, 200);
  assert.equal(rows(dataDir).length, 1);
});

test('withdrawal requires the secret token, removes the row durably and stays generic for unknown tokens', async t => {
  const { origin, dataDir } = await fixture(t);
  const created = await signup(origin, { email: 'withdraw@example.com', consent: true });
  const { removalToken } = await created.json();
  async function withdraw(body, requestOrigin = origin) {
    return fetch(`${origin}/api/signup`, {
      method: 'DELETE',
      headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
  assert.equal((await withdraw({ email: 'withdraw@example.com' })).status, 400);
  assert.equal((await withdraw({ token: removalToken }, 'https://other.example')).status, 403);
  const unknown = await withdraw({ token: randomBytes(32).toString('base64url') });
  assert.equal(unknown.status, 200);
  const unknownBody = await unknown.json();
  assert.equal(rows(dataDir).length, 1);
  const removed = await withdraw({ token: removalToken });
  assert.equal(removed.status, 200);
  assert.deepEqual(await removed.json(), unknownBody);
  assert.equal(rows(dataDir).length, 0);
  assert.deepEqual(await (await withdraw({ token: removalToken })).json(), unknownBody);
});
