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
  if (!/^(?:index\.html|order\.html|styles\.css|app\.js|order\.js|assets\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9._-]+)$/.test(filename)) { response.writeHead(404); response.end(); return; }
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
const config = { ok: true, available: true, mode: 'test', inventory: { status: 'in_stock' }, product: { name: 'ULTRA MACHO', unitAmount: 12345, currency: 'eur' }, quantityMax: 3, dispatchNotice: 'Dispatch notice supplied by the test API.', shippingSummary: 'Shipping summary supplied by the test API.' };
const soldOutConfig = { ...config, available: false, inventory: { status: 'sold_out' }, quantityMax: 0 };
const token = 'a'.repeat(43);
const order = { reference: 'FF-TEST-0001', status: 'paid', quantity: 2, amountTotal: 24690, currency: 'eur', dispatchNotice: config.dispatchNotice, mode: 'test', fulfillment: { status: 'awaiting_dispatch', carrier: null, trackingNumber: null, trackingUrl: null, shippedAt: null, returnedAt: null } };
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
  await page.waitForFunction(() => !document.querySelector('#checkout-form').hasAttribute('aria-busy'));
}

try {
  {
    const { context, page } = await fixture();
    await page.route('**/api/commerce', route => respond(route, { ok: true, available: false, mode: 'disabled' }));
    await page.goto(origin);
    await page.waitForLoadState('networkidle');
    check(await page.locator('#purchase-panel').isHidden(), 'Unavailable commerce stays hidden');
    check((await page.locator('#fragrance .product-facts').innerText()).includes('Made in Paris'), 'The confirmed manufacturing origin appears as a restrained product fact');
    check(/made in Paris/i.test(await page.locator('meta[name=description]').getAttribute('content')) && /made in Paris/i.test(await page.locator('meta[property="og:description"]').getAttribute('content')), 'Search and social descriptions include the confirmed Paris origin');
    await page.locator('.header-access').click();
    check(await page.locator('#waitlist-dialog').evaluate(dialog => dialog.open), 'Waitlist still opens when commerce is unavailable');
    check(await page.locator('iframe, script[src*="stripe.com"]').count() === 0, 'No embedded checkout or Stripe.js is loaded');
    await context.close();
  }
  for (const width of [320, 390, 1440]) {
    const { context, page } = await fixture(width);
    let checkoutRequests = 0;
    await page.route('**/api/commerce', route => respond(route, soldOutConfig));
    await page.route('**/api/checkout', route => { checkoutRequests += 1; return respond(route, { ok: false }, 409); });
    await page.goto(origin);
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    check((await page.locator('#commerce-availability-label').innerText()) === 'SOLD OUT.', 'Configured zero stock has an explicit sold-out state');
    check(await page.locator('#checkout-form').isHidden() && await page.locator('#purchase-price').isHidden(), 'Sold-out visitors are not offered a price or a new checkout');
    check((await page.locator('#checkout-quantity option').count()) === 0 && checkoutRequests === 0, 'Zero stock exposes no selectable quantity and makes no checkout request');
    await page.locator('#purchase-panel').scrollIntoViewIfNeeded();
    await page.evaluate(() => document.fonts.ready);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Sold-out invitation fits ${width}px`);
    const soldOutAxe = await new AxeBuilder({ page }).include('#purchase-panel').withTags(['wcag2a', 'wcag2aa']).analyze();
    check(soldOutAxe.violations.length === 0, `Sold-out state has no automated accessibility violations at ${width}px`);
    await page.screenshot({ path: path.join(artifacts, `sold-out-${width}.png`) });
    await page.locator('#commerce-waitlist-link').click();
    check(await page.locator('#waitlist-dialog').evaluate(dialog => dialog.open), 'Sold-out invitation opens the existing release list');
    await context.close();
  }
  {
    const { context, page } = await fixture();
    let currentConfig = { ...config, quantityMax: 2 };
    let outcome = 'progress';
    let catalogRequests = 0;
    const submissions = [];
    await page.route('**/api/commerce', route => { catalogRequests += 1; return respond(route, currentConfig); });
    await page.route('**/api/checkout', route => {
      submissions.push(route.request().postDataJSON());
      return respond(route, { ok: false, code: outcome === 'progress' ? 'CHECKOUT_IN_PROGRESS' : 'STOCK_UNAVAILABLE', message: 'Fixture availability update.' }, 409);
    });
    await page.goto(origin);
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    check((await page.locator('#checkout-quantity option').allTextContents()).join(',') === '1,2', 'Quantity options obey the current server inventory limit');
    await submit(page);
    check(catalogRequests === 1 && await page.locator('#checkout-form').isVisible(), 'A concurrent in-progress Checkout preserves its controls without a stock refresh');
    currentConfig = soldOutConfig;
    outcome = 'stock';
    await submit(page);
    check(catalogRequests === 2 && await page.locator('#checkout-form').isHidden(), 'A stock race refreshes inventory and hides unavailable new-purchase controls');
    check(await page.locator('#commerce-waitlist-link').evaluate(element => document.activeElement === element), 'A sold-out response moves keyboard focus to the release-list alternative');
    check((await page.locator('#checkout-status').innerText()).includes('Availability has changed'), 'A stock-race error remains visible outside the hidden checkout form');
    check(submissions[0].requestId === submissions[1].requestId && await page.evaluate(() => {
      const context = JSON.parse(sessionStorage.getItem('fabrevoie-checkout-request-v1'));
      return context?.started === false && context?.uncertain === false;
    }), 'Definitive stock rejection preserves the UUID while clearing started and uncertain states');
    await page.reload();
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    check(await page.locator('#checkout-form').isHidden(), 'A definitively rejected stock request cannot unlock sold-out checkout controls after reload');
    currentConfig = { ...config, quantityMax: 1 };
    outcome = 'progress';
    await page.reload();
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    await submit(page);
    check(submissions[2].requestId === submissions[1].requestId, 'The same unreserved request can retry after confirmed restock');
    await context.close();
  }
  {
    const { context, page } = await fixture(320);
    let currentConfig = { ...config, quantityMax: 1 };
    let expired = false;
    const submissions = [];
    await page.route('**/api/commerce', route => respond(route, currentConfig));
    await page.route('**/api/checkout', route => {
      submissions.push(route.request().postDataJSON());
      return expired ? respond(route, { ok: false, code: 'CHECKOUT_RESTART_REQUIRED' }, 409)
        : respond(route, { ok: true, url: 'https://checkout.stripe.com/c/pay/fixture_reserved' });
    });
    await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Mock reserved Checkout</title>' }));
    await page.goto(origin);
    await page.locator('#checkout-submit').click();
    await page.waitForURL('https://checkout.stripe.com/**');
    currentConfig = soldOutConfig;
    await page.goto(`${origin}/#fragrance`);
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    check(await page.locator('#checkout-form').isVisible() && await page.locator('.purchase-controls').isHidden(), 'A successful prior reservation can resume without offering new sold-out quantities');
    check(/Resume your checkout/i.test(await page.locator('#checkout-submit').innerText()), 'The reserved checkout action is clearly labeled');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Reserved-checkout controls fit 320px');
    await page.locator('#purchase-panel').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(artifacts, 'sold-out-resume-320.png') });
    await page.locator('#checkout-submit').click();
    await page.waitForURL('https://checkout.stripe.com/**');
    check(submissions[0].requestId === submissions[1].requestId && submissions[1].quantity === 1, 'Resuming a sold-out reservation sends its original request ID and quantity');
    expired = true;
    await page.goto(`${origin}/#fragrance`);
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    await submit(page);
    check(await page.locator('#checkout-form').isHidden() && (await page.locator('#checkout-status').innerText()).includes('can no longer be used'), 'An expired reservation removes resume controls and explains the failure');
    check(await page.evaluate(() => sessionStorage.getItem('fabrevoie-checkout-request-v1') === null), 'Only a definitive non-reusable reservation clears its context');
    await context.close();
  }
  for (const interruption of ['lost_response', 'navigation_during_request']) {
    const { context, page } = await fixture(320);
    let currentConfig = { ...config, quantityMax: 1 };
    let outcome = interruption;
    let heldRoute;
    const submissions = [];
    await page.route('**/api/commerce', route => respond(route, currentConfig));
    await page.route('**/api/checkout', route => {
      submissions.push(route.request().postDataJSON());
      currentConfig = soldOutConfig;
      if (outcome === 'lost_response') return route.abort('connectionfailed');
      if (outcome === 'navigation_during_request') { heldRoute = route; return; }
      if (outcome === 'restart') return respond(route, { ok: false, code: 'CHECKOUT_RESTART_REQUIRED' }, 409);
      return respond(route, { ok: true, url: 'https://checkout.stripe.com/c/pay/fixture_recovered' });
    });
    await page.route('https://checkout.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Mock recovered Checkout</title>' }));
    await page.goto(origin);
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    if (interruption === 'lost_response') await submit(page);
    else {
      const request = page.waitForRequest('**/api/checkout');
      await page.locator('#checkout-submit').click();
      await request;
    }
    check(await page.evaluate(() => JSON.parse(sessionStorage.getItem('fabrevoie-checkout-request-v1'))?.uncertain === true), `${interruption} retains uncertainty before any successful response`);
    await page.reload();
    if (heldRoute) await heldRoute.abort().catch(() => {});
    await page.locator('#purchase-panel').waitFor({ state: 'visible' });
    check(await page.locator('#checkout-form').isVisible() && await page.locator('.purchase-controls').isHidden() && /Check your checkout/i.test(await page.locator('#checkout-submit').innerText()), `${interruption} can recover the existing request after a sold-out reload`);
    check((await page.locator('#commerce-availability-message').innerText()).includes('could not be confirmed'), 'Uncertain recovery does not claim a reservation or payment is confirmed');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Uncertain checkout recovery fits 320px');
    if (interruption === 'lost_response') {
      outcome = 'valid';
      await page.locator('#checkout-submit').click();
      await page.waitForURL('https://checkout.stripe.com/**');
      await page.goto(`${origin}/#fragrance`);
      await page.locator('#purchase-panel').waitFor({ state: 'visible' });
      check(await page.evaluate(() => {
        const context = JSON.parse(sessionStorage.getItem('fabrevoie-checkout-request-v1'));
        return context?.started === true && context?.uncertain === false;
      }), 'A recovered successful response replaces uncertainty with confirmed Checkout creation');
    } else {
      outcome = 'restart';
      await submit(page);
      check(await page.locator('#checkout-form').isHidden() && await page.evaluate(() => sessionStorage.getItem('fabrevoie-checkout-request-v1') === null), 'A definitive restart rejection clears uncertainty and hides sold-out recovery');
    }
    check(submissions.length === 2 && submissions[0].requestId === submissions[1].requestId && submissions[1].quantity === 1, `${interruption} recovery reuses the original UUID and quantity`);
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
    check((await page.locator('#order-shipment-label').innerText()) === 'AWAITING DISPATCH' && await page.locator('#order-tracking-link').isHidden(), 'Persisted awaiting-dispatch status has no invented tracking link');
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
    let currentOrder = { ...order, fulfillment: null };
    let revision = 0;
    await page.route('**/api/order-status', route => respond(route, { ok: true, order: currentOrder }));
    const loadOrder = async () => {
      await page.goto(`${origin}/order.html?shipment=${revision++}#order=${token}`);
      await page.locator('#order-details').waitFor({ state: 'visible' });
    };
    await loadOrder();
    check(await page.locator('#order-shipment').isHidden(), 'A paid order with no persisted fulfillment record does not invent a dispatch status');
    for (const [status, label] of [['returned', 'RETURN RECORDED'], ['needs_review', 'SHIPMENT UNDER REVIEW']]) {
      currentOrder = { ...order, fulfillment: { ...order.fulfillment, status, trackingUrl: 'https://tracking.example/fixture' } };
      await loadOrder();
      check((await page.locator('#order-shipment-label').innerText()) === label && await page.locator('#order-dispatch').isHidden() && await page.locator('#order-tracking-link').isHidden(), `${status} displays its persisted exception without a routine dispatch promise`);
    }
    const shipped = { ...order.fulfillment, status: 'shipped', carrier: '<img src=x onerror=alert(1)> Test carrier', trackingNumber: 'TEST-TRACK-0001', trackingUrl: 'https://tracking.example/parcel/TEST-TRACK-0001', shippedAt: 1790899200000 };
    currentOrder = { ...order, fulfillment: shipped };
    await loadOrder();
    check((await page.locator('#order-shipment-label').innerText()) === 'SHIPPED' && await page.locator('#order-dispatch').isHidden(), 'Persisted shipment replaces the pre-dispatch notice');
    check((await page.locator('#order-carrier').innerText()).includes(shipped.carrier) && await page.locator('#order-carrier img').count() === 0, 'Carrier content is displayed as text, never injected as markup');
    check((await page.locator('#order-tracking-number').innerText()).includes('TEST-TRACK-0001'), 'The persisted tracking number is readable');
    check(await page.locator('#order-tracking-link').getAttribute('href') === shipped.trackingUrl && await page.locator('#order-tracking-link').getAttribute('referrerpolicy') === 'no-referrer' && /noopener/.test(await page.locator('#order-tracking-link').getAttribute('rel')), 'Validated HTTPS tracking has an isolated new tab and no referrer');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Shipment details and carrier text fit ${width}px`);
      await page.screenshot({ path: path.join(artifacts, `shipped-order-${width}.png`), fullPage: true });
      const shippingAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      check(shippingAxe.violations.length === 0, `Shipment details have no automated accessibility violations at ${width}px`);
    }
    for (const trackingUrl of ['http://tracking.example/parcel', 'javascript:alert(1)', 'https://user:secret@tracking.example/parcel', 'https://tracking.example:8443/parcel', '//tracking.example/parcel', 'https://tracking.example/unsafe\npath']) {
      currentOrder = { ...order, fulfillment: { ...shipped, trackingUrl } };
      await loadOrder();
      check(await page.locator('#order-tracking-link').isHidden() && await page.locator('#order-tracking-link').getAttribute('href') === null, 'Unsafe or non-HTTPS tracking input cannot create a navigable link');
    }
    for (const status of ['pending', 'processing', 'payment_failed', 'expired', 'refunded', 'partially_refunded']) {
      currentOrder = { ...order, status, fulfillment: shipped };
      await loadOrder();
      check(await page.locator('#order-shipment').isHidden() && await page.locator('#order-dispatch').isHidden(), `${status} cannot imply routine fulfillment from an independent shipment record`);
    }
    currentOrder = { ...order, fulfillment: shipped };
    await loadOrder();
    await page.unroute('**/api/order-status');
    await page.route('**/api/order-status', route => respond(route, { ok: false }, 503));
    await page.locator('#order-refresh').click();
    await page.waitForFunction(() => !document.querySelector('#order-refresh').disabled);
    check(await page.locator('#order-shipment').isHidden() && await page.locator('#order-dispatch').isHidden(), 'A failed status refresh suppresses stale fulfillment claims');
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
