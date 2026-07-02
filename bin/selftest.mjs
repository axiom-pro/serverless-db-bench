// selftest.mjs — runs WITHOUT any DB credentials. Verifies transport + stats.
// Usage: node bin/selftest.mjs [https://url-to-probe]
import { probe } from '../lib/transport.mjs';
import { summary, pluck } from '../lib/stats.mjs';

const url = process.argv[2] || 'https://turso.tech';
console.log(`# selftest 1/2: transport decomposition x20 -> ${url}`);
const rows = await probe(url, { samples: 20, gapMs: 100 });
const ok = rows.filter((r) => !r.error);
console.log(`  probes ok = ${ok.length}/${rows.length}`);
if (ok[0]?.error) console.log('  err:', ok[0].error);
for (const f of ['dns', 'tcp', 'tls', 'ttfb', 'total']) {
  const s = summary(pluck(ok, f));
  console.log(`  ${f.padEnd(6)} p50=${s.p50} p90=${s.p90} p99=${s.p99} (n=${s.n})`);
}

console.log('\n# selftest 2/2: stats sanity on synthetic 1..1000');
const synth = Array.from({ length: 1000 }, (_, i) => i + 1);
const s = summary(synth);
console.log('  ', JSON.stringify({ n: s.n, p50: s.p50, p90: s.p90, p99: s.p99, p999: s.p999, max: s.max }));
const okStats = Math.abs(s.p50 - 500.5) < 1 && Math.abs(s.p99 - 990.1) < 1;
console.log(`  percentile check: ${okStats ? 'PASS' : 'FAIL'}`);
console.log('\nselftest done. If probes ok and percentile check PASS, transport+stats are working.');
