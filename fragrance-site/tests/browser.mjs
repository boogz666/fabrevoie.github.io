import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createSiteServer } from '../server.mjs';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(siteDir, 'tests', 'artifacts');
await mkdir(artifacts, { recursive: true });
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'fabrevoie-browser-'));
const server = await createSiteServer({ dataDir: temporaryRoot, rateLimitMax: 100, logger: { error() {} } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const windowsEdge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const executablePath = process.env.BROWSER_PATH || (existsSync(windowsEdge) ? windowsEdge : undefined);
const browser = await chromium.launch({ headless: true, executablePath });
const report = { checks: [], screenshots: [], accessibility: [] };
const errors = [];
function check(condition, message) { assert.ok(condition, message); report.checks.push(message); }
function storedRows() {
  const db = new DatabaseSync(path.join(temporaryRoot, 'signups.sqlite'), { readOnly: true });
  try { return db.prepare('SELECT email, consent_version FROM signups').all(); }
  finally { db.close(); }
}
async function prepare(page) {
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    for (const img of document.images) {
      img.loading = 'eager';
      await img.decode().catch(() => {});
    }
  });
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  // Popup timing and repeat-visit behavior have a dedicated test suite.
  await context.addInitScript(() => localStorage.setItem('fabrevoie-invitation-state-v1', JSON.stringify({ dismissedUntil: Date.now() + 86400000 })));
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await prepare(page);
  check(await page.title() === 'FABREVOIE — ULTRA MACHO · NEVER APOLOGIZE.', 'Correct brand and headline in title');
  check((await page.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === 'ULTRA MACHO', 'Product name is the primary heading');
  check(await page.locator('.hero-slogan').innerText() === 'NEVER APOLOGIZE.', 'Approved slogan supports the product heading');
  check(await page.evaluate(() => document.fonts.check('italic 900 100px HelveticaDisplay') && document.fonts.check('400 16px Founders') && getComputedStyle(document.querySelector('h1')).fontFamily.includes('HelveticaDisplay')), 'Local bold extended display and Founders fonts load and apply');
  check(await page.locator('canvas, model-viewer, iframe').count() === 0, 'No 3D viewer or embedded third-party content');
  const broken = await page.evaluate(() => [...document.images].filter(img => !img.complete || img.naturalWidth === 0).map(img => img.src));
  check(broken.length === 0, 'All product and brand images load');
  check(await page.locator('#mythology, #mythology-title, #mythology-note, details, [href="#mythology"]').count() === 0, 'Lore sections, dossiers and old navigation are removed');
  check(!/mytholog|testosterone|hormone|handkerchief|DNA sampling|extraction process|broken-hearted/i.test(await page.locator('body').textContent()), 'No fictional manufacturing or hormonal claims remain');
  check(await page.locator('a[href*="shop.html"]').count() === 0, 'Retired footwear shop is absent from navigation');
  check(await page.locator('a[href="mailto:support@fabrevoie.com"]').count() >= 2, 'Published support address appears in footer and privacy information');
  const missingAnchors = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')]
    .map(link => link.getAttribute('href')).filter(href => href.length > 1 && !document.getElementById(href.slice(1))));
  check(missingAnchors.length === 0, 'Every internal navigation link points to an existing section');
  check((await page.locator('#first-release').innerText()).includes('1 October')
    && (await page.locator('footer').innerText()).includes('2026'), 'Planned 1 October 2026 release remains visible');
  await page.screenshot({ path: path.join(artifacts, 'desktop-hero.png') });
  await page.screenshot({ path: path.join(artifacts, 'desktop-full.png'), fullPage: true });
  report.screenshots.push('desktop-hero.png', 'desktop-full.png');
  const desktopAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  report.accessibility.push({ viewport: 'desktop', violations: desktopAxe.violations });

  await page.getByRole('button', { name: '02 The silver', exact: false }).click();
  check((await page.locator('#product-image').getAttribute('src')).includes('iris-detail'), 'Product detail gallery changes to the approved Iris silver cap');
  await page.locator('.product-image-button').click();
  check(await page.locator('#image-dialog').evaluate(element => element.open), 'Product photograph expands into accessible dialog');
  await page.keyboard.press('ArrowRight');
  check((await page.locator('#expanded-image').getAttribute('src')).includes('iris-side'), 'Gallery keyboard arrows show the Iris signature view');
  await page.keyboard.press('Escape');
  check(!(await page.locator('#image-dialog').evaluate(element => element.open)), 'Escape closes the gallery');
  await page.locator('#signup-email').fill('first-reader@example.test');
  check(!(await page.locator('#signup-consent').isChecked()), 'Email consent is unchecked by default');
  await page.locator('#signup-form button[type=submit]').click();
  check(storedRows().length === 0, 'Missing consent cannot create signup');
  await page.locator('#signup-consent').check();
  await page.locator('#signup-form button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#signup-status').dataset.state === 'success');
  check(storedRows()[0]?.email === 'first-reader@example.test', 'Real browser signup is durably stored');
  const savedLink = await page.locator('#signup-status a').getAttribute('href');
  check(savedLink.includes('#withdraw='), 'Successful new signup offers a private withdrawal link');
  const originalKeys = await page.evaluate(() => JSON.parse(localStorage.getItem('fabrevoie-withdrawal-keys-v1')));
  check(originalKeys.length === 1, 'Private withdrawal key saved in this browser');
  await page.locator('#signup-email').fill('FIRST-READER@example.test');
  await page.locator('#signup-consent').check();
  await page.locator('#signup-form button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#signup-form .submit-label').textContent === 'Joined');
  check(storedRows().length === 1, 'Repeat signup does not duplicate a subscriber');
  check(await page.evaluate(() => JSON.parse(localStorage.getItem('fabrevoie-withdrawal-keys-v1')).length) === 1, 'Repeat signup preserves private withdrawal key');
  await page.evaluate(key => localStorage.setItem('fabrevoie-withdrawal-keys-v1', JSON.stringify(['bad-key', key, key])), originalKeys[0]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.locator('footer [data-privacy]').click();
  await page.locator('#withdraw-signup').click();
  await page.waitForFunction(() => document.querySelector('#withdraw-status').dataset.state === 'success');
  check(storedRows().length === 0, 'Withdrawal deletes persisted signup even after malformed browser storage');
  await page.keyboard.press('Escape');

  await page.route('**/api/signup', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, message: 'We couldn’t save your signup. Please try again later.' }) }));
  await page.locator('#signup-email').fill('retry@example.test');
  await page.locator('#signup-consent').check();
  await page.locator('#signup-form button[type=submit]').click();
  await page.waitForFunction(() => document.querySelector('#signup-status').dataset.state === 'error');
  check(await page.locator('#signup-email').inputValue() === 'retry@example.test', 'Failed signup keeps email for retry and displays an error');
  await page.unroute('**/api/signup');

  for (const width of [320, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: width < 760 ? 844 : 1000 });
    await page.goto(origin, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const overflow = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, heading: document.querySelector('h1').scrollWidth, headingClient: document.querySelector('h1').clientWidth }));
    check(overflow.document <= width && overflow.heading <= overflow.headingClient + 1, `No page or headline overflow at ${width}px`);
    if (width === 390) {
      await prepare(page);
      await page.screenshot({ path: path.join(artifacts, 'mobile-hero.png') });
      await page.screenshot({ path: path.join(artifacts, 'mobile-full.png'), fullPage: true });
      report.screenshots.push('mobile-hero.png', 'mobile-full.png');
      await page.locator('.menu-toggle').click();
      check(await page.locator('#menu-dialog').evaluate(element => element.open), 'Mobile navigation opens');
      await page.locator('#menu-dialog a[href="#first-release"]').click();
      check(!(await page.locator('#menu-dialog').evaluate(element => element.open)), 'Mobile navigation closes after selecting signup');
      const mobileAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
      report.accessibility.push({ viewport: 'mobile', violations: mobileAxe.violations });
    }
  }
  report.browserErrors = errors.filter(error => !error.includes('503 (Service Unavailable)'));
  check(report.browserErrors.length === 0, 'No unexpected JavaScript, missing asset or CSP errors');
  const violations = report.accessibility.flatMap(result => result.violations);
  report.passed = violations.length === 0;
  await writeFile(path.join(artifacts, 'browser-report.json'), JSON.stringify(report, null, 2));
  check(violations.length === 0, 'No automated WCAG A/AA violations on desktop or mobile');
  console.log(`PASS: ${report.checks.length} browser checks; desktop/mobile screenshots saved in tests/artifacts.`);
} catch (error) {
  report.passed = false;
  report.error = error.message;
  await writeFile(path.join(artifacts, 'browser-report.json'), JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  assert.equal(path.dirname(path.resolve(temporaryRoot)), path.resolve(tmpdir()));
  assert.ok(path.basename(temporaryRoot).startsWith('fabrevoie-browser-'));
  await rm(temporaryRoot, { recursive: true, force: true });
}
