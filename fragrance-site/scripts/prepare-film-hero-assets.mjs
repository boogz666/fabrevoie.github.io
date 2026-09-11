// Encode approved film-style hero photographs. Preserve all source pixels and framing.
import sharp from 'sharp';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '../..');
const sources = [
  ['website_film_hero_v1/generated/HERO_WIDE.png', 'film-hero/web-hero-wide', 'landscape', [[2400, 90, ''], [960, 82, '-960']]],
  ['website_film_hero_v1/generated/HERO_MOBILE.png', 'film-hero/web-hero-mobile', 'portrait', [[1600, 90, ''], [640, 82, '-640']]],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const approvedSources = [];
for (const [source, stem, orientation, variants] of sources) {
  const sourcePath = path.join(workspace, source);
  const before = await stat(sourcePath);
  const original = await readFile(sourcePath);
  const metadata = await sharp(original, { failOn: 'error' }).metadata();
  const after = await stat(sourcePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Source is still being written: ${source}`);
  if (!metadata.width || !metadata.height || metadata.width < 640) throw new Error(`Source is too small or invalid: ${source}`);
  if (orientation === 'landscape' ? metadata.width <= metadata.height : metadata.width >= metadata.height) throw new Error(`Unexpected source orientation: ${source}`);
  approvedSources.push({ source, stem, variants, original, metadata });
}

const assets = [];
for (const { source, stem, variants, original, metadata } of approvedSources) {
  for (const [maximumWidth, quality, suffix] of variants) {
    const width = Math.min(maximumWidth, metadata.width);
    const file = `${stem}${suffix}.webp`;
    const output = path.join(root, 'public/assets', file);
    const image = await sharp(original).resize({ width, withoutEnlargement: true }).withIccProfile('srgb').webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    const encoded = await sharp(image).metadata();
    if (encoded.width !== width || encoded.height !== Math.round(metadata.height * width / metadata.width)) throw new Error(`Encoded dimensions changed unexpectedly: ${file}`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, image);
    assets.push({
      file, source, source_sha256: hash(original), source_bytes: original.length,
      source_width: metadata.width, source_height: metadata.height,
      sha256: hash(image), width: encoded.width, height: encoded.height, bytes: image.length, quality,
      operation: 'Full image resize and sRGB WebP encoding; no enlargement, cropping, retouch, compositing or typography changes.'
    });
  }
}
await writeFile(path.join(workspace, 'website_film_hero_v1/web-assets.json'), JSON.stringify({
  assets, sources_preserved: true,
  method: 'Approved coordinated wide and mobile hero photographs encoded for responsive delivery.',
  exported_at: new Date().toISOString()
}, null, 2) + '\n');
console.log(`Encoded ${assets.length} film hero web images, ${assets.reduce((total, asset) => total + asset.bytes, 0)} bytes.`);
for (const asset of assets) console.log(`${asset.file}: ${asset.width}x${asset.height}`);
