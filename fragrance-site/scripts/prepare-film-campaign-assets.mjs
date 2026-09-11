// Encode six approved film campaign ads. Sources and typography stay unchanged.
import sharp from 'sharp';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '../..');
const selected = ['02_BE_THE_WORST', '06_ORDINARY', '12_CATWALK', '13_FIRST_CLASS', '14_BAD_COMPANY', '15_PLEASURE'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = [];
for (const id of selected) {
  const source = `campaign_film_life_v2/final/${id}.png`;
  const sourcePath = path.join(workspace, source);
  const before = await stat(sourcePath);
  const original = await readFile(sourcePath);
  const metadata = await sharp(original, { failOn: 'error' }).metadata();
  const after = await stat(sourcePath);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Source is still being written: ${source}`);
  if (!metadata.width || !metadata.height || metadata.width < 640 || metadata.width >= metadata.height) throw new Error(`Unexpected source dimensions: ${source}`);
  sources.push({ id, source, original, metadata });
}

const assets = [];
for (const { id, source, original, metadata } of sources) {
  for (const [maximumWidth, quality, suffix] of [[1600, 90, ''], [640, 82, '-640']]) {
    const width = Math.min(maximumWidth, metadata.width);
    const file = `film-campaign/campaign-${id.slice(0, 2)}${suffix}.webp`;
    const output = path.join(root, 'public/assets', file);
    const image = await sharp(original).resize({ width, withoutEnlargement: true }).withIccProfile('srgb').webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    const encoded = await sharp(image).metadata();
    if (encoded.width !== width || encoded.height !== Math.round(metadata.height * width / metadata.width)) throw new Error(`Encoded dimensions changed unexpectedly: ${file}`);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, image);
    assets.push({
      id, file, source, source_sha256: hash(original), source_bytes: original.length,
      source_width: metadata.width, source_height: metadata.height,
      sha256: hash(image), width: encoded.width, height: encoded.height, bytes: image.length, quality,
      operation: 'Full image resize and sRGB WebP encoding; no enlargement, cropping, retouch, compositing or typography changes.'
    });
  }
}
await writeFile(path.join(workspace, 'campaign_film_life_v2/web-assets.json'), JSON.stringify({
  selected, assets, sources_preserved: true,
  method: 'Approved film-treated and image-generated final advertisements encoded for responsive delivery.',
  exported_at: new Date().toISOString()
}, null, 2) + '\n');
console.log(`Encoded ${assets.length} film campaign web images, ${assets.reduce((total, asset) => total + asset.bytes, 0)} bytes.`);
for (const asset of assets.filter(asset => !asset.file.endsWith('-640.webp'))) console.log(`${asset.file}: ${asset.width}x${asset.height}`);
