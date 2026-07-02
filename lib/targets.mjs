// targets.mjs — per-DB adapters with a common interface.
// Interface: { name, kind, dialect, open(), run(sqlObj)->{ms,serverMs?,meta?}, close(), transport()->{url,opts}|null }
// Drivers are dynamic-imported: only the target you actually run needs its npm package.
//   Supabase / Neon(direct): `pg`      Neon(HTTP): `@neondatabase/serverless`
//   Turso: `@libsql/client`            D1: native fetch (no package)
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`missing env ${k}`); return v; };
const hostOf = (u) => { try { return new URL(u.replace(/^postgres(ql)?:\/\//, 'https://')).host; } catch { return null; } };
const now = () => Number(process.hrtime.bigint()) / 1e6; // ms, monotonic (ns→ms, no µs truncation)

// --- pg (Supabase direct/pooler, Neon direct TCP) ---
function pgTarget(name, urlEnv) {
  let client = null, Client = null;
  const url = need(urlEnv);
  return {
    name, kind: 'pg', dialect: 'pg',
    async open() {
      ({ default: { Client } } = await import('pg').then((m) => ({ default: m.default })));
      client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
      const t = now(); await client.connect(); return { connectMs: now() - t };
    },
    async run({ sql, params }) { const t = now(); const r = await client.query(sql, params); return { ms: now() - t, meta: { rowCount: r.rowCount } }; },
    async close() { try { await client?.end(); } catch {} },
    transport() { const h = hostOf(url); return h ? { url: `https://${h}/`, opts: { method: 'GET' } } : null; },
  };
}

// --- Neon HTTP serverless driver (the edge cold-start path) ---
function neonHttpTarget() {
  let sql = null; const url = need('NEON_DATABASE_URL');
  return {
    name: 'neon-http', kind: 'neon-http', dialect: 'pg',
    async open() { const { neon } = await import('@neondatabase/serverless'); sql = neon(url); const t = now(); await sql.query('SELECT 1'); return { connectMs: now() - t }; },
    async run({ sql: text, params }) { const t = now(); await sql.query(text, params); return { ms: now() - t }; },
    async close() {},
    transport() { const h = hostOf(url); return h ? { url: `https://${h}/`, opts: { method: 'GET' } } : null; },
  };
}

// --- Turso (libSQL) ---
function tursoTarget() {
  let c = null; const url = need('TURSO_DATABASE_URL'); const authToken = need('TURSO_AUTH_TOKEN');
  return {
    name: 'turso', kind: 'turso', dialect: 'sqlite',
    async open() { const { createClient } = await import('@libsql/client'); c = createClient({ url, authToken }); const t = now(); await c.execute('SELECT 1'); return { connectMs: now() - t }; },
    async run({ sql, params }) { const t = now(); const r = await c.execute({ sql, args: params }); return { ms: now() - t, meta: { rows: r.rows?.length } }; },
    async close() { try { c?.close?.(); } catch {} },
    transport() { const h = hostOf(url.replace(/^libsql:\/\//, 'https://')); return h ? { url: `https://${h}/health`, opts: { method: 'GET' } } : null; },
  };
}

// --- Cloudflare D1 via REST API (captures server duration + rows_read/written) ---
function d1Target() {
  const acct = need('CF_ACCOUNT_ID'), dbid = need('CF_D1_DATABASE_ID'), token = need('CF_API_TOKEN');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${acct}/d1/database/${dbid}/query`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  return {
    name: 'd1', kind: 'd1-rest', dialect: 'sqlite',
    async open() { const t = now(); await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ sql: 'SELECT 1', params: [] }) }); return { connectMs: now() - t }; },
    async run({ sql, params }) {
      const t = now();
      const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify({ sql, params }) });
      const j = await res.json();
      const ms = now() - t;
      const meta = j?.result?.[0]?.meta || {};
      if (!res.ok || j?.success === false) return { ms, error: JSON.stringify(j?.errors || j).slice(0, 400), meta, status: res.status };
      return { ms, serverMs: meta.duration, meta: { rows_read: meta.rows_read, rows_written: meta.rows_written, served_by: meta.served_by_region || meta.served_by_primary } };
    },
    async close() {},
    transport() { return { url: endpoint, opts: { method: 'POST', headers, body: JSON.stringify({ sql: 'SELECT 1', params: [] }) } }; },
  };
}

export function makeTarget(name) {
  switch (name) {
    case 'supabase':        return pgTarget('supabase', 'SUPABASE_DATABASE_URL');        // direct
    case 'supabase-pooler': return pgTarget('supabase-pooler', 'SUPABASE_POOLER_URL');   // Supavisor
    case 'neon':            return pgTarget('neon', 'NEON_DIRECT_URL');                   // direct TCP
    case 'neon-http':       return neonHttpTarget();                                     // serverless HTTP
    case 'turso':           return tursoTarget();
    case 'd1':              return d1Target();
    default: throw new Error(`unknown target "${name}". one of: supabase, supabase-pooler, neon, neon-http, turso, d1`);
  }
}
export const ALL_TARGETS = ['supabase', 'supabase-pooler', 'neon', 'neon-http', 'turso', 'd1'];
