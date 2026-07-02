// setup.mjs — create the bench schema and seed SEED_ROWS. Run once per target.
// Usage: node --env-file=.env bin/setup.mjs --target neon
import { makeTarget, ALL_TARGETS } from '../lib/targets.mjs';
import { DIALECTS, SAMPLING } from '../config.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const targetName = arg('--target');
if (!targetName) { console.error(`--target required. one of: ${ALL_TARGETS.join(', ')}`); process.exit(1); }

const t = makeTarget(targetName);
const d = DIALECTS[t.dialect];
const N = SAMPLING.SEED_ROWS;
console.log(`# setup ${t.name} (${t.dialect}), seeding ${N} rows`);
await t.open();
for (const stmt of d.schema) { await t.run({ sql: stmt, params: [] }); }

if (t.dialect === 'pg') {
  await t.run({ sql: d.seed(N), params: [] });
} else {
  // inline values (no bound params): D1 caps bound params at 100/query. Chunk to stay
  // under the 100KB SQL-statement limit. v is 'seedN' (safe, no quotes); k is an int.
  const chunk = 1000;
  for (let i = 0; i < N; i += chunk) {
    const rows = Math.min(chunk, N - i);
    const vals = Array.from({ length: rows }, (_, j) => `(${Math.floor(Math.random() * 1e6)},'seed${i + j}')`).join(',');
    await t.run({ sql: `INSERT INTO bench(k, v) VALUES ${vals}`, params: [] });
    process.stdout.write('.');
  }
  process.stdout.write('\n');
}
const c = await t.run({ sql: 'SELECT count(*) AS n FROM bench', params: [] });
console.log('seeded. count query ms=', c.ms, 'meta=', c.meta || c.serverMs || '');
await t.close();
