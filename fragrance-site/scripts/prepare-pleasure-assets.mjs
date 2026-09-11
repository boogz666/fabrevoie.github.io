/** Web delivery conversion of final B2 Photoshop exports and native Blender views.
 * Originals are read-only. No scene editing, generated substitutes or pilot files.
 * Run `node scripts/prepare-pleasure-assets.mjs --available` as renders finish,
 * then without --available to require all 26 final derivatives.
 */
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const website = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  available: { type: 'boolean', default: false },
  'campaign-root': { type: 'string', default: path.resolve(website, '../../campaign_b2_pleasure_v1') }
} });
const campaign = path.resolve(values['campaign-root']);
const output = path.join(website, 'public/assets/pleasure');
const manifestPath = path.join(output, 'manifest.json');
const ads = [
  ['01_THE_PLEASURE_IS_YOURS', 'Native Blender B2 bottle on a smoked mirror dressing table.'],
  ['02_NOT_FOR_EVERYONE', 'Original generated yacht-cabin portrait with a separate exact native B2 product panel.'],
  ['03_MAKE_AN_IMPRESSION', 'Original generated eveningwear/pool photograph with a separate exact native B2 product panel.'],
  ['04_ARRIVE_ACCORDINGLY', 'Original generated rainy coupe arrival photograph with a separate exact native B2 product panel.'],
  ['05_SOME_THINGS', 'Licensed genuine monochrome vintage-car photograph with a separate exact native B2 product panel.'],
  ['06_BAD_INFLUENCE', 'Native Blender B2 bottle on lacquer and black silk.'],
  ['07_YOUR_USUAL', 'Native Blender B2 bottle on walnut with cut crystal.'],
  ['08_DONT_ASK', 'Native Blender B2 bottle at a chrome vanity.'],
  ['09_AFTER_HOURS', 'Licensed genuine piano-key photograph with a separate exact native B2 product panel.'],
  ['10_STAY_A_LITTLE_LONGER', 'Native Blender B2 bottle on ivory satin.']
];
const views = [
  ['WEB_HERO_WIDE', 'web-hero-wide', 2400, [2400, 1350], 'Native Blender wide smoked-mirror set; dark left copy space, approved B2 bottle on the right.'],
  ['WEB_PRODUCT_FRONT', 'web-product-front', 1600, [1600, 2000], 'Native Blender front view of the approved B2 bottle on warm ivory.'],
  ['WEB_PRODUCT_THREE_QUARTER', 'web-product-three-quarter', 1600, [1600, 2000], 'Native Blender three-quarter view of the approved B2 bottle on warm ivory.'],
  ['WEB_CAP_DETAIL', 'web-cap-detail', 1600, [1600, 1600], 'Native Blender close-up of the approved clear square crown and short smooth silver collar.']
];
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
function sourceFile(directory, stem) {
  const filename = ['.png', '.jpg', '.jpeg'].map(extension => path.join(campaign, directory, stem + extension))
    .find(candidate => existsSync(candidate) && statSync(candidate).size > 0);
  if (!filename) return;
  // A render/export filename may exist before its pixels have finished writing.
  // The producing tools write these completion records only after saving.
  try {
    if (directory === 'design/exports') {
      const reportPath = path.join(campaign, directory, stem + '.json');
      const report = JSON.parse(readFileSync(reportPath, 'utf8'));
      if (report.id !== stem || statSync(reportPath).mtimeMs < statSync(filename).mtimeMs) return;
    } else {
      const progress = JSON.parse(readFileSync(path.join(campaign, 'blender/render_progress.json'), 'utf8'));
      if (!progress.completed?.some(item => item.file === path.basename(filename))) return;
    }
  } catch { return; }
  return filename;
}
const missing = [...ads.map(([stem]) => ['design/exports', stem]), ...views.map(([stem]) => ['blender', stem])]
  .filter(([directory, stem]) => !sourceFile(directory, stem)).map(([directory, stem]) => `${directory}/${stem}`);
if (missing.length && !values.available) throw new Error(`Final campaign sources are not all ready: ${missing.join(', ')}`);
await mkdir(output, { recursive: true });
const previousManifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : {};
const previous = new Map((previousManifest.assets || []).map(item => [item.file, item]));
const records = [];

async function loadSource(filename, expected) {
  const before = await stat(filename);
  const buffer = await readFile(filename);
  const image = sharp(buffer, { failOn: 'error' });
  const metadata = await image.metadata();
  if (metadata.width !== expected[0] || metadata.height !== expected[1]) throw new Error(`Final source dimensions do not match; refusing a proof: ${path.basename(filename)} (${metadata.width}x${metadata.height})`);
  if (metadata.hasAlpha && !(await image.stats()).isOpaque) throw new Error(`Finished photograph has unexpected transparency: ${path.basename(filename)}`);
  const after = await stat(filename);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error(`Source is still being written: ${path.basename(filename)}`);
  return { buffer, metadata, record: {
    source: path.relative(campaign, filename).replaceAll('\\', '/'),
    source_sha256: sha256(buffer), source_bytes: buffer.length,
    source_width: metadata.width, source_height: metadata.height,
    colour_handling: metadata.icc ? 'Embedded source profile converted to sRGB' : 'Source rendered/exported in sRGB; output tagged sRGB'
  } };
}

