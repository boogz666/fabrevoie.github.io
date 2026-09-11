import { readFile, writeFile, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'public');
const output = path.join(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') throw new Error('Unsafe build output.');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'assets'), { recursive: true });
let html = await readFile(path.join(input, 'index.html'), 'utf8');
const css = await readFile(path.join(input, 'styles.css'), 'utf8');
const js = await readFile(path.join(input, 'app.js'), 'utf8');
const orderHtml = await readFile(path.join(input, 'order.html'), 'utf8');
const orderJs = await readFile(path.join(input, 'order.js'), 'utf8');
const pendingCloudStorage = process.env.VERCEL === '1' && (!process.env.DATABASE_URL || !process.env.RATE_LIMIT_SECRET);
if (pendingCloudStorage) {
  html = html.replace('data-signup-available="true"', 'data-signup-available="false"');
  html = html.replace('class="header-access" href="#first-release">Join the list', 'class="header-access" href="#first-release">Release details');
  html = html.replace('class="button button-dark" href="#first-release">Join the first release', 'class="button button-dark" href="#first-release">Discover the release');
  html = html.replace('Leave your email for first-release news.', 'The release list opens shortly.');
  html = html.replace('class="signup-title">Be on the list.', 'class="signup-title">Your invitation is coming.');
  html = html.replace('<form id="signup-form"', '<p class="signup-unavailable">We’re preparing the first release. Check back shortly to join the list for 1 October.</p><form hidden id="signup-form"');
}
const configuredOrigin = process.env.PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL;
let origin;
if (configuredOrigin) {
  const parsed = new URL(configuredOrigin.startsWith('https://') ? configuredOrigin : `https://${configuredOrigin}`);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('PUBLIC_SITE_URL must be an HTTPS origin.');
  origin = parsed.origin;
  html = html.replace(/(<meta property="og:image" content=")(?=\/assets\/)/, `$1${origin}`);
  html = html.replace('  <title>', `  <link rel="canonical" href="${origin}/">\n  <meta property="og:url" content="${origin}/">\n  <meta name="twitter:card" content="summary_large_image">\n  <title>`);
}
const assets = new Set([...(html + css + js + orderHtml + orderJs).matchAll(/\/assets\/([A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*)/g)].map(match => match[1]));
for (const file of assets) {
  if (file.split('/').some(segment => segment.startsWith('.'))) throw new Error('Unsafe asset path.');
  const destination = path.join(output, 'assets', file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(input, 'assets', file), destination);
}
await writeFile(path.join(output, 'index.html'), html);
await writeFile(path.join(output, 'styles.css'), css);
await writeFile(path.join(output, 'app.js'), js);
await writeFile(path.join(output, 'order.html'), orderHtml);
await writeFile(path.join(output, 'order.js'), orderJs);
await writeFile(path.join(output, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /order.html\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
if (origin) await writeFile(path.join(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>\n`);
const bytes = (await Promise.all([...assets].map(file => stat(path.join(output, 'assets', file))))).reduce((total, file) => total + file.size, 0);
console.log(`Built FABREVOIE: ${assets.size} referenced assets, ${(bytes / 1024 / 1024).toFixed(2)} MB. Private source files and databases excluded.`);
if (pendingCloudStorage) console.log('Cloud storage pending: the public signup form is hidden until the database is configured.');
