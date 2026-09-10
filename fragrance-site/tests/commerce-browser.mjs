import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

// Browser contract tests only: all commerce responses and the hosted Checkout
// destination are fixtures. No request is sent to Stripe or a live database.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'tests', 'artifacts', 'commerce');
const publicDir = path.join(root, 'public');
const builtDir = path.join(root, 'dist');
const deployment = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
function createStaticPreview(directory, useDeploymentHeaders = false) {
  return createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^(?:index\.html|order\.html|styles\.css|app\.js|order\.js|assets\/[a-zA-Z0-9._-]+)$/.test(filename)) { response.writeHead(404); response.end(); return; }
  try {
    const data = await readFile(path.join(directory, filename));
    const headers = { 'Content-Type': `${types[path.extname(filename)] || 'application/octet-stream'}; charset=utf-8`, 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'", 'Referrer-Policy': 'no-referrer' };
    if (useDeploymentHeaders) {
      delete headers['Content-Security-Policy'];
      delete headers['Referrer-Policy'];
      for (const rule of deployment.headers || []) {
        if (rule.source === '/(.*)' || rule.source === pathname || (rule.source === '/assets/(.*)' && pathname.startsWith('/assets/'))) {
          for (const header of rule.headers) headers[header.key] = header.value;
        }
      }
    }
    response.writeHead(200, headers);
    response.end(data);
  } catch { response.writeHead(404); response.end(); }
  });
}
const server = createStaticPreview(publicDir);
const builtServer = createStaticPreview(builtDir, true);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
await new Promise(resolve => builtServer.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const builtOrigin = `http://127.0.0.1:${builtServer.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.platform === 'win32' ? { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' } : {}) });
await mkdir(artifacts, { recursive: true });
const report = { scope: 'Mocked commerce browser contracts and local dist/order.html preview with configured deployment headers; no live Stripe verification', checks: [], errors: [] };
const check = (condition, message) => { assert.ok(condition, message); report.checks.push(message); };
const config = { ok: true, available: true, mode: 'test', product: { name: 'ULTRA MACHO', unitAmount: 12345, currency: 'eur' }, quantityMax: 3, dispatchNotice: 'Dispatch notice supplied by the test API.', shippingSummary: 'Shipping summary supplied by the test API.' };
const token = 'a'.repeat(43);
const order = { reference: 'FF-TEST-0001', status: 'paid', quantity: 2, amountTotal: 24690, currency: 'eur', dispatchNotice: config.dispatchNotice, mode: 'test' };
const respond = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function fixture(width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => localStorage.setItem('fabrevoie-invitation-state-v1', JSON.stringify({ dismissedUntil: Date.now() + 86400000, joined: false })));
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  return { context, page };
}
async function submit(page) {
  await page.locator('#checkout-submit').click();
  await page.waitForFunction(() => !document.querySelector('#checkout-submit').disabled);
}

try {
  {
    const { context, page } = await fixture();
    await page.route('**/api/commerce', route => respond(route, { ok: true, available: false, mode: 'disabled' }));
    await page.goto(origin);
    await page.waitForLoadState('networkidle');
    check(await page.locator('#purchase-panel').isHidden(), 'Unavailable commerce stays hidden');
    await page.locator('.header-access').click();
    check(await page.locator('#waitlist-dialog').evaluate(dialog => dialog.open), 'Waitlist still opens when commerce is unavailable');
    check(await page.locator('iframe, script[src*="stripe.com"]').count() === 0, 'No embedded checkout or Stripe.js is loaded');
    await context.close();
  }
  for (const width of [320, 390]) {
    const { context, page } = await fixture(width);
    await page.setViewportSize({ width, height: width === 320 ? 740 : 844 });
    await page.route('**/api/commerce', route => respond(route, { ok: true, available: false, mode: 'disabled' }));
    await page.goto(origin);
    const trigger = page.locator('.footer-links [data-privacy]');
    await trigger.click();
    const privacy = page.locator('#privacy-dialog');
    check(await privacy.evaluate(element => element.open && element.scrollWidth <= element.clientWidth && element.getBoundingClientRect().width <= innerWidth), `Expanded purchase privacy text fits ${width}px without horizontal scrolling`);
    check((await privacy.innerText()).includes('A purchase does not add you to the release mailing list.'), 'Purchase privacy explains separate marketing consent');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifacts, `privacy-${width}-top.png`) });
    await privacy.locator('[data-close]').focus();
    await page.keyboard.press('PageDown');
    await page.waitForFunction(() => document.querySelector('#privacy-dialog').scrollTop > 0);
    check(await privacy.evaluate(element => element.scrollTop > 0), `Privacy content scrolls with PageDown at ${width}px`);
    await page.keyboard.press('Control+End');
    await page.waitForFunction(() => {
      const dialog = document.querySelector('#privacy-dialog');
      return dialog.scrollTop >= dialog.scrollHeight - dialog.clientHeight - 2;
    });
    check(await privacy.evaluate(element => element.scrollTop >= element.scrollHeight - element.clientHeight - 2), `Keyboard scrolling reaches the final privacy paragraph at ${width}px`);
    await page.screenshot({ path: path.join(artifacts, `privacy-${width}-scrolled.png`) });
    const privacyAxe = await new AxeBuilder({ page }).include('#privacy-dialog').withTags(['wcag2a', 'wcag2aa']).analyze();
    check(privacyAxe.violations.length === 0, `Expanded privacy dialog has no automated accessibility violations at ${width}px`);
    await page.keyboard.press('Escape');
    check(!(await privacy.evaluate(element => element.open)) && await trigger.evaluate(element => document.activeElement === element), `Escape closes scrolled privacy and restores focus at ${width}px`);
    await trigger.click();
    await privacy.locator('[data-close]').click();
    check(!(await privacy.evaluate(element => element.open)), `Visible privacy close control works at ${width}px`);
    await context.close();
  }
  for (const width of [320, 390, 1440]) {
    const { context, page } = await fixture(width);
    let apiRequests = 0;
    const failedAssets = [];
    page.on('response', response => { if (response.url().startsWith(builtOrigin) && response.status() >= 400) failedAssets.push(new URL(response.url()).pathname); });
    await page.route('**/api/**', route => { apiRequests += 1; return respond(route, { ok: false }, 503); });
    const response = await page.goto(`${builtOrigin}/order.html`);
    check(response.status() === 200, 'Actual dist/order.html is present in the production build');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready);
    check(response.headers()['cache-control'] === 'no-store' && response.headers()['referrer-policy'] === 'no-referrer' && /noindex/.test(response.headers()['x-robots-tag'] || ''), 'Built order preview applies configured no-store, no-referrer and noindex headers');
    check(/noindex/.test(await page.locator('meta[name=robots]').getAttribute('content')) && await page.locator('meta[name=referrer]').getAttribute('content') === 'no-referrer', 'Built order markup retains noindex and referrer protection');
    check((await page.locator('#order-state-label').innerText()) === 'PRIVATE LINK NEEDED' && await page.locator('#order-details').isHidden(), 'Built order page needs a private token and does not claim payment');
    check(apiRequests === 0, 'Missing-token built page makes no API request');
    check(failedAssets.length === 0 && await page.locator('img').evaluateAll(images => images.every(image => image.complete && image.naturalWidth > 0)), 'Built order images, scripts and styles load from dist');
    check(await page.evaluate(() => document.fonts.check('italic 900 60px HelveticaDisplay') && document.fonts.check('400 18px Founders')), 'Built order fonts are included and load');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Built order page fits ${width}px`);
    const builtAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    check(builtAxe.violations.length === 0, `Built missing-token order page has no automated accessibility violations at ${width}px`);
    await page.screenshot({ path: path.join(artifacts, `built-order-${width}.png`), fullPage: true });
    await context.close();
  }
  {
    const { context, page } = await fixture();
    const submissions = [];
    let outcome = 'unavailable';
    await page.route('**/api/commerce', route => respond(route, config));
    await page.route('**/api/checkout', async route => {
      submissions.push(route.request().postDataJSON());
      if (outcome === 'unavailable') return respond(route, { ok: false, message: 'Fixture checkout is temporarily unavailable.' }, 503);
      if (outcome === 'restart') return respond(route, { ok: false, code: 'CHECKOUT_RESTART_REQUIRED', message: 'Fixture checkout has expired.' }, 409);
      if (outcome === 'unsafe') return respond(route, { ok: true, url: 'https://checkout.stripe.com.evil.invalid/pay/fixture' });
      return respond(route, { ok: true, url: 'https://checkout.stripe.com/c/pay/fixture_browser_contract' });
    });
    await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Mock hosted Checkout destination</title>' }));
    await page.goto(origin);
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    check(await page.locator('#commerce-test-notice').isVisible(), 'Test checkout is prominently labeled');
    check((await page.locator('#product-unit-price').innerText()).includes('123.45'), 'Unit price comes from the mocked API');
    await page.locator('#checkout-quantity').selectOption('2');
    check((await page.locator('#checkout-subtotal').innerText()).includes('246.90'), 'Quantity updates the displayed product subtotal');
    await submit(page);
    check((await page.locator('#checkout-status').innerText()).includes('temporarily unavailable'), 'Checkout API error is shown without a success claim');
    await submit(page);
    check(submissions[0].requestId === submissions[1].requestId, 'Retry reuses the same checkout UUID');
    check(/^[0-9a-f-]{36}$/i.test(submissions[0].requestId), 'Checkout sends a UUID and quantity, not browser-supplied price');
    check(Object.keys(submissions[0]).sort().join(',') === 'quantity,requestId', 'Checkout payload contains only quantity and request ID');
    await page.reload();
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    await submit(page);
    check(submissions[0].requestId === submissions[2].requestId && submissions[2].quantity === 2, 'Reload preserves the pending checkout retry context');
    await page.locator('#checkout-quantity').selectOption('3');
    outcome = 'unsafe';
    await submit(page);
    check(submissions[3].requestId !== submissions[2].requestId, 'A different quantity receives a new checkout UUID');
    check(page.url() === `${origin}/` && (await page.locator('#checkout-status').innerText()).includes('secure checkout link'), 'Lookalike Checkout domains cannot redirect the browser');
    outcome = 'restart';
    await submit(page);
    check(await page.evaluate(() => sessionStorage.getItem('fabrevoie-checkout-request-v1') === null), 'Definitive expired/conflicting checkout clears stale retry context');
    outcome = 'valid';
    await page.locator('#checkout-submit').click();
    await page.waitForURL('https://checkout.stripe.com/**');
    check(submissions.at(-1).requestId !== submissions.at(-2).requestId, 'Retry after a definitive restart error creates a fresh checkout UUID');
    check((await page.title()) === 'Mock hosted Checkout destination', 'Allowed hosted Checkout redirect is exercised using a local browser fixture');
    await context.close();
  }
  for (const width of [320, 390, 1440]) {
    const { context, page } = await fixture(width);
    await page.route('**/api/commerce', route => respond(route, config));
    await page.goto(origin);
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('#purchase-panel').scrollIntoViewIfNeeded();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Purchase panel fits ${width}px`);
    await page.screenshot({ path: path.join(artifacts, `purchase-${width}.png`) });
    const purchaseAxe = await new AxeBuilder({ page }).include('#purchase-panel').withTags(['wcag2a', 'wcag2aa']).analyze();
    check(purchaseAxe.violations.length === 0, `Purchase controls have no automated accessibility violations at ${width}px`);
    await page.route('**/api/order-status', route => respond(route, { ok: true, order }));
    await page.goto(`${origin}/order.html#order=${token}`);
    await page.locator('#order-details').waitFor({ state: 'visible' });
    check(page.url() === `${origin}/order.html`, 'Private order capability is removed from the address bar');
    check((await page.locator('#order-state-label').innerText()) === 'PAYMENT CONFIRMED', 'Paid message appears only after a validated order API response');
    check(await page.locator('#order-test-notice').isVisible(), 'Test orders remain explicitly labeled');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Order page fits ${width}px`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(artifacts, `order-${width}.png`), fullPage: true });
    const orderAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    check(orderAxe.violations.length === 0, `Order page has no automated accessibility violations at ${width}px`);
    await context.close();
  }
  {
    const { context, page } = await fixture(390);
    let requests = 0;
    await page.route('**/api/order-status', route => { requests += 1; return respond(route, { ok: true, order }); });
    await page.goto(`${origin}/order.html?status=paid#order=invalid`);
    check((await page.locator('#order-state-label').innerText()) === 'PRIVATE LINK NEEDED', 'Query strings and invalid tokens cannot claim a payment');
    check(requests === 0, 'Invalid order capability is never sent to the API');
    for (const status of ['pending', 'processing', 'payment_failed', 'expired', 'refunded', 'partially_refunded']) {
      await page.unroute('**/api/order-status');
      await page.route('**/api/order-status', route => respond(route, { ok: true, order: { ...order, status, amountTotal: status === 'pending' ? null : order.amountTotal } }));
      await page.goto(`${origin}/order.html?fixture=${status}#order=${token}`);
      await page.locator('#order-details').waitFor({ state: 'visible' });
      check((await page.locator('#order-state-label').innerText()) !== 'PAYMENT CONFIRMED', `${status} has its own accurate non-paid message`);
    }
    await page.unroute('**/api/order-status');
    await page.route('**/api/order-status', route => respond(route, { ok: false }, 503));
    await page.goto(`${origin}/order.html#order=${token}`);
    await page.locator('#order-refresh').waitFor({ state: 'visible' });
    check((await page.locator('#order-state-label').innerText()) === 'STATUS UNAVAILABLE', 'Unavailable order API does not fabricate confirmation');
    await context.close();
  }
  {
    const { context, page } = await fixture();
    await page.clock.install();
    let polls = 0;
    await page.route('**/api/order-status', route => { polls += 1; return respond(route, { ok: true, order: { ...order, status: 'pending', amountTotal: null } }); });
    await page.goto(`${origin}/order.html#order=${token}`);
    await page.locator('#order-details').waitFor({ state: 'visible' });
    for (let index = 1; index < 8; index += 1) {
      await page.clock.runFor(3000);
      await page.waitForFunction(() => !document.querySelector('#order-refresh').disabled);
    }
    await page.clock.runFor(60000);
    check(polls === 8, 'Automatic pending-order polling stops after eight requests');
    check((await page.locator('#order-poll-note').innerText()).includes('taking a little longer'), 'Bounded polling ends with an honest manual retry option');
    await context.close();
  }
  check(report.errors.length === 0, 'No browser JavaScript exceptions');
  report.passed = true;
  console.log(`PASS: ${report.checks.length} mocked commerce browser checks. No live Stripe calls.`);
} catch (error) {
  report.passed = false;
  report.error = error.message;
  throw error;
} finally {
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  await new Promise(resolve => { builtServer.close(resolve); builtServer.closeAllConnections(); });
}
