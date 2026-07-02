// neon-cold-series.mjs — Neon's REAL scale-to-zero cold start (compute wake), rigorous.
// Per sample: idle idleSec (default 420s > 5min so Free compute suspends with margin),
// then run coldstart in a FRESH child process (fresh DNS/TLS/connection — no in-process
// cache warming; audit C3 fix). pg open() captures the wake in connectMs.
// NOTE: suspend is not programmatically verified — confirm "Idle" in the Neon console when possible.
// Usage: node --env-file=.env bin/neon-cold-series.mjs [N=15] [idleSec=420]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const N = Number(process.argv[2] || 15);
const idleSec = Number(process.argv[3] || 420);
const coldstart = fileURLToPath(new URL('./coldstart.mjs', import.meta.url));
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

console.log(`neon cold series: N=${N}, idle=${idleSec}s each (~${Math.round(N * (idleSec + 3) / 60)}min total). fresh process per sample.`);
for (let i = 0; i < N; i++) {
  console.log(`[${i + 1}/${N}] idling ${idleSec}s so the compute suspends (scale-to-zero)...`);
  await sleep(idleSec);
  try {
    const out = execFileSync('node', ['--env-file=' + envFile, coldstart, '--target', 'neon', '--mode', 'cold', '--label', `wake-idle${idleSec}s`],
      { encoding: 'utf8' });
    const m = out.match(/connectMs:\s*([\d.]+)/);
    console.log(`  sample ${i + 1}: connectMs(wake)=${m ? Math.round(Number(m[1])) : '?'}ms`);
  } catch (e) {
    console.log(`  sample ${i + 1} error: ${String(e.stderr || e).slice(0, 160)}`);
  }
}
console.log('neon cold series done. aggregate: node bin/report.mjs results/neon-tokyo.jsonl');
