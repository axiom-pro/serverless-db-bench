// stats.mjs — latency summary with percentiles. No npm deps.
// Percentile = linear interpolation (R-7 / numpy default).
// NOTE on percentiles & sampling (see plan §5):
//  - p99 needs >=100 samples to have any observation at the 99th percentile;
//    a stable p99 wants thousands. We WARN below the floor rather than lie.
//  - Percentiles are NOT additive: never average p99 across regions/nodes.
//    Aggregate the raw samples here, then compute the global percentile.
//  - These summaries are for per-cold-sample sets and warm-loop sets. For
//    warm THROUGHPUT percentiles under sustained load, prefer wrk2 + HdrHistogram
//    (coordinated-omission correct); this module does not correct for CO.

export function percentile(values, p) {
  const s = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  if (p <= 0) return s[0];
  if (p >= 100) return s[s.length - 1];
  const rank = (p / 100) * (s.length - 1);
  const lo = Math.floor(rank), hi = Math.ceil(rank);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (rank - lo);
}

export function summary(values, { unit = 'ms' } = {}) {
  const v = values.filter((x) => Number.isFinite(x));
  const n = v.length;
  if (!n) return { n: 0 };
  const mean = v.reduce((a, b) => a + b, 0) / n;
  const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
  const warnings = [];
  if (n < 100) warnings.push(`n=${n} <100: p99 is unreliable (fewer than 1 observation at the tail).`);
  else if (n < 1000) warnings.push(`n=${n} <1000: p99 usable but wide CI; p99.9 not populated.`);
  return {
    n, unit,
    mean: r2(mean), stddev: r2(Math.sqrt(variance)),
    min: r2(Math.min(...v)),
    p50: r2(percentile(v, 50)), p90: r2(percentile(v, 90)),
    p95: r2(percentile(v, 95)), p99: r2(percentile(v, 99)),
    p999: n >= 1000 ? r2(percentile(v, 99.9)) : null,
    max: r2(Math.max(...v)),
    warnings,
  };
}

// Pull one numeric field out of an array of result objects (skips errors/nulls).
export function pluck(rows, field) {
  return rows.map((r) => (r ? r[field] : undefined)).filter((x) => Number.isFinite(x));
}
