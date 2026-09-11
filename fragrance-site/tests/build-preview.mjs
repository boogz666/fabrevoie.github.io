// Exercise the production build without provisioning storage or touching a live API.
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { createSiteServer } from '../server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(root, 'tests', 'artifacts');
await mkdir(artifacts, { recursive: true });
const buildEnv = { ...process.env, VERCEL: '1', PUBLIC_SITE_URL: 'https://fabrevoie.vercel.app' };
delete buildEnv.DATABASE_URL;
delete buildEnv.RATE_LIMIT_SECRET;
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, env: buildEnv, encoding: 'utf8' });
assert.equal(build.status, 0, build.stderr);
const html = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
assert.doesNotMatch(html, /mytholog|testosterone|hormone|handkerchief|archive-linen/i);
assert.match(html, /<form hidden id="signup-form"/);
assert.match(html, /class="signup-unavailable"/);
assert.match(html, /data-signup-available="false"/);
assert.match(html, /<link rel="canonical" href="https:\/\/fabrevoie.vercel.app\/">/);
const files = (await readdir(path.join(root, 'dist', 'assets'), { recursive: true })).filter(file => path.extname(file));
assert.ok(!files.some(file => /archive|manifest|-src\.|iris-/i.test(file)));
const assetPaths = files.map(file => file.replaceAll('\\', '/'));
assert.deepEqual(assetPaths.filter(file => file.startsWith('analog/')).sort(), [
  'analog/campaign-02-640.webp', 'analog/campaign-02.webp',
  'analog/campaign-06-640.webp', 'analog/campaign-06.webp',
  'analog/web-hero-wide-960.webp', 'analog/web-hero-wide.webp',
]);
assert.ok(assetPaths.includes('signature/web-product-side.webp'));
assert.ok(!assetPaths.some(file => file.startsWith('pleasure/campaign-') || file.startsWith('fast-life/')));

const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'fabrevoie-build-'));
const server = await createSiteServer({ publicDir: path.join(root, 'dist'), dataDir: temporaryRoot, logger: { error() {} } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH || (existsSync(edge) ? edge : undefined) });
const report = { passed: false, assets: files.length, signup: 'disabled: no DATABASE_URL', checks: [], accessibility: [] };
try {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(async () => { for (const img of document.images) { img.loading = 'eager'; await img.decode(); } });
    assert.equal(await page.locator('#signup-form').isVisible(), false);
    assert.equal(await page.locator('.signup-unavailable').isVisible(), true);
    assert.equal(await page.locator('#waitlist-dialog').evaluate(dialog => dialog.open), false);
    assert.match(await page.locator('.signup-title').innerText(), /Your invitation is coming/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    report.accessibility.push({ width, violations: result.violations });
    assert.equal(result.violations.length, 0);
    await page.screenshot({ path: path.join(artifacts, `cloud-preview-${width}.png`), fullPage: true });
    await page.locator('#first-release').screenshot({ path: path.join(artifacts, `cloud-release-${width}.png`) });
    report.checks.push(`${width}px: disabled signup, visible opening notice, valid layout, zero accessibility violations`);
  }
  report.passed = true;
  console.log(`PASS: production build excludes lore/private assets and honestly disables unavailable signup; desktop/mobile checks pass (${files.length} assets).`);
} catch (error) {
  report.error = error.message;
  throw error;
} finally {
  await writeFile(path.join(artifacts, 'build-preview-report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
  assert.equal(path.dirname(path.resolve(temporaryRoot)), path.resolve(tmpdir()));
  assert.ok(path.basename(temporaryRoot).startsWith('fabrevoie-build-'));
  await rm(temporaryRoot, { recursive: true, force: true });
}
