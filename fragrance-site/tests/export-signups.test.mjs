import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { exportSignups, ExportError } from '../scripts/export-signups.mjs';

const exec = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/export-signups.mjs', import.meta.url));
const fixedDate = () => new Date('2026-09-10T12:30:00.000Z');
const cloudUrl = 'postgres://fixture:private-value@database.invalid/fabrevoie';

async function fixture(t, rows = []) {
  const base = path.resolve(tmpdir());
  const root = await mkdtemp(path.join(base, 'fabrevoie-export-test-'));
  const dataDir = path.join(root, 'data');
  await Promise.all(['public', 'dist'].map(name => mkdir(path.join(root, name))));
  if (rows !== null) {
    await mkdir(dataDir);
    const database = new DatabaseSync(path.join(dataDir, 'signups.sqlite'));
    try {
      database.exec('CREATE TABLE signups (email TEXT PRIMARY KEY, consented_at TEXT NOT NULL, consent_version TEXT NOT NULL, source TEXT NOT NULL, removal_token_hash TEXT NOT NULL)');
      const insert = database.prepare('INSERT INTO signups VALUES (?, ?, ?, ?, ?)');
      for (const row of rows) insert.run(row.email, row.consented_at, row.consent_version, row.source, 'PRIVATE-WITHDRAWAL-HASH');
    } finally { database.close(); }
  }
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), base);
    assert.ok(path.basename(root).startsWith('fabrevoie-export-test-'));
    await rm(root, { recursive: true, force: true });
  });
  return { root, dataDir, options: { siteDir: root, env: {}, now: fixedDate } };
}

function row(email, overrides = {}) {
  return { email, consented_at: '2026-09-10T10:00:00.000Z', consent_version: 'fabrevoie-launch-2026-01', source: 'website', ...overrides };
}

function mockNeon(rows, inspect = () => {}) {
  return async () => ({ neon: url => ({ query: async (query, values, options) => {
    inspect({ url, query, values, options });
    return rows;
  } }) });
}

test('default mode exports real local SQLite consent fields only, ordered and read-only', async t => {
  const later = row('later@example.invalid', { consented_at: '2026-09-10T11:00:00.000Z' });
  const first = row('first@example.invalid');
  const f = await fixture(t, [later, first]);
  const databaseBefore = await readFile(path.join(f.dataDir, 'signups.sqlite'));
  const result = await exportSignups({ ...f.options, env: { DATABASE_URL: cloudUrl }, loadNeon: () => { throw new Error('Local export must not load the cloud driver'); } });
  assert.equal(result.cloud, false);
  assert.equal(result.count, 2);
  assert.equal(result.output, path.join(f.dataDir, 'launch-signups-2026-09-10T12-30-00-000Z.csv'));
  const csv = await readFile(result.output, 'utf8');
  assert.equal(csv.split('\r\n')[0], 'email,consented_at,consent_version,source');
  assert.ok(csv.indexOf(first.email) < csv.indexOf(later.email));
  assert.ok(!csv.includes('PRIVATE-WITHDRAWAL-HASH'));
  assert.ok(!csv.includes('removal_token_hash'));
  assert.deepEqual(await readFile(path.join(f.dataDir, 'signups.sqlite')), databaseBefore);
  if (process.platform !== 'win32') assert.equal((await stat(result.output)).mode & 0o777, 0o600);
});

test('CSV escapes delimiters, quotes and spreadsheet formulas including leading whitespace', async t => {
  const f = await fixture(t, [row('=1+1@example.invalid', { consent_version: ' launch,"quoted"', source: ' \t=SUM(1,2)' }), row('+tag@example.invalid', { source: '\n@command' })]);
  const result = await exportSignups(f.options);
  const csv = await readFile(result.output, 'utf8');
  assert.ok(csv.includes('"\'=1+1@example.invalid"'));
  assert.ok(csv.includes('"\'+tag@example.invalid"'));
  assert.ok(csv.includes('" launch,""quoted"""'));
  assert.ok(csv.includes('"\' \t=SUM(1,2)"'));
  assert.ok(csv.includes('"\'\n@command"'));
});

