import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(siteDir, process.env.DATA_DIR || 'data');
const databasePath = path.join(dataDir, 'signups.sqlite');
if (!existsSync(databasePath)) {
  console.error('No signup database yet. Start the website before exporting.');
  process.exit(1);
}
const database = new DatabaseSync(databasePath, { readOnly: true });
try {
  const rows = database.prepare('SELECT email, consented_at, consent_version, source FROM signups ORDER BY consented_at').all();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const output = path.resolve(process.argv[2] || path.join(dataDir, `launch-signups-${timestamp}.csv`));
  const publicDir = path.join(siteDir, 'public');
  const relative = path.relative(publicDir, output);
  if (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) throw new Error('Export files must stay outside the public directory.');
  const columns = ['email', 'consented_at', 'consent_version', 'source'];
  const csv = value => {
    const text = String(value ?? '');
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  };
  writeFileSync(output, [columns.join(','), ...rows.map(row => columns.map(column => csv(row[column])).join(','))].join('\r\n') + '\r\n', { flag: 'wx', mode: 0o600 });
  console.log(`Exported ${rows.length} consented signup(s) to ${output}`);
} finally { database.close(); }
