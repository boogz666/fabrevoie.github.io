// Encode approved Photoshop artwork for web delivery. Sources remain unchanged.
import sharp from 'sharp';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '../..');
const sourceDirectory = 'website_grain_refresh_v1/design/exports';
const sources = [
  ['02_BE_THE_WORST.png', 'analog/campaign-02', [2000, 2500], [[1600, 90, ''], [640, 80, '-640']]],
  ['06_ORDINARY_GRAIN.png', 'analog/campaign-06', [2000, 2500], [[1600, 90, ''], [640, 80, '-640']]],
  ['WEB_HERO_GRAIN.png', 'analog/web-hero-wide', [2400, 1350], [[2400, 90, ''], [960, 80, '-960']]],
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const approvedSources = [];
for (const [filename, stem, dimensions, variants] of sources) {
  const source = `${sourceDirectory}/${filename}`;
  const sourcePath = path.join(workspace, source);
  const before = await stat(sourcePath);
  const original = await readFile(sourcePath);
  const metadata = await sharp(original, { failOn: 'error' }).metadata();
  const after = await stat(sourcePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Source is still being written: ${source}`);
  if (metadata.width !== dimensions[0] || metadata.height !== dimensions[1]) throw new Error(`Unexpected source dimensions: ${source}`);
  approvedSources.push({ source, stem, variants, original, metadata });
}

const assets = [];
for (const { source, stem, variants, original, metadata } of approvedSources) {
  for (const [width, quality, suffix] of variants) {
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
      operation: 'Full image resize and sRGB WebP encoding; no cropping, retouch or compositing.'
    });
  }
}
await writeFile(path.join(workspace, 'website_grain_refresh_v1/web-assets.json'), JSON.stringify({
  assets, sources_preserved: true, method: 'Approved Photoshop exports converted for web delivery.',
  exported_at: new Date().toISOString()
}, null, 2) + '\n');
console.log(`Encoded ${assets.length} analog web images, ${assets.reduce((total, asset) => total + asset.bytes, 0)} bytes.`);
