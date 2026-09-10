import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createSiteServer } from '../server.mjs';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(siteDir, 'tests/artifacts/waitlist-popup');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'fabrevoie-popup-'));
await mkdir(artifacts, { recursive: true });
const server = await createSiteServer({ dataDir: temporaryRoot, rateLimitMax: 100, logger: { error() {} } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const initialTime = Date.parse('2026-09-10T12:00:00Z');
const report = { checks: [], scenarios: [], accessibility: [], browserErrors: [] };
let browser;

function check(condition, message) {
  assert.ok(condition, message);
  report.checks.push(message);
}

function storedRows() {
  const db = new DatabaseSync(path.join(temporaryRoot, 'signups.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT email, consent_version FROM signups').all(); }
  finally { db.close(); }
}

async function until(predicate, message) {
  const deadline = Date.now() + 8000;
  while (!(await predicate())) {
    assert.ok(Date.now() < deadline, message);
    await delay(30);
  }
}

async function isOpen(page, selector = '#waitlist-dialog') {
  return page.locator(selector).evaluate(element => element.open);
}

async function openInvitation(page) {
  await page.locator('.header-access[data-open-signup]').click();
  await until(() => isOpen(page), 'Explicit invitation CTA should open its dialog');
}

async function signup(page, email) {
  await page.locator('#popup-signup-email').fill(email);
  await page.locator('#popup-signup-consent').check();
  await page.locator('#popup-signup-form button[type=submit]').click();
  await until(async () => await page.locator('#popup-signup-status').getAttribute('data-state') === 'success', 'Popup signup should confirm API success');
  return page.locator('#popup-signup-status a[href*="#withdraw="]').getAttribute('href');
}

async function withdrawUsingLink(page, link) {
  await page.goto(link, { waitUntil: 'networkidle' });
  check(await isOpen(page, '#privacy-dialog'), 'Private withdrawal URL opens the privacy controls');
  check(!(await isOpen(page)), 'Withdrawal controls do not stack an invitation dialog');
  await page.locator('#withdraw-signup').click();
  await until(async () => await page.locator('#withdraw-status').getAttribute('data-state') === 'success', 'Withdrawal should be confirmed through the UI');
}

async function scenario(name, run, options = {}) {
  const context = await browser.newContext({ viewport: options.viewport || { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  if (options.storageBlocked) {
    await context.addInitScript(() => {
      for (const method of ['getItem', 'setItem', 'removeItem']) {
        Object.defineProperty(Storage.prototype, method, { configurable: true, value() { throw new DOMException('Storage unavailable in this browser', 'SecurityError'); } });
      }
    });
  }
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => report.browserErrors.push({ scenario: name, message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('503 (Service Unavailable)')) report.browserErrors.push({ scenario: name, message: message.text() });
  });
  await page.clock.install({ time: new Date(initialTime - 60_000) });
  await page.clock.pauseAt(new Date(initialTime));
  if (options.unavailable) {
    await page.route(origin + '/', async route => {
      const response = await route.fetch();
      const original = await response.text();
      assert.match(original, /data-signup-available="true"/);
      await route.fulfill({ response, body: original.replace('data-signup-available="true"', 'data-signup-available="false"') });
    });
  }
  try {
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await run(page, context);
    report.scenarios.push({ name, passed: true });
    console.log(`PASS: ${name}`);
  } catch (error) {
    report.scenarios.push({ name, passed: false, error: error.message });
    await page.clock.resume().catch(() => {});
    await page.screenshot({ path: path.join(artifacts, `${name}-failure.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined) });

  await scenario('explicit-dialog-and-focus', async page => {
    check(!(await isOpen(page)), 'Invitation does not appear immediately on arrival');
    await openInvitation(page);
    check(await page.evaluate(() => document.querySelector('#waitlist-dialog').contains(document.activeElement)), 'Opening the invitation moves keyboard focus into its dialog');
    check(!(await page.locator('#popup-signup-consent').isChecked()), 'Popup consent starts unchecked');
    for (let count = 0; count < 10; count++) await page.keyboard.press('Tab');
    check(await page.evaluate(() => document.querySelector('#waitlist-dialog').contains(document.activeElement)), 'Native modal keeps keyboard navigation inside the invitation');
    await page.keyboard.press('Escape');
    check(!(await isOpen(page)), 'Escape dismisses the invitation');
    check(await page.locator('.header-access').evaluate(element => document.activeElement === element), 'Escape restores focus to the invitation CTA');
    await openInvitation(page);
    const box = await page.locator('#waitlist-dialog').boundingBox();
    assert.ok(box.x > 10, 'Desktop dialog should leave a clickable backdrop');
    await page.mouse.click(5, Math.max(5, box.y + 20));
    check(!(await isOpen(page)), 'Clicking outside the dialog on its backdrop dismisses it');
    check(await page.locator('.header-access').evaluate(element => document.activeElement === element), 'Backdrop dismissal restores focus to the CTA');
  });

  await scenario('consent-persistence-and-withdrawal', async page => {
    let posts = 0;
    page.on('request', request => { if (request.url() === origin + '/api/signup' && request.method() === 'POST') posts++; });
    await openInvitation(page);
    await page.locator('#popup-signup-email').fill('popup-reader@example.test');
    await page.locator('#popup-signup-form button[type=submit]').click();
    check(posts === 0 && storedRows().length === 0, 'Missing popup consent neither sends a signup nor creates a database row');
    const link = await signup(page, 'popup-reader@example.test');
    check(posts === 1 && storedRows()[0]?.email === 'popup-reader@example.test', 'Popup signup persists the exact subscriber through the real local API');
    check(Boolean(storedRows()[0]?.consent_version), 'Popup signup records the consent version');
    check(Boolean(link?.includes('#withdraw=')), 'Confirmed popup signup supplies a private withdrawal link');
    await page.keyboard.press('Escape');
    await page.clock.setSystemTime(new Date(initialTime + 8 * 86_400_000));
    await page.reload({ waitUntil: 'networkidle' });
    await page.clock.fastForward(60_000);
    check(!(await isOpen(page)), 'Confirmed signup suppresses automatic invitations after the dismissal window has expired');
    await withdrawUsingLink(page, link);
    check(storedRows().length === 0, 'Private-link withdrawal removes the popup signup from persistent storage');
  });

  await scenario('cross-tab-confirmed-signup', async (page, context) => {
    await openInvitation(page);
    const secondTab = await context.newPage();
    secondTab.on('pageerror', error => report.browserErrors.push({ scenario: 'cross-tab-confirmed-signup', message: error.message }));
    let link;
    try {
      await secondTab.goto(origin, { waitUntil: 'networkidle' });
      await openInvitation(secondTab);
      link = await signup(secondTab, 'second-tab-reader@example.test');
      check(storedRows()[0]?.email === 'second-tab-reader@example.test', 'A second tab can confirm a persistent popup signup');
      await page.bringToFront();
      await page.locator('#waitlist-dialog [data-close]').click();
      const remembered = await page.evaluate(() => JSON.parse(localStorage.getItem('fabrevoie-invitation-state-v1')));
      check(remembered.joined === true, 'Dismissing an older tab preserves the signup confirmed in another tab');
    } finally { await secondTab.close(); }
    await withdrawUsingLink(page, link);
    check(storedRows().length === 0, 'The cross-tab signup can be withdrawn through its private-link UI');
  });

  await scenario('failed-api-keeps-email', async page => {
    await page.route('**/api/signup', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'The release list is temporarily unavailable. Please try again.' }) }));
    await openInvitation(page);
    await page.locator('#popup-signup-email').fill('retry-popup@example.test');
    await page.locator('#popup-signup-consent').check();
    await page.locator('#popup-signup-form button[type=submit]').click();
    await until(async () => await page.locator('#popup-signup-status').getAttribute('data-state') === 'error', 'Failed popup request should expose its error');
    check(await page.locator('#popup-signup-email').inputValue() === 'retry-popup@example.test', 'Failed API response preserves the entered popup email');
    check(!(await page.locator('#popup-signup-form button[type=submit]').isDisabled()), 'Failed API response leaves the popup available for retry');
    check(storedRows().length === 0, 'Failed API response creates no persistent subscriber');
  });

  await scenario('automatic-delay-and-dismissal', async page => {
    await page.clock.fastForward(14_999);
    check(!(await isOpen(page)), 'Automatic invitation waits through the first 14,999 milliseconds');
    await page.clock.fastForward(1);
    check(await isOpen(page), 'Eligible visitor receives the invitation at 15 seconds');
    await page.locator('#waitlist-dialog [data-close]').click();
    await page.reload({ waitUntil: 'networkidle' });
    await page.clock.fastForward(60_000);
    check(!(await isOpen(page)), 'Dismissal suppresses automatic invitations across a reload');
    await openInvitation(page);
    check(await isOpen(page), 'A dismissed invitation can still be opened explicitly');
    await page.keyboard.press('Escape');
    await page.clock.setSystemTime(new Date(initialTime + 8 * 86_400_000));
    await page.reload({ waitUntil: 'networkidle' });
    await page.clock.fastForward(15_000);
    check(await isOpen(page), 'Automatic invitations become eligible again after the seven-day dismissal window');
  });

  await scenario('does-not-interrupt-dialog', async page => {
    await page.locator('footer [data-privacy]').click();
    await page.clock.fastForward(15_000);
    check(await isOpen(page, '#privacy-dialog') && !(await isOpen(page)), 'Automatic invitation does not interrupt an open privacy dialog');
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.clock.fastForward(5_000);
    check(await isOpen(page), 'Deferred invitation can open after the other dialog closes');
  });

  await scenario('does-not-interrupt-input', async page => {
    await page.locator('#signup-email').evaluate(element => element.focus({ preventScroll: true }));
    await page.clock.fastForward(15_000);
    check(!(await isOpen(page)), 'Automatic invitation does not interrupt a focused email input');
    check(await page.locator('#signup-email').evaluate(element => document.activeElement === element), 'Input focus remains intact when automatic opening is deferred');
    await page.locator('#signup-email').evaluate(element => element.blur());
    await page.clock.fastForward(5_000);
    check(await isOpen(page), 'Deferred invitation can open after input editing ends');
  });

  await scenario('does-not-duplicate-visible-inline-form', async page => {
    await page.locator('#signup-form').scrollIntoViewIfNeeded();
    await page.clock.fastForward(15_000);
    check(!(await isOpen(page)), 'Automatic invitation stays closed while the inline release form is visible');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.clock.fastForward(5_000);
    check(await isOpen(page), 'Visitor remains eligible after leaving the inline form');
  });

  await scenario('optional-browser-storage', async page => {
    await openInvitation(page);
    const link = await signup(page, 'storage-blocked@example.test');
    check(storedRows()[0]?.email === 'storage-blocked@example.test', 'Signup remains persistent when browser storage throws');
    check(Boolean(link?.includes('#withdraw=')), 'Storage failure still supplies a usable private withdrawal link');
    await withdrawUsingLink(page, link);
    check(storedRows().length === 0, 'Private-link withdrawal works after navigation with browser storage unavailable');
  }, { storageBlocked: true });

  for (const width of [320, 390]) {
    await scenario(`mobile-${width}`, async page => {
      await page.locator('.hero [data-open-signup]').click();
      check(await isOpen(page), `Mobile hero CTA opens the invitation at ${width}px`);
      const fit = await page.locator('#waitlist-dialog').evaluate(element => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, viewportWidth: innerWidth, viewportHeight: innerHeight };
      });
      check(fit.left >= -1 && fit.right <= width + 1 && fit.top >= -1 && fit.bottom <= fit.viewportHeight + 1 && fit.scrollWidth <= fit.clientWidth + 1, `Invitation fits the ${width}px mobile viewport without horizontal overflow`);
      await page.clock.resume();
      await page.screenshot({ path: path.join(artifacts, `mobile-${width}.png`) });
      const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      report.accessibility.push({ viewport: width, violations: result.violations });
      check(result.violations.length === 0, `Open invitation has no automated WCAG A/AA violations at ${width}px`);
    }, { viewport: { width, height: 844 } });
  }

  await scenario('unavailable-state', async page => {
    let posts = 0;
    page.on('request', request => { if (request.url() === origin + '/api/signup' && request.method() === 'POST') posts++; });
    await page.clock.fastForward(60_000);
    check(!(await isOpen(page)), 'Unavailable release list never opens an automatic invitation');
    await page.locator('.header-access[data-open-signup]').click();
    check(!(await isOpen(page)), 'Unavailable release list does not open from an explicit CTA');
    await page.evaluate(() => {
      for (const form of document.querySelectorAll('[data-signup-form]')) {
        form.querySelector('[name=email]').value = 'unavailable@example.test';
        form.querySelector('[name=consent]').checked = true;
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });
    await page.clock.fastForward(1000);
    check(posts === 0 && storedRows().length === 0, 'Unavailable HTML blocks both popup and inline signup requests');
  }, { unavailable: true });

  check(report.browserErrors.length === 0, 'Popup scenarios produce no unexpected JavaScript, missing-asset or CSP errors');
  check(storedRows().length === 0, 'All temporary popup subscribers have been withdrawn through the UI');
  report.passed = true;
  console.log(`PASS: ${report.checks.length} popup checks across ${report.scenarios.length} scenarios.`);
} catch (error) {
  report.passed = false;
  report.error = error.message;
  throw error;
} finally {
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  assert.equal(path.dirname(path.resolve(temporaryRoot)), path.resolve(tmpdir()));
  assert.ok(path.basename(temporaryRoot).startsWith('fabrevoie-popup-'));
  await rm(temporaryRoot, { recursive: true, force: true });
}
