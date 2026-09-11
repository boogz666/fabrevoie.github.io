// Web encoding only: Photoshop filters precede final image-generated car typography.
// Source pixels and typography are never edited by this script.
import sharp from 'sharp';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '../..');
const sources = [
  ['website_type_refresh_v2/generated/CAR_90S.png', 'type90s/campaign-02', null, [[1600, 90, ''], [640, 80, '-640']]],
  ['website_type_refresh_v2/filtered/HERO_BASE.png', 'type90s/web-hero-wide', [2400, 1350], [[2400, 90, ''], [960, 80, '-960']]],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const approvedSources = [];
for (const [source, stem, dimensions, variants] of sources) {
  const sourcePath = path.join(workspace, source);
  const before = await stat(sourcePath);
  const original = await readFile(sourcePath);
  const metadata = await sharp(original, { failOn: 'error' }).metadata();
  const after = await stat(sourcePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Source is still being written: ${source}`);
  if (dimensions && (metadata.width !== dimensions[0] || metadata.height !== dimensions[1])) throw new Error(`Unexpected source dimensions: ${source}`);
  if (!metadata.width || !metadata.height || metadata.width < 640) throw new Error(`Source is too small or invalid: ${source}`);
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
await writeFile(path.join(workspace, 'website_type_refresh_v2/web-assets.json'), JSON.stringify({
  assets, sources_preserved: true,
  method: 'Car: Photoshop photographic filters first, built-in image generation for final typography second. Hero: Photoshop photographic filters only. Web encoding is the final delivery conversion.',
  exported_at: new Date().toISOString()
}, null, 2) + '\n');
const car = assets.find(asset => asset.file === 'type90s/campaign-02.webp');
console.log(`Encoded ${assets.length} type90s web images, ${assets.reduce((total, asset) => total + asset.bytes, 0)} bytes. Car HTML dimensions/srcset must match ${car.width}x${car.height}.`);
