// mirror-neon.mjs — copy NEON_DATABASE_URL into NEON_DIRECT_URL in .env (no printing of the secret).
import fs from 'node:fs';
const p = new URL('../.env', import.meta.url);
let s = fs.readFileSync(p, 'utf8');
const m = s.match(/^NEON_DATABASE_URL=(.+)$/m);
if (!m || /USER:PW|xxxx|^\s*$/.test(m[1])) { console.log('NEON_DATABASE_URL not set yet (still placeholder)'); process.exit(1); }
s = s.replace(/^NEON_DIRECT_URL=.*$/m, 'NEON_DIRECT_URL=' + m[1]);
fs.writeFileSync(p, s);
console.log('mirrored NEON_DATABASE_URL -> NEON_DIRECT_URL');
