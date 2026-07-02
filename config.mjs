// config.mjs — sampling params, the fixed SQL set, and idle-wait guidance.
// Everything credential-related comes from env (.env). See .env.example.

export const SAMPLING = {
  WARM_SAMPLES: Number(process.env.WARM_SAMPLES ?? 200), // warm-loop query count
  TRANSPORT_SAMPLES: Number(process.env.TRANSPORT_SAMPLES ?? 30),
  GAP_MS: Number(process.env.GAP_MS ?? 0),               // spacing between samples
  SEED_ROWS: Number(process.env.SEED_ROWS ?? 10000),     // bench table size
};

// Idle thresholds to INDUCE the cold path (see plan §4A/§5). The harness cannot
// verify provider idle state; confirm via the provider console (Neon Branches
// Active/Idle, Supabase project status) BEFORE taking a cold sample.
export const IDLE_GUIDANCE = {
  neon:     '5-min scale-to-zero. Soak >=10 min, kill pooler/keepalive/pings, confirm "Idle" in console.',
  supabase: 'No scale-to-zero; cold = restore-from-pause. Needs a project idled >=7 days, then manual Resume.',
  turso:    'Vendor claims "no cold start". Soak hours, then first query, to test the claim.',
  d1:       'No compute concept. Soak hours, first query vs warm, to test "no cold start".',
};

// Dialect-specific SQL. pg = Postgres ($1); sqlite = Turso/D1 (?).
// unindexed_scan is the QUOTA-BURN query: forces a full scan (rows_read = scanned rows on D1/Turso).
const PG = {
  dialect: 'pg',
  schema: [
    'CREATE TABLE IF NOT EXISTS bench (id serial PRIMARY KEY, k int, v text)',
    'CREATE INDEX IF NOT EXISTS bench_k_idx ON bench(k)',
  ],
  seed: (n) => `INSERT INTO bench(k, v) SELECT (random()*1e6)::int, md5(g::text) FROM generate_series(1,${n}) g`,
  q: {
    select1:        { sql: 'SELECT 1', params: [] },
    pk_lookup:      { sql: 'SELECT * FROM bench WHERE id = $1', params: [1] },
    indexed_range:  { sql: 'SELECT * FROM bench WHERE k BETWEEN $1 AND $2 LIMIT 100', params: [1, 5000] },
    unindexed_scan: { sql: "SELECT count(*) FROM bench WHERE v LIKE $1", params: ['%zzz%'] },
    count:          { sql: 'SELECT count(*) FROM bench', params: [] },
    insert:         { sql: 'INSERT INTO bench(k, v) VALUES($1, $2)', params: [1, 'x'] },
    update:         { sql: 'UPDATE bench SET v = $1 WHERE id = $2', params: ['y', 1] },
  },
};
const SQLITE = {
  dialect: 'sqlite',
  schema: [
    'CREATE TABLE IF NOT EXISTS bench (id integer PRIMARY KEY, k integer, v text)',
    'CREATE INDEX IF NOT EXISTS bench_k_idx ON bench(k)',
  ],
  seed: null, // seed via a loop in the runner (SQLite has no generate_series by default)
  q: {
    select1:        { sql: 'SELECT 1', params: [] },
    pk_lookup:      { sql: 'SELECT * FROM bench WHERE id = ?', params: [1] },
    indexed_range:  { sql: 'SELECT * FROM bench WHERE k BETWEEN ? AND ? LIMIT 100', params: [1, 5000] },
    unindexed_scan: { sql: "SELECT count(*) FROM bench WHERE v LIKE ?", params: ['%zzz%'] },
    count:          { sql: 'SELECT count(*) FROM bench', params: [] },
    insert:         { sql: 'INSERT INTO bench(k, v) VALUES(?, ?)', params: [1, 'x'] },
    update:         { sql: 'UPDATE bench SET v = ? WHERE id = ?', params: ['y', 1] },
  },
};

export const DIALECTS = { pg: PG, sqlite: SQLITE };
export const QUERY_ORDER = ['select1', 'pk_lookup', 'indexed_range', 'unindexed_scan', 'count', 'insert', 'update'];
