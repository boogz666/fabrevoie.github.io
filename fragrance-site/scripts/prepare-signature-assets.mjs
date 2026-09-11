// Encode approved artwork for web delivery. Sources remain unchanged.
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspace = path.resolve(root, '../..');
const sources = [
  ['campaign_fast_life_v1/design/exports/02_OVERQUALIFIED.png', 'fast-life/campaign-02', [2000, 2500], [[1600, 90, ''], [640, 80, '-640']]],
  ['campaign_fast_life_v1/design/exports/06_ORDINARY.png', 'fast-life/campaign-06', [2000, 2500], [[1600, 90, ''], [640, 80, '-640']]],
  ['website_signature_refresh_v1/WEB_PRODUCT_SIDE.png', 'signature/web-product-side', [1122, 1402], [[1122, 90, '']]],
];
const assets = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const [source, stem, dimensions, variants] of sources) {
  const original = await readFile(path.join(workspace, source));
  const metadata = await sharp(original).metadata();
  if (metadata.width !== dimensions[0] || metadata.height !== dimensions[1]) throw new Error(`Unexpected source dimensions: ${source}`);
  for (const [width, quality, suffix] of variants) {
    const file = `${stem}${suffix}.webp`;
    const output = path.join(root, 'public/assets', file);
    const image = await sharp(original).resize({ width, withoutEnlargement: true }).withIccProfile('srgb').webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    const encoded = await sharp(image).metadata();
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, image);
    assets.push({ file, source, source_sha256: hash(original), sha256: hash(image), width: encoded.width, height: encoded.height, bytes: image.length, quality, operation: 'Full image resize and WebP encoding; no cropping, retouch or compositing.' });
  }
}
await writeFile(path.join(workspace, 'website_signature_refresh_v1/web-assets.json'), JSON.stringify({ assets, sources_preserved: true }, null, 2));
console.log(`Encoded ${assets.length} web images, ${assets.reduce((total, asset) => total + asset.bytes, 0)} bytes.`);
