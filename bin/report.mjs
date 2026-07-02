// report.mjs — summarize a results jsonl into cold/warm percentiles.
// Usage: node bin/report.mjs results/d1-tokyo.jsonl
import fs from 'node:fs';
import { summary, pluck } from '../lib/stats.mjs';

const file = process.argv[2];
if (!file) { console.error('usage: node bin/report.mjs <results.jsonl>'); process.exit(1); }
const rows = fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const cold = rows.filter((r) => r.mode === 'cold');
const warm = rows.filter((r) => r.mode === 'warm');

const fmt = (s) => s.n ? `p50=${s.p50} p90=${s.p90} p99=${s.p99} min=${s.min} max=${s.max} (n=${s.n})` : 'n=0';

if (cold.length) {
  console.log(`\n== COLD n=${cold.length} ==`);
  const conn = summary(pluck(cold, 'connectMs'));
  if (conn.n) console.log('  connectMs(wake)', fmt(conn));
  console.log('  firstQueryMs  ', fmt(summary(pluck(cold, 'firstQueryMs'))));
  const e2e = cold.map((r) => (r.connectMs || 0) + (r.firstQueryMs || 0)).filter((x) => x > 0);
  if (e2e.length) console.log('  E2E conn+query', fmt(summary(e2e)), '(pg=connect+query; HTTP DBs=upper bound, incl 2nd query)');
  console.log('  serverMs      ', fmt(summary(pluck(cold, 'serverMs'))));
  const tp = cold.map((r) => r.transport).filter(Boolean);
  for (const f of ['dns', 'tcp', 'tls', 'ttfb', 'total']) console.log(`  transport.${f.padEnd(6)}`, fmt(summary(pluck(tp, f))));
  const w = summary(pluck(cold, 'firstQueryMs')).warnings || [];
  if (w.length) console.log('  note:', w.join(' '));
}
if (warm.length) {
  const last = warm[warm.length - 1];
  console.log(`\n== WARM (last run, per-query p50/p99 ms) ==`);
  for (const [q, s] of Object.entries(last.queries || {})) console.log(`  ${q.padEnd(15)} p50=${s.p50} p99=${s.p99} (n=${s.n})`);
}
// headline cold-vs-warm gap on select1
if (cold.length && warm.length) {
  const coldP50 = summary(pluck(cold, 'firstQueryMs')).p50;
  const warmP50 = warm[warm.length - 1].queries?.select1?.p50;
  if (coldP50 && warmP50) console.log(`\n== HEADLINE ==\n  cold first-query p50 ${coldP50}ms vs warm select1 p50 ${warmP50}ms  => ${(coldP50 / warmP50).toFixed(1)}x`);
}