async function exportImage(source, file, width, quality, provenance, crop = null) {
  if (width > source.metadata.width) throw new Error('Refusing to enlarge a lower-resolution source.');
  const format = crop ? 'jpeg' : 'webp';
  const record = { file, ...source.record, width,
    height: crop ? 630 : Math.round(source.metadata.height * width / source.metadata.width),
    quality, format, crop_box: crop,
    operation: crop ? 'Centered social-image crop of wide native hero, resize and JPEG encoding; the whole bottle stays inside the crop.' : 'Whole-image resize and WebP encoding; no crop, retouch or scene alteration.', provenance };
  const target = path.join(output, file);
  const old = previous.get(file);
  if (old && existsSync(target)
    && Object.keys(record).every(key => JSON.stringify(record[key]) === JSON.stringify(old[key]))
    && sha256(await readFile(target)) === old.sha256) {
    records.push(old);
    return;
  }
  let image = sharp(source.buffer, { failOn: 'error' }).rotate();
  if (crop) image = image.extract(crop);
  image = image.resize({ width, height: record.height, fit: 'fill', withoutEnlargement: true, kernel: 'lanczos3' }).withIccProfile('srgb');
  image = crop ? image.jpeg({ quality, chromaSubsampling: '4:4:4', mozjpeg: true })
    : image.webp({ quality, effort: 6, smartSubsample: true });
  const encoded = await image.toBuffer();
  const check = await sharp(encoded).metadata();
  if (check.width !== record.width || check.height !== record.height || check.format !== format) throw new Error(`Encoded media failed dimension/format check: ${file}`);
  const temporary = target + '.pending';
  await writeFile(temporary, encoded);
  await rename(temporary, target);
  records.push({ ...record, bytes: encoded.length, sha256: sha256(encoded) });
}

for (const [index, [stem, provenance]] of ads.entries()) {
  const filename = sourceFile('design/exports', stem);
  if (!filename) continue;
  const source = await loadSource(filename, [2000, 2500]);
  for (const [suffix, width, quality] of [['', 1600, 90], ['-640', 640, 80]]) {
    await exportImage(source, `campaign-${String(index + 1).padStart(2, '0')}${suffix}.webp`, width, quality,
      'Final Photoshop artwork, live typography and supplied FABREVOIE logos. ' + provenance);
  }
}
for (const [stem, name, width, expected, provenance] of views) {
  const filename = sourceFile('blender', stem);
  if (!filename) continue;
  const source = await loadSource(filename, expected);
  await exportImage(source, name + '.webp', width, 90, provenance);
  if (name === 'web-hero-wide') {
    await exportImage(source, name + '-960.webp', 960, 80, provenance);
    const height = Math.round(source.metadata.width * 630 / 1200);
    const top = Math.floor((source.metadata.height - height) / 2);
    const geometry = JSON.parse(await readFile(path.join(campaign, 'blender/campaign.json'), 'utf8'));
    const shot = geometry.shots.find(item => item.filename === 'WEB_HERO_WIDE.png');
    const [x0, x1, y0, y1] = shot.frame_bounds;
    // Native Blender bounds use a bottom-origin normalized Y axis.
    if (!geometry.passed || top < 0 || !(0 <= x0 && x0 < x1 && x1 <= 1)
      || top > (1 - y1) * source.metadata.height || (1 - y0) * source.metadata.height > top + height) {
      throw new Error('Social crop could cut the bottle, or native geometry validation is incomplete. Request a dedicated frame.');
    }
    await exportImage(source, 'og-pleasure.jpg', 1200, 92, provenance, { left: 0, top, width: source.metadata.width, height });
  }
}
const complete = missing.length === 0 && records.length === 26;
const manifest = { campaign: 'FABREVOIE / ULTRA MACHO / The pleasure is yours.',
  product: 'Approved GALA100 B2: clear square glass crown, rounded cavity, short smooth silver inner collar; iris liquid.',
  status: complete ? 'complete' : 'partial', expected_media_files: 26,
  exported_at: new Date().toISOString(), source_root: path.basename(campaign), sources_preserved: true,
  pending_sources: missing, assets: records };
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`${manifest.status.toUpperCase()}: ${records.length}/26 final website derivatives; ${(records.reduce((total, item) => total + item.bytes, 0) / 1048576).toFixed(2)} MB. Pending sources: ${missing.length}.`);
if (!values.available && !complete) throw new Error('Incomplete campaign export.');
