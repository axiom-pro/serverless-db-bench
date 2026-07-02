// transport.mjs — HTTPS transport decomposition via `curl -w`.
// Measures DNS / TCP / TLS / TTFB by phase, using a FRESH connection each call
// (each curl process = new socket => cold-connection transport, no keep-alive reuse).
// No npm deps. Works on Windows (NUL) and Linux/macOS (/dev/null).
import { execFile } from 'node:child_process';
import { platform } from 'node:process';

const NULLDEV = platform === 'win32' ? 'NUL' : '/dev/null';

// curl -w variables are cumulative "from the start"; per-phase = deltas.
const WRITEOUT = [
  'namelookup=%{time_namelookup}',
  'connect=%{time_connect}',
  'appconnect=%{time_appconnect}',
  'pretransfer=%{time_pretransfer}',
  'starttransfer=%{time_starttransfer}',
  'total=%{time_total}',
  'code=%{http_code}',
].join(' ') + '\\n';

function parseWriteout(s) {
  const o = {};
  for (const tok of s.trim().split(/\s+/)) {
    const [k, v] = tok.split('=');
    o[k] = k === 'code' ? Number(v) : Number(v);
  }
  // seconds -> ms, and cumulative -> per-phase deltas
  const ms = (x) => Math.round((x || 0) * 1e6) / 1e3; // us precision, ms unit
  const dns = ms(o.namelookup);
  const tcp = ms(o.connect - o.namelookup);
  const tls = ms(o.appconnect ? o.appconnect - o.connect : 0);
  const ttfb = ms(o.starttransfer);
  const server_wait = ms(o.starttransfer - o.pretransfer); // server think + first-byte tail
  const total = ms(o.total);
  return { code: o.code, dns, tcp, tls, ttfb, server_wait, total,
           _raw: { namelookup: ms(o.namelookup), connect: ms(o.connect),
                   appconnect: ms(o.appconnect), pretransfer: ms(o.pretransfer),
                   starttransfer: ms(o.starttransfer), total: ms(o.total) } };
}

// One transport probe. opts: { method, headers:{}, body, timeoutMs }
export function probeOnce(url, opts = {}) {
  const args = ['-s', '-o', NULLDEV, '-w', WRITEOUT, '--max-time', String((opts.timeoutMs ?? 30000) / 1000)];
  if (opts.method && opts.method !== 'GET') args.push('-X', opts.method);
  for (const [k, v] of Object.entries(opts.headers || {})) args.push('-H', `${k}: ${v}`);
  if (opts.body != null) args.push('--data-binary', typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
  args.push(url);
  return new Promise((resolve) => {
    execFile('curl', args, { windowsHide: true }, (err, stdout, stderr) => {
      if (err && !stdout) return resolve({ error: String(stderr || err).trim() });
      try { resolve(parseWriteout(stdout)); }
      catch (e) { resolve({ error: 'parse: ' + String(e), stdout }); }
    });
  });
}

// N probes. Set opts.gapMs to space them (avoid coordinated bursts / rate limits).
export async function probe(url, { samples = 30, gapMs = 0, ...opts } = {}) {
  const out = [];
  for (let i = 0; i < samples; i++) {
    out.push(await probeOnce(url, opts));
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
  }
  return out;
}
