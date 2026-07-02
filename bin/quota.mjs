// quota.mjs — Phase B. DESTRUCTIVE quota-wall test. Drives one dimension to the
// free-tier wall and records the exact error/HTTP status + iteration count + time.
//
// SAFETY (all core-4 free tiers are BLOCK/SUSPEND type = no billing — but ONLY if
// you have NOT enabled billing). This script REFUSES to run unless you assert that:
//   env BILLING_SAFE=confirmed   (no card registered / spend cap ON / overages OFF)
//   flag --confirm-destructive
// It also hard-caps iterations and defaults to DRY-RUN.
//
// Usage (dry run first):
//   node --env-file=.env bin/quota.mjs --target d1 --dimension writes
//   node --env-file=.env bin/quota.mjs --target d1 --dimension writes --confirm-destructive
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeTarget, ALL_TARGETS } from '../lib/targets.mjs';
import { DIALECTS, SAMPLING } from '../config.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const has = (f) => process.argv.includes(f);
const targetName = arg('--target');
const dimension = arg('--dimension', 'writes'); // writes | reads
const maxIters = Number(arg('--max-iters', 500000));
const batch = Number(arg('--batch', 100));
const confirmed = has('--confirm-destructive');

if (!targetName) { console.error(`--target required. one of: ${ALL_TARGETS.join(', ')}`); process.exit(1); }
if (process.env.BILLING_SAFE !== 'confirmed') {
  console.error('REFUSING: set env BILLING_SAFE=confirmed only after verifying NO card / spend cap ON / overages OFF.');
  process.exit(2);
}
const RESET = { d1: 'daily 00:00 UTC', turso: 'monthly (calendar)', neon: 'monthly (billing period)', supabase: 'egress monthly; pause 7d' };
const base = targetName.split('-')[0];

console.log(`# quota-wall  target=${targetName} dimension=${dimension} reset=${RESET[base] || '?'} maxIters=${maxIters}`);
if (!confirmed) {
  console.log('DRY RUN (no writes). Re-run with --confirm-destructive to actually hit the wall.');
  console.log(`Plan: loop ${dimension === 'writes' ? 'INSERT' : 'full-scan SELECT'} in batches of ${batch} until an error/block is returned or maxIters reached.`);
  console.log('Tip: schedule near the reset boundary so recovery is quick/cheap. For D1, writes(100k/day) is the cheapest wall.');
  process.exit(0);
}

const t = makeTarget(targetName);
const d = DIALECTS[t.dialect];
const outFile = path.join(fileURLToPath(new URL('../results', import.meta.url)), `quota-${targetName}-${dimension}.jsonl`);
const stamp = () => new Date().toISOString();
const t0 = Date.now();

await t.open();
let iters = 0, rowsWritten = 0, rowsReadApprox = 0, wall = null;
const insertBatchInline = (n) => `INSERT INTO bench(k, v) VALUES ${Array.from({ length: n }, () => `(${Math.floor(Math.random() * 1e6)},'q')`).join(',')}`; // inline values dodge D1's 100-param/query cap

try {
  while (iters < maxIters) {
    let r;
    if (dimension === 'writes') {
      if (d.dialect === 'pg') {
        r = await t.run({ sql: d.q.insert.sql, params: [Math.floor(Math.random() * 1e6), 'q'] });
        rowsWritten += 1;
      } else {
        r = await t.run({ sql: insertBatchInline(batch), params: [] }); // inline, no bound params
        rowsWritten += batch;
      }
    } else {
      r = await t.run(d.q.unindexed_scan); // full scan => rows_read = SEED_ROWS
      rowsReadApprox += SAMPLING.SEED_ROWS;
    }
    iters++;
    if (r.error || (r.status && r.status >= 400)) { wall = { ...r }; break; }
    if (r.meta?.rows_written != null) rowsWritten = Math.max(rowsWritten, 0); // D1 reports actuals in meta if desired
    if (iters % 200 === 0) console.log(`  iters=${iters} rowsW~${rowsWritten} rowsR~${rowsReadApprox} lastMs=${r.ms} serverMs=${r.serverMs ?? ''}`);
  }
} catch (e) {
  wall = { error: String(e).slice(0, 400) };
}

const rec = { ts: stamp(), target: t.name, dimension, iters, rowsWritten, rowsReadApprox,
  elapsedSec: Math.round((Date.now() - t0) / 1000), reset: RESET[base], wall };
fs.appendFileSync(outFile, JSON.stringify(rec) + '\n');
console.log('\n=== WALL ===');
console.log(JSON.stringify(rec, null, 2));
console.log(`\nRecord the reset boundary (${RESET[base]}) and re-query after it to confirm recovery.`);
await t.close();
