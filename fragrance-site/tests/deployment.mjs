import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = (process.env.DEPLOYMENT_URL || 'https://fabrevoie.vercel.app').replace(/\/$/, '');
const canonicalOrigin = (process.env.EXPECTED_CANONICAL_URL || 'https://fabrevoie.com').replace(/\/$/, '');
const expectLiveSignup = process.argv.includes('--signup-live');
const artifactDir = path.resolve('tests/artifacts');
await mkdir(artifactDir, { recursive: true });
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ executablePath: existsSync(edge) ? edge : undefined });
const report = { origin, signup: expectLiveSignup ? 'testing cloud storage' : 'not tested (read-only)', checks: [], errors: [] };
const check = (condition, message) => { assert.ok(condition, message); report.checks.push(message); };
let removalToken;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.setItem('fabrevoie-invitation-state-v1', JSON.stringify({ dismissedUntil: Date.now() + 86400000 })));
  page.on('pageerror', error => report.errors.push(error.message));
  const response = await page.goto(origin, { waitUntil: 'networkidle' });
  check(response.status() === 200, 'Public HTTPS page responds successfully');
  await page.evaluate(() => document.fonts.ready);
  check((await page.locator('h1').innerText()).replace(/\s+/g, ' ').trim() === 'ULTRA MACHO', 'Product name is the primary live heading');
  check(await page.locator('.hero-slogan').innerText() === 'The pleasure is yours.', 'Approved supporting slogan is live');
  check(await page.evaluate(() => document.fonts.check('italic 900 100px HelveticaDisplay') && document.fonts.check('400 16px Founders') && getComputedStyle(document.querySelector('h1')).fontFamily.includes('HelveticaDisplay')), 'Production bold extended typography loads and applies');
  check(await page.locator('link[rel=canonical]').getAttribute('href') === canonicalOrigin + '/', 'Canonical points to the official domain');
  check(await page.locator('meta[property="og:image"]').getAttribute('content') === canonicalOrigin + '/assets/pleasure/og-pleasure.jpg', 'Absolute B2 campaign sharing image is configured');
  check(await page.locator('canvas, model-viewer, iframe').count() === 0, 'No 3D viewer or embedded third-party content');
  check((await page.locator('#product-image').getAttribute('src')).includes('web-product-three-quarter'), 'The signature photograph is first in the published product gallery');
  const sideLabelImage = await page.locator('.gallery-tab').nth(2).getAttribute('data-image');
  check(sideLabelImage.includes('side') && !sideLabelImage.includes('three-quarter'), 'The published product gallery includes a dedicated side-label photograph');
  const campaignImages = await page.locator('.campaign-image-link').evaluateAll(links => links.map(link => link.href));
  check(campaignImages.length === 2 && new Set(campaignImages).size === 2, 'Exactly two selected campaign advertisements are published');
  check(await page.locator('img[src*="iris-"], [data-image*="iris-"], [srcset*="iris-"]').count() === 0, 'Retired cap imagery is absent from the official homepage');
  await page.locator('.campaign-image-link').last().click();
  check(await page.locator('#campaign-dialog').evaluate(dialog => dialog.open)
    && await page.locator('#campaign-expanded-image').getAttribute('src') === campaignImages[1], 'Published campaign opens the selected full-size artwork');
  await page.keyboard.press('Escape');
  check(await page.locator('#mythology, #mythology-title, #mythology-note, details, [href="#mythology"]').count() === 0, 'Removed lore and its navigation are absent from production');
  check(!/mytholog|testosterone|hormone|handkerchief|DNA sampling|extraction process|broken-hearted/i.test(await page.locator('body').textContent()), 'Production contains no fictional manufacturing or hormonal claims');
  check(await page.locator('a[href*="shop.html"]').count() === 0, 'Retired footwear shop is absent from navigation');
  check(await page.locator('a[href="mailto:support@fabrevoie.com"]').count() >= 2, 'Support address appears in public contact and privacy information');
  const missingAnchors = await page.evaluate(() => [...document.querySelectorAll('a[href^="#"]')]
    .map(link => link.getAttribute('href')).filter(href => href.length > 1 && !document.getElementById(href.slice(1))));
  check(missingAnchors.length === 0, 'Production internal navigation has no broken section links');
  const signupVisible = await page.locator('#signup-form').isVisible();
  if (expectLiveSignup) check(signupVisible, 'Signup form is enabled for explicit cloud verification');
  else report.signup = signupVisible ? 'form visible; storage not tested (read-only)' : 'waiting for database; storage not tested (read-only)';
  if (!signupVisible) check(await page.locator('.signup-unavailable').isVisible(), 'Opening-soon notice appears while cloud signup is disabled');
  if (signupVisible) {
    await page.locator('.header-access').click();
    check(await page.locator('#waitlist-dialog').evaluate(dialog => dialog.open), 'Styled waitlist invitation opens on the live site');
    await page.screenshot({ path: path.join(artifactDir, 'vercel-waitlist-desktop.png') });
    await page.keyboard.press('Escape');
  }
  for (const requestPath of ['/shop.html', '/checkout.html', '/products.html']) {
    const legacy = await page.request.get(origin + requestPath, { maxRedirects: 0 });
    check(legacy.status() === 307 && legacy.headers().location === '/', `Retired sneaker route redirects temporarily: ${requestPath}`);
  }
  const errors = await page.evaluate(async () => {
    const failed = [];
    for (const img of document.images) { img.loading = 'eager'; await img.decode().catch(() => failed.push(img.src)); }
    return failed;
  });
  check(errors.length === 0, 'All deployed imagery and brand assets load');
  for (const requestPath of ['/assets/archive-linen.webp', '/assets/archive-src.png', '/assets/asset-manifest.json', '/.env.local', '/data/signups.sqlite', '/server.mjs']) {
    const result = await page.request.get(origin + requestPath);
    check([403, 404].includes(result.status()), `Private/unpublished path is unavailable: ${requestPath}`);
  }
  // The default verification is read-only. API mutations require an explicit flag.
  if (expectLiveSignup) {
    const invalid = await page.evaluate(async () => {
      const result = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'invalid', consent: false }) });
      return { status: result.status, body: await result.json() };
    });
    check(invalid.status === 400 && invalid.body.ok === false, 'Cloud API routes and validates input');
    const result = await page.evaluate(async email => {
      const response = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, consent: true, website: '' }) });
      return { status: response.status, body: await response.json() };
    }, `deployment-check-${Date.now()}@example.test`);
    removalToken = result.body.removalToken;
    check(result.status === 200 && result.body.ok === true && typeof removalToken === 'string', 'Cloud signup writes successfully and returns a private withdrawal key');
    if (removalToken) {
      const removed = await page.evaluate(async token => {
        const response = await fetch('/api/signup', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
        return { status: response.status, body: await response.json() };
      }, removalToken);
      check(removed.status === 200 && removed.body.ok === true, 'Test signup is withdrawn successfully');
      removalToken = undefined;
    }
    report.signup = 'active; test signup withdrawn';
  }
  check(report.errors.length === 0, 'No production JavaScript exceptions');
  check((await page.locator('.footer-brand').boundingBox()).width <= 160, 'Production desktop footer wordmark is compact');
  await page.screenshot({ path: path.join(artifactDir, 'vercel-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(artifactDir, 'vercel-mobile.png'), fullPage: true });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Production mobile page fits its viewport');
  check((await page.locator('.footer-brand').boundingBox()).width <= 140, 'Production mobile footer wordmark is compact');
  report.passed = true;
  console.log(`PASS: ${report.checks.length} live deployment checks. Signup: ${report.signup}.`);
} catch (error) {
  report.passed = false;
  report.error = error.message;
  throw error;
} finally {
  if (removalToken) {
    await fetch(`${origin}/api/signup`, { method: 'DELETE', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token: removalToken }) }).catch(() => {});
  }
  await writeFile(path.join(artifactDir, 'deployment-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
}