test('explicit cloud mode issues only the consent-field SELECT and creates a private default folder', async t => {
  const f = await fixture(t, null);
  let calls = 0;
  const result = await exportSignups({ ...f.options, argv: ['--cloud'], env: { DATABASE_URL: cloudUrl }, loadNeon: mockNeon([row('cloud@example.invalid', { consented_at: fixedDate(), removal_token_hash: 'MUST-NOT-EXPORT' })], call => {
    calls += 1;
    assert.equal(call.url, cloudUrl);
    assert.match(call.query, /^SELECT email, consented_at, consent_version, source\s+FROM public\.fabrevoie_signups ORDER BY consented_at, email$/);
    assert.deepEqual(call.values, []);
    assert.ok(call.options.fetchOptions.signal instanceof AbortSignal);
    assert.equal(call.options.fetchOptions.signal.aborted, false);
  }) });
  assert.equal(calls, 1);
  assert.equal(result.count, 1);
  assert.equal(result.cloud, true);
  assert.equal(result.output, path.join(f.dataDir, 'launch-signups-cloud-2026-09-10T12-30-00-000Z.csv'));
  const csv = await readFile(result.output, 'utf8');
  assert.ok(csv.includes('"2026-09-10T12:30:00.000Z"'));
  assert.ok(!csv.includes('MUST-NOT-EXPORT'));
});

test('empty cloud result creates a header-only CSV without querying or initializing another table', async t => {
  const f = await fixture(t, null);
  const result = await exportSignups({ ...f.options, argv: ['--cloud'], env: { DATABASE_URL: cloudUrl }, loadNeon: mockNeon([]) });
  assert.equal(result.count, 0);
  assert.equal(await readFile(result.output, 'utf8'), 'email,consented_at,consent_version,source\r\n');
});

test('public and dist paths are rejected before loading the cloud driver, including nested junctions', async t => {
  const f = await fixture(t, null);
  const loadNeon = () => { throw new Error('Unsafe output must be rejected before reading signups'); };
  for (const name of ['public', 'dist']) {
    const protectedDir = path.join(f.root, name);
    await symlink(protectedDir, path.join(f.root, `${name}-shortcut`), process.platform === 'win32' ? 'junction' : 'dir');
    for (const output of [protectedDir, path.join(protectedDir, 'nested', 'signups.csv'), path.join(f.root, `${name}-shortcut`, 'nested', 'signups.csv')]) {
      await assert.rejects(exportSignups({ ...f.options, argv: ['--cloud', output], env: { DATABASE_URL: cloudUrl }, loadNeon }), /outside the public and dist/);
    }
    assert.deepEqual(await readdir(protectedDir), []);
  }
});

test('explicit private output creates folders but never overwrites an existing file', async t => {
  const f = await fixture(t);
  const output = path.join(f.root, 'private-exports', 'release.csv');
  const result = await exportSignups({ ...f.options, argv: [output] });
  assert.equal(result.output, output);
  await writeFile(output, 'KEEP THIS FILE');
  await assert.rejects(exportSignups({ ...f.options, argv: [output] }), /never overwritten/);
  assert.equal(await readFile(output, 'utf8'), 'KEEP THIS FILE');
});

test('cloud configuration/driver failures are sanitized and never fall back to local signups', async t => {
  const f = await fixture(t, [row('local-only@example.invalid')]);
  let loads = 0;
  await assert.rejects(exportSignups({ ...f.options, argv: ['--cloud'], loadNeon: () => { loads += 1; } }), /DATABASE_URL is required/);
  assert.equal(loads, 0);
  await assert.rejects(exportSignups({ ...f.options, argv: ['--cloud'], env: { DATABASE_URL: cloudUrl }, loadNeon: async () => { throw new Error(`Connection failed: ${cloudUrl} cloud@example.invalid`); } }), error => {
    assert.ok(error instanceof ExportError);
    assert.match(error.message, /cloud signup list could not be read/);
    assert.ok(!error.message.includes(cloudUrl));
    assert.ok(!error.message.includes('cloud@example.invalid'));
    return true;
  });
  assert.deepEqual(await readdir(f.dataDir), ['signups.sqlite']);
});

test('CLI reports count and output only, supports the existing local invocation, and rejects unknown flags', async t => {
  const f = await fixture(t, [row('never-print-this@example.invalid')]);
  const output = path.join(f.root, 'cli-export.csv');
  const result = await exec(process.execPath, [script, output], { env: { ...process.env, DATA_DIR: f.dataDir } });
  assert.match(result.stdout, /Exported 1 consented signup\(s\) from local storage/);
  assert.ok(!result.stdout.includes('never-print-this@example.invalid'));
  assert.ok(!result.stderr.includes('never-print-this@example.invalid'));
  await assert.rejects(exportSignups({ ...f.options, argv: ['--cluod'] }), /Usage:/);
  await assert.rejects(exportSignups({ ...f.options, argv: ['--cloud', '--cloud'] }), /Usage:/);
});
