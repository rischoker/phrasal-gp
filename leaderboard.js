// Global leaderboard (Supabase via REST, called only from the server → no proxy problems for students)
'use strict';
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_KEY || '';
const TABLE = 'phrasalgp_scores';
const enabled = () => !!(URL_ && KEY);

function headers(extra) { return Object.assign({ apikey: KEY, 'Content-Type': 'application/json' }, KEY.startsWith('eyJ') ? { Authorization: 'Bearer ' + KEY } : {}, extra || {}); }

async function rest(path, opts = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(URL_ + '/rest/v1/' + path, Object.assign({}, opts, { headers: headers(opts.headers), signal: ctrl.signal }));
    if (!res.ok) throw new Error('supabase ' + res.status + ' ' + (await res.text()).slice(0, 200));
    return res;
  } finally { clearTimeout(to); }
}

async function rankOf(circuit, laps, col, value) {
  const q = TABLE + '?select=id&circuit=eq.' + encodeURIComponent(circuit) + '&laps=eq.' + laps + '&' + col + '=lt.' + value + '&limit=1';
  const res = await rest(q, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
  const cr = res.headers.get('content-range') || '*/0';
  return (+cr.split('/')[1] || 0) + 1;
}

const cache = new Map();

// Save one race; returns records [{id, name, kind:'race'|'lap', rank, ms}] for ranks <= 10
async function saveRace(results, playersCount) {
  if (!enabled()) return [];
  const rows = results.rows.filter(r => r.correct + r.wrong > 0).map(r => ({
    name: r.name, car: r.car, circuit: results.circuitId, level: results.level, laps: results.laps,
    pos: r.pos, players: playersCount,
    race_ms: r.finished && r.time ? Math.round(r.time) : null,
    best_lap_ms: r.bestLap ? Math.round(r.bestLap) : null,
    correct: r.correct, wrong: r.wrong, accuracy: r.feedback.acc, best_streak: r.bestStreak,
  }));
  if (!rows.length) return [];
  await rest(TABLE, { method: 'POST', body: JSON.stringify(rows), headers: { Prefer: 'return=minimal' } });
  cache.clear();
  const records = [];
  for (const row of rows) {
    if (row.race_ms) { const rank = await rankOf(row.circuit, row.laps, 'race_ms', row.race_ms); if (rank <= 10) records.push({ name: row.name, kind: 'race', rank, ms: row.race_ms }); }
    if (row.best_lap_ms) { const rank = await rankOf(row.circuit, row.laps, 'best_lap_ms', row.best_lap_ms); if (rank <= 10) records.push({ name: row.name, kind: 'lap', rank, ms: row.best_lap_ms }); }
  }
  return records;
}

async function top(circuit, laps) {
  if (!enabled()) return { enabled: false };
  const key = circuit + ':' + laps;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 30000) return hit.v;
  const base = TABLE + '?circuit=eq.' + encodeURIComponent(circuit) + '&laps=eq.' + (+laps) + '&select=name,car,level,race_ms,best_lap_ms,correct,wrong,accuracy,created_at';
  const [races, lapsTop, answers] = await Promise.all([
    rest(base + '&race_ms=not.is.null&order=race_ms.asc&limit=10').then(r => r.json()),
    rest(base + '&best_lap_ms=not.is.null&order=best_lap_ms.asc&limit=10').then(r => r.json()),
    rest(TABLE + '?laps=eq.' + (+laps) + '&select=name,car,level,correct,wrong,accuracy,circuit,created_at&order=correct.desc,accuracy.desc&limit=10').then(r => r.json()),
  ]);
  const v = { enabled: true, circuit, laps: +laps, races, laps_top: lapsTop, answers };
  cache.set(key, { t: Date.now(), v });
  return v;
}

module.exports = { saveRace, top, enabled };
