const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const root = path.resolve(__dirname, '..');
const container = 'salama-phase1-check-20261031-a7f2';
let createdContainer = false;
const existing = spawnSync('docker', ['inspect', container], { encoding: 'utf8' });
if (existing.status !== 0) {
  if (!String(existing.stderr).includes('No such object')) throw Error(existing.stderr || 'Docker is unavailable');
  execFileSync('docker', ['run', '--rm', '-d', '--name', container, '--label', 'salama.codex.phase1=20261031-a7f2', '-e', 'POSTGRES_PASSWORD=salama-local-test', '-p', '127.0.0.1:55439:5432', 'postgres:16-alpine'], { stdio: 'pipe' });
  createdContainer = true;
}
const inspect = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(inspect.Config.Labels['salama.codex.phase1'], '20261031-a7f2');
assert.equal(inspect.State.Running, true);
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }).status === 0) { ready = true; break; }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
}
assert.equal(ready, true, 'Disposable PostgreSQL did not become ready');
const name = `salama_phase1_test_round_${Date.now()}`;
const url = `postgresql://postgres:salama-local-test@127.0.0.1:55439/${name}`;
const folder = path.join(root, 'tmp', name); fs.mkdirSync(folder, { recursive: true });
const psql = (database, sql) => execFileSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
// Fresh database only: there is no reset/drop command and no production .env.
psql('postgres', `CREATE DATABASE "${name}";`);
fs.copyFileSync(path.join(__dirname, 'fixtures/pre-phase-one.prisma'), path.join(folder, 'baseline.prisma'));
execFileSync(process.execPath, [path.join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path.join(folder, 'baseline.prisma'), '--script', '--output', path.join(folder, 'baseline.sql')], { cwd: root, stdio: 'pipe' });
psql(name, fs.readFileSync(path.join(folder, 'baseline.sql'), 'utf8'));
psql(name, fs.readFileSync(path.join(__dirname, 'fixtures/phase-one-legacy.sql'), 'utf8'));
const db = new PrismaClient({ datasources: { db: { url } } });
const quote = value => '"' + value.replaceAll('"', '""') + '"';
(async () => {
  const columns = await db.$queryRawUnsafe("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name, ordinal_position");
  const tables = new Map();
  for (const row of columns) { if (!tables.has(row.table_name)) tables.set(row.table_name, []); tables.get(row.table_name).push(row.column_name); }
  const snapshot = async () => {
    const result = {};
    for (const [table, fields] of tables) {
      const rows = await db.$queryRawUnsafe(`SELECT to_jsonb(t)::text AS record FROM (SELECT ${fields.map(quote).join(',')} FROM public.${quote(table)}) t ORDER BY to_jsonb(t)::text`);
      result[table] = rows.map(r => r.record);
    }
    return result;
  };
  const before = await snapshot();
  const sql = fs.readFileSync(path.join(root, 'prisma/safe_phase_one_completion_migration.sql'), 'utf8');
  psql(name, sql); assert.deepEqual(await snapshot(), before, 'First migration changed legacy rows/columns');
  psql(name, sql); assert.deepEqual(await snapshot(), before, 'Second migration changed legacy rows/columns');
  fs.writeFileSync(path.join(folder, 'migration-verification.json'), JSON.stringify({ database: name, checkedTables: tables.size, preservedRows: Object.values(before).reduce((n, rows) => n + rows.length, 0), applications: 2, legacyValuesUnchanged: true }, null, 2));
  console.log(`Migration preserved every existing column in ${tables.size} tables, twice. Test DB: ${name}`);
  await db.$disconnect();
  for (const file of ['phase-one.integration.cjs', 'phase-one-access.integration.cjs', 'phase-one-booking.integration.cjs', 'phase-one-history.integration.cjs', 'phase-one-http.integration.cjs']) {
    const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '--test', path.join(__dirname, file)], { cwd: root, env: { ...process.env, SALAMA_PHASE1_TEST_URL: url }, stdio: 'inherit' });
    if (result.status !== 0) throw Error(`${file} failed (exit ${result.status})`);
  }
})().catch(async error => { console.error(error); await db.$disconnect(); process.exitCode = 1; }).finally(() => {
  if (createdContainer && process.env.SALAMA_KEEP_TEST_DB !== '1') execFileSync('docker', ['stop', container], { stdio: 'pipe' });
});
