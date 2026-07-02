// ping.mjs — connectivity check for one or more targets. Prints timing/meta/error only (never creds).
// Usage: node --env-file=.env bin/ping.mjs neon-http neon
import { makeTarget } from '../lib/targets.mjs';
const names = process.argv.slice(2);
if (!names.length) { console.error('usage: node --env-file=.env bin/ping.mjs <target...>'); process.exit(1); }
for (const name of names) {
  try {
    const t = makeTarget(name);
    const o = await t.open();
    const r = await t.run({ sql: 'SELECT 1 as one', params: [] });
    console.log(`${name}_PING ` + JSON.stringify({ connectMs: o.connectMs ? Math.round(o.connectMs) : null, ms: Math.round(r.ms * 100) / 100, meta: r.meta, error: r.error }));
    await t.close();
  } catch (e) { console.log(`${name}_ERR ` + String(e).slice(0, 200)); }
}
