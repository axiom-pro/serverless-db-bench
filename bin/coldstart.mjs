// coldstart.mjs — Phase A. Cold/warm E2E latency, decomposed and percentiled.
// COLD: one cold sample per invocation (re-idle between runs; schedule via cron/task).
//   node --env-file=.env bin/coldstart.mjs --target neon --mode cold --label 10min-idle
// WARM: per-query percentiles over a live connection.
//   node --env-file=.env bin/coldstart.mjs --target neon --mode warm
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeTarget, ALL_TARGETS } from '../lib/targets.mjs';
import { DIALECTS, QUERY_ORDER, SAMPLING, IDLE_GUIDANCE } from '../config.mjs';
import { probe, probeOnce } from '../lib/transport.mjs';
import { summary } from '../lib/stats.mjs';

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const targetName = arg('--target');
const mode = arg('--mode', 'cold');
const label = arg('--label', '');
const region = arg('--region', process.env.REGION || 'unknown');
if (!targetName) { console.error(`--target required. one of: ${ALL_TARGETS.join(', ')}`); process.exit(1); }

const t = makeTarget(targetName);
const d = DIALECTS[t.dialect];
const base = targetName.split('-')[0];
const resultsDir = path.join(fileURLToPath(new URL('../results', import.meta.url)));
const outFile = path.join(resultsDir, `${targetName}-${region}.jsonl`);
const append = (obj) => fs.appendFileSync(outFile, JSON.stringify(obj) + '\n');
const stamp = () => new Date().toISOString();

// write-quota-friendly sample counts
// cap quota-heavy queries: writes, and full-scan reads (unindexed_scan & count each scan all rows)
const nFor = (q) => (q === 'insert' || q === 'update' || q === 'unindexed_scan' || q === 'count')
  ? Math.min(SAMPLING.WARM_SAMPLES, 30) : SAMPLING.WARM_SAMPLES;

if (mode === 'cold') {
  console.log(`# COLD ${t.name} @${region}  ${IDLE_GUIDANCE[base] || ''}`);
  console.log('  >> Ensure the DB is idle/paused per the note above, confirmed in the provider console, before this runs.');
  const tp = t.transport();
  const transport = tp ? await probeOnce(tp.url, tp.opts) : null;
  const open = await t.open();                       // pg: connectMs = wake+auth
  const first = await t.run(d.q.select1);            // first query after idle = COLD
  const rec = { ts: stamp(), target: t.name, region, mode: 'cold', label,
    transport, connectMs: open.connectMs ?? null, firstQueryMs: first.ms,
    serverMs: first.serverMs ?? null, meta: first.meta ?? null };
  append(rec);
  console.log('  transport(dns/tcp/tls/ttfb/total):',
    transport ? `${transport.dns}/${transport.tcp}/${transport.tls}/${transport.ttfb}/${transport.total}` : 'n/a (TCP driver)');
  console.log('  connectMs:', rec.connectMs, ' firstQueryMs:', rec.firstQueryMs, ' serverMs:', rec.serverMs);
  console.log(`  appended -> ${path.basename(outFile)}`);
  await t.close();
} else if (mode === 'warm') {
  console.log(`# WARM ${t.name} @${region}  (WARM_SAMPLES=${SAMPLING.WARM_SAMPLES}; writes/scan capped at 30)`);
  await t.open();
  for (let i = 0; i < 5; i++) await t.run(d.q.select1); // warm up connection/cache
  const tp = t.transport();
  const transportRows = tp ? (await probe(tp.url, { samples: SAMPLING.TRANSPORT_SAMPLES, gapMs: SAMPLING.GAP_MS })).filter((r) => !r.error) : [];
  const transport = tp ? { ttfb: summary(transportRows.map((r) => r.ttfb)), tls: summary(transportRows.map((r) => r.tls)) } : null;

  const queries = {};
  let readRowsApprox = 0, writeRows = 0;
  for (const q of QUERY_ORDER) {
    const n = nFor(q), samples = [];
    for (let i = 0; i < n; i++) { const r = await t.run(d.q[q]); if (Number.isFinite(r.ms)) samples.push(r.ms); }
    queries[q] = summary(samples);
    if (q === 'unindexed_scan' || q === 'count') readRowsApprox += n * SAMPLING.SEED_ROWS;
    if (q === 'insert' || q === 'update') writeRows += n;
  }
  const rec = { ts: stamp(), target: t.name, region, mode: 'warm', label, transport, queries,
    quotaApprox: { rows_read_approx: readRowsApprox, rows_written_approx: writeRows } };
  append(rec);
  console.log('  per-query p50/p99 (ms):');
  for (const q of QUERY_ORDER) console.log(`    ${q.padEnd(15)} p50=${queries[q].p50} p99=${queries[q].p99} n=${queries[q].n}`);
  console.log(`  approx quota consumed this run: read~${readRowsApprox} rows, write~${writeRows} rows`);
  console.log(`  appended -> ${path.basename(outFile)}`);
  await t.close();
} else {
  console.error('--mode must be cold or warm');
  process.exit(1);
}
