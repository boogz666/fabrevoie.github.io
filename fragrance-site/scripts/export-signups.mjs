import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COLUMNS = ['email', 'consented_at', 'consent_version', 'source'];
const CLOUD_SELECT = `SELECT email, consented_at, consent_version, source
  FROM public.fabrevoie_signups ORDER BY consented_at, email`;

export class ExportError extends Error {}

function parseArguments(argv) {
  let cloud = false;
  let output;
  for (const argument of argv) {
    if (argument === '--cloud' && !cloud) cloud = true;
    else if (argument.startsWith('--') || output) throw new ExportError('Usage: node scripts/export-signups.mjs [--cloud] [private-output.csv]');
    else output = argument;
  }
  return { cloud, output };
}

function inside(directory, filename) {
  const relative = path.relative(directory, filename);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// Resolve existing ancestors as well as the target, so junctions and symlinks
// cannot redirect a seemingly private path into the published site.
async function canonicalPath(filename) {
  let current = path.resolve(filename);
  const missing = [];
  while (true) {
    try { return path.resolve(await realpath(current), ...missing.reverse()); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      missing.push(path.basename(current));
      current = parent;
    }
  }
}

async function assertPrivateOutput(output, siteDir) {
  const resolvedOutput = await canonicalPath(output);
  for (const directory of ['public', 'dist'].map(name => path.join(siteDir, name))) {
    if (inside(directory, output) || inside(await canonicalPath(directory), resolvedOutput)) {
      throw new ExportError('Export files must stay outside the public and dist directories.');
    }
  }
}

function csvCell(value) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '');
  // Quoting alone does not stop spreadsheet formulas. Include leading control
  // characters and whitespace that spreadsheet importers may silently remove.
  const dangerous = /^[\t\r\n]/u.test(text) || /^[\u0000-\u0020]*[=+\-@]/u.test(text);
  const safe = dangerous ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function readLocalRows(databasePath) {
  let database;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    database = new DatabaseSync(databasePath, { readOnly: true });
    return database.prepare('SELECT email, consented_at, consent_version, source FROM signups ORDER BY consented_at, email').all();
  } catch {
    throw new ExportError('The local signup database could not be read. Start the local website before exporting, or use --cloud for the live list.');
  } finally { database?.close(); }
}

async function readCloudRows(databaseUrl, loadNeon) {
  if (!databaseUrl) throw new ExportError('DATABASE_URL is required for --cloud. No export was created.');
  try {
    const { neon } = await loadNeon();
    const sql = neon(databaseUrl);
    return await sql.query(CLOUD_SELECT, [], { fetchOptions: { signal: AbortSignal.timeout(15000) } });
  } catch {
    // Driver errors can contain connection details or query data. Keep them out
    // of terminal output, and never fall back to a different database.
    throw new ExportError('The cloud signup list could not be read. Check database access and try again. No export was created.');
  }
}

export async function exportSignups({
  argv = [],
  env = process.env,
  siteDir = SITE_DIR,
  now = () => new Date(),
  loadNeon = () => import('@neondatabase/serverless')
} = {}) {
  const { cloud, output: requestedOutput } = parseArguments(argv);
  const dataDir = path.resolve(siteDir, env.DATA_DIR || 'data');
  const timestamp = now().toISOString().replace(/[:.]/g, '-');
  const output = path.resolve(requestedOutput || path.join(dataDir, `launch-signups-${cloud ? 'cloud-' : ''}${timestamp}.csv`));
  try {
    await assertPrivateOutput(output, siteDir);
    const rows = cloud
      ? await readCloudRows(env.DATABASE_URL, loadNeon)
      : await readLocalRows(path.join(dataDir, 'signups.sqlite'));
    const csv = [COLUMNS.join(','), ...rows.map(row => COLUMNS.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
    await mkdir(path.dirname(output), { recursive: true, mode: 0o700 });
    await assertPrivateOutput(output, siteDir);
    await writeFile(output, csv, { flag: 'wx', mode: 0o600 });
    return { count: rows.length, output, cloud };
  } catch (error) {
    if (error instanceof ExportError) throw error;
    if (error.code === 'EEXIST') throw new ExportError('The export filename already exists. Choose a new private filename; existing files are never overwritten.');
    throw new ExportError('The signup export could not be written. Check the private output folder and try again.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await exportSignups({ argv: process.argv.slice(2) });
    console.log(`Exported ${result.count} consented signup(s) from ${result.cloud ? 'cloud' : 'local storage'} to ${result.output}`);
  } catch (error) {
    console.error(error instanceof ExportError ? error.message : 'The signup export failed. No signup details were printed.');
    process.exitCode = 1;
  }
}
