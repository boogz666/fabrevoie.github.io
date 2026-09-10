// Explicit verification of the deployed, sales-disabled integration. No payment is made.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = (process.env.DEPLOYMENT_URL || 'https://fabrevoie.com').replace(/\/$/, '');
const checks = [];
const check = (condition, message) => { assert.ok(condition, message); checks.push(message); };
const report = { origin, checks, passed: false };
const request = (route, body) => fetch(`${origin}${route}`, { method: 'POST',
  headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
try {
  const configuration = await fetch(`${origin}/api/commerce`);
  const config = await configuration.json();
  check(configuration.status === 200 && config.ok === true && config.available === false, 'Public purchases remain disabled');
  check(config.mode === 'disabled', 'No live or sandbox purchase mode is exposed');
  check(configuration.headers.get('cache-control')?.includes('no-store'), 'Commerce configuration is not cached');
  const checkout = await request('/api/checkout', { quantity: 1, requestId: randomUUID() });
  const denied = await checkout.json();
  check(checkout.status === 503 && denied.ok === false && !denied.url, 'A valid purchase request cannot create checkout while disabled');
  const unknown = await request('/api/order-status', { token: randomBytes(32).toString('base64url') });
  check(unknown.status === 404 && (await unknown.json()).ok === false, 'Cloud order lookup responds without revealing records');
  const crossOrigin = await fetch(`${origin}/api/order-status`, {method:'POST', headers:{Origin:'https://unrelated.example','Content-Type':'application/json'}, body:JSON.stringify({token:randomBytes(32).toString('base64url')})});
  check(crossOrigin.status === 403, 'Cross-origin order requests are rejected');
  const unsigned = await request('/api/stripe-webhook', {type:'checkout.session.completed'});
  check(unsigned.status === 400, 'Unsigned webhook is rejected before storage writes');
  const forged = await fetch(`${origin}/api/stripe-webhook`, {method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':`t=${Math.floor(Date.now()/1000)},v1=${'0'.repeat(64)}`},body:'{"type":"checkout.session.completed"}'});
  check(forged.status === 400, 'Incorrectly signed webhook is rejected');
  const page = await fetch(`${origin}/order.html`, {redirect:'manual'});
  const html = await page.text();
  check(page.status === 200, 'Branded order page is deployed at its own route');
  check(page.headers.get('cache-control')?.includes('no-store'), 'Private order page is not cached');
  check(page.headers.get('referrer-policy') === 'no-referrer', 'Private order page suppresses referrers');
  check(page.headers.get('x-robots-tag')?.includes('noindex') && /name="robots" content="noindex/.test(html), 'Order status is excluded from search indexing');
  check((await fetch(`${origin}/order.js`)).status === 200, 'Order-status application is deployed');
  for (const route of ['/lib/commerce.mjs','/scripts/commerce-orders.mjs','/data/commerce.sqlite','/.env.local']) {
    check([403,404].includes((await fetch(origin+route)).status), `Private commerce path unavailable: ${route}`);
  }
  const robots = await (await fetch(`${origin}/robots.txt`)).text();
  check(robots.includes('Disallow: /order.html'), 'Robots excludes the private order page');
  report.passed = true;
  console.log(`PASS: ${checks.length} deployed commerce checks; no order or payment created.`);
} finally {
  const dir = path.resolve('tests/artifacts');
  await mkdir(dir, {recursive:true});
  await writeFile(path.join(dir,'commerce-deployment-report.json'), JSON.stringify(report,null,2));
}
