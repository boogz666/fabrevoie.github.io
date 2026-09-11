// Responsive encoding only; the tall mobile composition is generated separately.
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const project = path.resolve(root, '../../website_mobile_hero_v2');
const source = await readFile(path.join(project, 'generated/HERO_MOBILE_TALL.png'));
const metadata = await sharp(source).metadata();
if (!metadata.width || !metadata.height || metadata.height / metadata.width < 1.7) throw Error('Expected the approved tall mobile hero');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assets = [];
for (const [maximumWidth, quality, suffix] of [[1600, 90, ''], [640, 84, '-640']]) {
  const width = Math.min(maximumWidth, metadata.width);
  const file = `mobile-hero/hero-tall${suffix}.webp`;
  const bytes = await sharp(source).resize({ width, withoutEnlargement: true }).withIccProfile('srgb').webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
  const encoded = await sharp(bytes).metadata();
  await mkdir(path.join(root, 'public/assets/mobile-hero'), { recursive: true });
  await writeFile(path.join(root, 'public/assets', file), bytes);
  assets.push({ file, width: encoded.width, height: encoded.height, bytes: bytes.length, sha256: hash(bytes), quality });
}
await writeFile(path.join(project, 'web-assets.json'), JSON.stringify({ source: 'generated/HERO_MOBILE_TALL.png', source_sha256: hash(source), source_width: metadata.width, source_height: metadata.height, assets, operation: 'Uncropped sRGB WebP encoding only; no enlargement or image editing.' }, null, 2) + '\n');
await writeFile(path.join(project, 'generated/HERO_MOBILE_TALL.json'), JSON.stringify({ method: 'built-in image_gen canvas extension of the approved filtered hero photograph', prompt: await readFile(path.join(project, 'HERO_MOBILE_PROMPT.txt'), 'utf8'), references: ['C:/Ideas/FF/perfume/ULTRAMACHO/website_film_hero_v1/generated/HERO_MOBILE.png'], native_original: 'C:/Users/jonat/.codex/generated_images/01a088b6-bf89-7e70-bc89-35c5284d914c/exec-cdfdd7de-7459-4921-b0a1-1ad7ec5d3031.png', output: 'HERO_MOBILE_TALL.png', width: metadata.width, height: metadata.height, visual_review: { complete_bottle_visible: true, upper_copy_space: true, lower_cta_space: true, no_added_advertising_type: true, filtered_style_preserved: true } }, null, 2) + '\n');
console.log(JSON.stringify({ source: [metadata.width, metadata.height], assets }));
