// Encode the user's three exact supplied campaign images without editing them.
import sharp from 'sharp';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const selectionRoot = path.resolve(root, '../../campaign_film_life_v2/site_selection_v3');
const sourceRoot = path.join(selectionRoot, 'sources');
const requested = [
  { id: '01-car', name: 'CAR.png', original: 'C:/Users/jonat/.codex/generated_images/01a088b6-bf89-7e70-bc89-35c5284d914c/exec-acb4b986-8544-45a2-b132-b7472c94f7c5.png' },
  { id: '02-painted', name: 'PAINTED_BOTTLE.jpg', original: 'C:/Ideas/FF/perfume/ULTRAMACHO/website_grain_refresh_v1/design/exports/PAINTED_BOTTLE.jpg' },
  { id: '03-airfield', name: 'AIRFIELD.png', original: 'C:/Users/jonat/.codex/generated_images/01a08f0e-ddb9-7b32-9834-27afd76c5cb8/exec-af2705f9-96c7-4d2c-8d7c-6d2b9328445f.png' }
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
await mkdir(sourceRoot, { recursive: true });
const sources = [], assets = [];
for (const item of requested) {
  const local = path.join(sourceRoot, item.name);
  try { await readFile(local); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(item.original, local);
  }
  const bytes = await readFile(local);
  const original = await readFile(item.original);
  if (hash(bytes) !== hash(original)) throw new Error('Source copy differs from the requested original: ' + item.name);
  const metadata = await sharp(bytes).metadata();
  sources.push({ ...item, local: `sources/${item.name}`, sha256: hash(bytes), width: metadata.width, height: metadata.height, bytes: bytes.length });
  for (const [maximumWidth, quality, suffix] of [[1600, 90, ''], [640, 84, '-640']]) {
    const width = Math.min(maximumWidth, metadata.width);
    const file = `selected-campaign/${item.id}${suffix}.webp`;
    const image = await sharp(bytes).resize({ width, withoutEnlargement: true }).withIccProfile('srgb').webp({ quality, effort: 6, smartSubsample: true }).toBuffer();
    const encoded = await sharp(image).metadata();
    const output = path.join(root, 'public/assets', file);
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, image);
    assets.push({ id: item.id, file, source: `sources/${item.name}`, source_sha256: hash(bytes), sha256: hash(image), width: encoded.width, height: encoded.height, bytes: image.length, quality });
  }
}
await writeFile(path.join(selectionRoot, 'web-assets.json'), JSON.stringify({ selected: requested.map(item => item.id), sources, assets, exported_at: new Date().toISOString(), operation: 'Exact user-selected source copies; uncropped sRGB WebP encoding only, no enlargement, retouch or typography changes.' }, null, 2) + '\n');
console.log(JSON.stringify({ sources: sources.map(({id, width, height, sha256}) => ({id, width, height, sha256})), assets: assets.length, bytes: assets.reduce((sum, a) => sum + a.bytes, 0) }));
