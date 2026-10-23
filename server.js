// Phrasal Verbs Grand Prix — Express + Socket.IO server (authoritative race simulation)
'use strict';
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { BANK, LEVELS } = require('./data/questions');
const LB = require('./leaderboard');
const { reviewHtml } = require('./review');

const PORT = process.env.PORT || 3000;
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// ---------- static ----------
app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) }));
app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', req.query.host ? 'host.html' : 'phone.html'));
});
app.get('/host', (req, res) => res.redirect('/?host=1'));
app.get('/review/:code/:pid', (req, res) => {
  const room = rooms.get(String(req.params.code).toUpperCase());
  const p = room && room.players.get(req.params.pid);
  const rv = room && room.reviews && room.reviews[req.params.pid];
  if (!p || !rv || p.token !== req.query.t) return res.status(404).send('<meta name="viewport" content="width=device-width"><p style="font-family:sans-serif">This review is no longer available (the room was closed). Ask your teacher for a new race!</p>');
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', 'text/html; charset=utf-8');
  if (req.query.dl) res.set('Content-Disposition', 'attachment; filename="PhrasalGP-review-' + p.name.replace(/[^A-Za-z0-9]+/g, '_') + '.html"');
  res.send(reviewHtml(rv));
});
app.get('/api/leaderboard', async (req, res) => {
  res.set('Cache-Control', 'no-cache');
  const laps = LAP_OPTIONS.includes(+req.query.laps) ? +req.query.laps : 5;
  const circuit = String(req.query.circuit || 'boston').replace(/[^a-z0-9-]/gi, '').slice(0, 30);
  try { res.json(await LB.top(circuit, laps)); } catch (e) { console.error('leaderboard', e.message); res.status(502).json({ enabled: LB.enabled(), error: 'unavailable' }); }
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, p) {
    if (/\.(glb|png|woff2)$/.test(p)) res.set('Cache-Control', 'public, max-age=604800');
    else res.set('Cache-Control', 'no-cache');
  },
}));

const server = http.createServer(app);
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 20000,
  perMessageDeflate: false,
  httpCompression: true,
  maxHttpBufferSize: 1e5,
  cors: { origin: true, credentials: true },
  allowEIO3: true,
});

// ---------- game data ----------
const CARS = [
  { id: 'race', name: 'Formula' }, { id: 'race-future', name: 'Hyper GT' },
  { id: 'sedan-sports', name: 'Sport Sedan' }, { id: 'hatchback-sports', name: 'Hot Hatch' },
  { id: 'kart-oobi', name: 'Kart Oobi' }, { id: 'kart-oodi', name: 'Kart Oodi' },
  { id: 'kart-ooli', name: 'Kart Ooli' }, { id: 'kart-oopi', name: 'Kart Oopi' },
  { id: 'kart-oozi', name: 'Kart Oozi' }, { id: 'police', name: 'Police' },
  { id: 'taxi', name: 'Taxi' }, { id: 'ambulance', name: 'Ambulance' },
  { id: 'firetruck', name: 'Fire Truck' }, { id: 'suv-luxury', name: 'Luxury SUV' },
  { id: 'tractor', name: 'Tractor' }, { id: 'garbage-truck', name: 'Garbage Truck' },
  { id: 'van', name: 'Van' }, { id: 'delivery', name: 'Delivery' },
];
const CAR_IDS = new Set(CARS.map(c => c.id));
const TEAM_COLORS = ['#e8002d', '#ff8000', '#27f4d2', '#3671c6', '#229971', '#ff87bc'];
const LAP_OPTIONS = [5, 10, 20, 30];
const BASE_LAP_SECONDS = { 5: 34, 10: 26, 20: 19, 30: 15 };
const TEST_SPEED = +process.env.PGP_TEST_SPEED || 1; // dev only: faster races for testing
const MAX_PLAYERS = 6;
const POWERS = ['turbo', 'shrink', 'missile', 'shield'];
const STREAK_FOR_POWER = 3;
const TRAILING_GAP = 0.18; // laps behind the leader to count as 'far behind'
const CP_PER_LAP = 24; // timing checkpoints per lap (sectors at 8 and 16)
const TICK_MS = 100;

const rooms = new Map();

function now() { return Date.now(); }
function code4() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c;
  do { c = ''; for (let i = 0; i < 4; i++) c += A[Math.floor(Math.random() * A.length)]; } while (rooms.has(c));
  return c;
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function cleanName(n) { return String(n || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 12); }
function tok() { return crypto.randomBytes(12).toString('hex'); }

function newRoom(hostToken) {
  const room = {
    code: code4(), hostToken, hostSocket: null, state: 'lobby',
    settings: { level: 'B1', laps: 5, circuitId: 'boston', circuitName: 'Boston Grand Prix' },
    players: new Map(), race: null, results: null, lastActivity: now(), raceNo: 0,
  };
  rooms.set(room.code, room);
  return room;
}

function freshStats() {
  return { correct: 0, wrong: 0, streak: 0, bestStreak: 0, powersUsed: 0, missed: [], byParticle: {}, log: [] };
}

function newPlayer(room, name, token) {
  const used = new Set([...room.players.values()].map(p => p.color));
  const color = TEAM_COLORS.find(c => !used.has(c)) || TEAM_COLORS[0];
  const p = {
    id: tok().slice(0, 8), token: token || tok(), name, car: null, color, socketId: null, connected: false,
    lastSeen: now(), stats: freshStats(), deck: [], q: null, qSeq: 0, pendingPower: false, powerCredits: 0,
    // race state
    dist: 0, momentum: 1, effects: {}, lapStart: 0, lapTimes: [], bestLap: null, lastLap: null,
    sector: [null, null, null], bestSector: [null, null, null], sectorStart: 0, cpIndex: -1, cpTime: 0,
    finished: false, finishTime: null, lapsDone: 0, finishTarget: null,
  };
  room.players.set(p.id, p);
  return p;
}

// ---------- serialisation ----------
function publicPlayer(p) {
  return { id: p.id, name: p.name, car: p.car, color: p.color, connected: p.connected };
}
function roomState(room) {
  return {
    code: room.code, state: room.state, settings: room.settings, raceNo: room.raceNo,
    players: [...room.players.values()].map(publicPlayer), cars: CARS, levels: LEVELS.concat(['MIX']), laps: LAP_OPTIONS,
    maxPlayers: MAX_PLAYERS, serverNow: now(), race: room.race ? raceInfo(room) : null, results: room.state === 'finished' ? room.results : null,
  };
}
function raceInfo(room) {
  const r = room.race;
  return { startAt: r.startAt, greenAt: r.greenAt, flagAt: r.flagAt, endsAt: r.endsAt, laps: r.laps, grid: r.grid, baseLap: r.baseLap };
}
function phoneState(room, p) {
  return {
    code: room.code, phase: room.state, settings: room.settings, raceNo: room.raceNo,
    you: { id: p.id, name: p.name, car: p.car, color: p.color, token: p.token, finished: p.finished, pendingPower: p.pendingPower },
    cars: CARS, taken: [...room.players.values()].filter(o => o.car && o.id !== p.id).map(o => ({ car: o.car, name: o.name })),
    race: room.race ? { greenAt: room.race.greenAt, laps: room.race.laps } : null,
    question: room.state === 'race' && p.q && !p.finished ? questionForPhone(p) : null,
    results: room.state === 'finished' ? room.results : null,
    serverNow: now(),
  };
}
function questionForPhone(p) {
  const o = { seq: p.qSeq, q: p.q.q, options: p.q.opts, level: p.q.level };
  if (TEST_SPEED !== 1) o._c = p.q.correctIdx; // dev/test mode only
  return o;
}

function emitRoom(room) {
  if (room.hostSocket) io.to(room.hostSocket).emit('room:state', roomState(room));
  for (const p of room.players.values()) if (p.socketId) io.to(p.socketId).emit('p:state', phoneState(room, p));
}

// ---------- questions ----------
function nextQuestion(room, p) {
  const lvl = room.settings.level;
  if (!p.deck.length) {
    const pool = lvl === 'MIX' ? LEVELS.flatMap(l => BANK[l]) : BANK[lvl] || BANK.B1;
    p.deck = shuffle(pool.slice());
    // avoid immediate repeat across deck boundary
    if (p.q && p.deck[p.deck.length - 1].id === p.q.id) p.deck.unshift(p.deck.pop());
  }
  const q = p.deck.pop();
  const opts = shuffle(q.options.slice());
  p.qSeq++;
  p.q = { id: q.id, q: q.q, opts, correctIdx: opts.indexOf(q.answer), answer: q.answer, meaning: q.meaning, pv: q.pv, particle: q.particle, level: q.level, sentAt: now() };
  return questionForPhone(p);
}

// ---------- race ----------
function startRace(room) {
  const players = [...room.players.values()];
  // auto-assign cars for players who did not choose
  const taken = new Set(players.map(p => p.car).filter(Boolean));
  for (const p of players) if (!p.car) { const c = CARS.find(c => !taken.has(c.id)); p.car = c.id; taken.add(c.id); }
  const t = now();
  const grid = shuffle(players.map(p => p.id));
  const laps = room.settings.laps;
  room.raceNo++;
  room.race = {
    startAt: t, greenAt: t + 7000, flagAt: null, endsAt: null, laps, grid, baseLap: (BASE_LAP_SECONDS[laps] || 26) / TEST_SPEED,
    cpFirst: [], bestSector: [null, null, null], bestLap: null, lastTick: t, events: [], finishOrder: [],
  };
  grid.forEach((id, i) => {
    const p = room.players.get(id);
    Object.assign(p, {
      stats: freshStats(), deck: [], q: null, pendingPower: false, powerCredits: 0,
      dist: -0.004 - i * 0.0095, momentum: 1, effects: {}, lapStart: room.race.greenAt, lapTimes: [], bestLap: null, lastLap: null,
      sector: [null, null, null], bestSector: [null, null, null], sectorStart: room.race.greenAt, cpIndex: -1, cpTime: room.race.greenAt,
      finished: false, finishTime: null, lapsDone: 0, finishTarget: null, gridPos: i + 1,
    });
  });
  room.state = 'countdown';
  room.results = null;
  emitRoom(room);
}

function effectMult(p, t) {
  const e = p.effects;
  let m = 1;
  if (e.boost > t) m *= 1.3;
  if (e.stall > t) m *= 0.62;
  if (e.turbo > t) m *= 1.75;
  if (e.shrink > t) m *= 0.6;
  if (e.spin > t) m *= 0.12;
  return m;
}
function effectFlags(p, t) {
  const e = p.effects;
  return (e.boost > t ? 1 : 0) | (e.stall > t ? 2 : 0) | (e.turbo > t ? 4 : 0) | (e.shrink > t ? 8 : 0) | (e.spin > t ? 16 : 0) | (e.shield > t ? 32 : 0);
}

function speedOf(room, p, t, leaderDist) {
  if (p.finished) return 0.35 / room.race.baseLap; // cool-down lap
  let s = p.momentum * effectMult(p, t);
  const behind = leaderDist - p.dist;
  // catch-up for slower students: keeps the whole class in the same part of the race
  if (behind > 0.5) s *= 1.32; else if (behind > 0.3) s *= 1.2; else if (behind > 0.15) s *= 1.1;
  return s / room.race.baseLap;
}

function raceEvent(room, ev) {
  if (room.hostSocket) io.to(room.hostSocket).emit('race:event', ev);
}

function tickRoom(room, t) {
  const r = room.race;
  if (!r) return;
  if (room.state === 'countdown' && t >= r.greenAt) {
    room.state = 'race';
    for (const p of room.players.values()) { nextQuestion(room, p); }
    emitRoom(room);
  }
  if (room.state === 'countdown') {
    if (room.hostSocket && (!r.lastStand || t - r.lastStand >= 500)) { r.lastStand = t; io.to(room.hostSocket).emit('race:standings', standings(room, t)); }
    r.lastTick = t;
    return;
  }
  if (room.state !== 'race') return;
  const dt = Math.min(0.5, (t - r.lastTick) / 1000);
  r.lastTick = t;
  const players = [...room.players.values()];
  const leaderDist = Math.max(...players.filter(p => !p.finished).map(p => p.dist), -1);

  for (const p of players) {
    // momentum drifts towards 0.85 so students must keep answering
    const target = 0.85;
    if (p.momentum > target) p.momentum = Math.max(target, p.momentum - 0.012 * dt);
    else p.momentum = Math.min(target, p.momentum + 0.008 * dt);
    const v = speedOf(room, p, t, leaderDist);
    p.speed = v;
    const before = p.dist;
    p.dist += v * dt;
    if (p.finished) continue;
    // checkpoints & timing
    const cpBefore = Math.floor(before * CP_PER_LAP), cpAfter = Math.floor(p.dist * CP_PER_LAP);
    for (let cp = cpBefore + 1; cp <= cpAfter; cp++) {
      if (cp < 0) continue;
      const frac = (cp / CP_PER_LAP - before) / Math.max(1e-9, p.dist - before);
      const ct = t - (1 - frac) * dt * 1000;
      if (r.cpFirst[cp] == null) r.cpFirst[cp] = ct;
      p.cpIndex = cp; p.cpTime = ct;
      const within = cp % CP_PER_LAP;
      if (within === 8 || within === 16 || within === 0) {
        const si = within === 8 ? 0 : within === 16 ? 1 : 2;
        if (cp > 0) {
          const st = ct - p.sectorStart;
          p.sector[si] = st;
          let col = 'yellow';
          if (p.bestSector[si] == null || st < p.bestSector[si]) { p.bestSector[si] = st; col = 'green'; }
          if (r.bestSector[si] == null || st < r.bestSector[si].t) { r.bestSector[si] = { t: st, id: p.id }; col = 'purple'; }
          p.sectorCol = p.sectorCol || [null, null, null];
          p.sectorCol[si] = col;
        }
        p.sectorStart = ct;
        if (si === 0) { p.sector[1] = null; p.sector[2] = null; if (p.sectorCol) { p.sectorCol[1] = null; p.sectorCol[2] = null; } }
      }
      if (within === 0 && cp > 0) {
        // lap completed
        const lt = ct - p.lapStart;
        p.lapStart = ct;
        p.lapsDone = cp / CP_PER_LAP;
        p.lapTimes.push(lt); p.lastLap = lt;
        let fastest = false;
        if (p.bestLap == null || lt < p.bestLap) p.bestLap = lt;
        if (r.bestLap == null || lt < r.bestLap.t) { r.bestLap = { t: lt, id: p.id, lap: p.lapsDone }; fastest = true; }
        raceEvent(room, { type: 'lap', id: p.id, lap: p.lapsDone, time: lt, fastest });
        // finish?
        const done = (r.flagAt == null && p.lapsDone >= r.laps) || (r.flagAt != null && p.lapsDone >= p.finishTarget);
        if (done) {
          if (r.flagAt == null) {
            r.flagAt = ct; r.endsAt = ct + 30000;
            for (const o of players) if (o !== p && !o.finished) o.finishTarget = Math.floor(o.dist) + 1;
          }
          p.finished = true; p.finishTime = ct - r.greenAt; p.q = null;
          r.finishOrder.push(p.id);
          raceEvent(room, { type: 'finish', id: p.id, pos: r.finishOrder.length, time: p.finishTime });
          if (p.socketId) io.to(p.socketId).emit('p:finished', { pos: r.finishOrder.length, time: p.finishTime });
          break;
        }
      }
    }
  }

  // race end conditions
  const allDone = players.every(p => p.finished || (!p.connected && t - p.lastSeen > 60000));
  if (r.flagAt != null && (allDone || t >= r.endsAt)) return finishRace(room);
  // safety cap: very long race (e.g. everybody idle) – 3x expected duration
  if (t - r.greenAt > r.laps * r.baseLap * 1000 * 3.2) return finishRace(room);

  // host tick (10 Hz)
  if (room.hostSocket) {
    io.to(room.hostSocket).volatile.emit('race:tick', {
      t, el: t - r.greenAt,
      c: players.map(p => [p.id, +p.dist.toFixed(5), +(p.speed || 0).toFixed(6), effectFlags(p, t)]),
    });
  }
  // standings (2 Hz)
  if (!r.lastStand || t - r.lastStand >= 500) {
    r.lastStand = t;
    const st = standings(room, t);
    if (room.hostSocket) io.to(room.hostSocket).emit('race:standings', st);
    for (const p of players) {
      if (!p.socketId) continue;
      const row = st.rows.find(x => x.id === p.id);
      io.to(p.socketId).volatile.emit('p:race', { pos: row.pos, of: players.length, lap: Math.min(r.laps, Math.max(1, Math.floor(p.dist) + 1)), laps: r.laps, gap: row.gap, momentum: +p.momentum.toFixed(2), flags: effectFlags(p, t), streak: p.stats.streak });
    }
  }
}

function standings(room, t) {
  const r = room.race;
  const players = [...room.players.values()];
  const eff = p => p.finished ? p.lapsDone : p.dist;
  const order = players.slice().sort((a, b) => {
    const d = eff(b) - eff(a);
    if (Math.abs(d) > 1e-9) return d;
    if (a.finished && b.finished) return r.finishOrder.indexOf(a.id) - r.finishOrder.indexOf(b.id);
    return a.finished ? -1 : b.finished ? 1 : 0;
  });
  const leader = order[0];
  const rows = order.map((p, i) => {
    let gap = '';
    if (room.state === 'countdown') gap = 'GRID ' + (p.gridPos || i + 1);
    else if (i === 0) gap = p.finished ? 'WINNER' : 'LEADER';
    else if (p.finished && leader.finished && p.lapsDone === leader.lapsDone) gap = '+' + ((p.finishTime - leader.finishTime) / 1000).toFixed(3);
    else {
      const lapsBehind = Math.floor(eff(leader) - eff(p));
      if (lapsBehind >= 1 && !p.finished) gap = '+' + lapsBehind + (lapsBehind > 1 ? ' LAPS' : ' LAP');
      else if (p.cpIndex >= 0 && r.cpFirst[p.cpIndex] != null) gap = '+' + Math.max(0, (p.cpTime - r.cpFirst[p.cpIndex]) / 1000).toFixed(3);
      else gap = '+0.000';
    }
    return {
      id: p.id, pos: i + 1, name: p.name, color: p.color, car: p.car, gap,
      lap: Math.min(r.laps, Math.max(1, Math.floor(p.dist) + 1)), lapsDone: p.lapsDone,
      last: p.lastLap, best: p.bestLap, sector: p.sector, sectorCol: p.sectorCol || [null, null, null],
      correct: p.stats.correct, wrong: p.stats.wrong, streak: p.stats.streak, finished: p.finished, connected: p.connected,
      flags: effectFlags(p, t), power: p.pendingPower,
    };
  });
  const fastest = players.filter(p => p.bestLap != null).sort((a, b) => a.bestLap - b.bestLap).map(p => ({ id: p.id, name: p.name, color: p.color, t: p.bestLap }));
  const sectors = r.bestSector.map(s => s ? { t: s.t, id: s.id, name: room.players.get(s.id) ? room.players.get(s.id).name : '?', color: room.players.get(s.id) ? room.players.get(s.id).color : '#fff' } : null);
  const leaderLap = Math.min(r.laps, Math.max(1, Math.floor(leader.dist) + 1));
  return { rows, fastest, sectors, leaderLap, laps: r.laps, el: t - r.greenAt, flag: r.flagAt != null };
}

function feedbackFor(p, medianAnswers) {
  const s = p.stats;
  const total = s.correct + s.wrong;
  const acc = total ? s.correct / total : 0;
  const notes = [];
  let headline;
  if (total === 0) headline = 'No answers this race — next time, every answer moves your car!';
  else if (acc >= 0.9 && total >= medianAnswers) headline = 'Outstanding: fast AND accurate.';
  else if (acc >= 0.9) headline = 'Excellent accuracy. Now try to answer a little faster.';
  else if (acc >= 0.8) headline = 'Solid result — you passed the 80% mark.';
  else if (acc >= 0.6 && total > medianAnswers) headline = 'Fast, but rushing caused mistakes. Read the whole sentence first.';
  else if (acc >= 0.6) headline = 'Good effort. Review the verbs you missed and you will pass 80%.';
  else if (total > medianAnswers) headline = 'Too many guesses — slow down and think about the particle.';
  else headline = 'Take your time and use the context of the sentence.';
  if (s.bestStreak >= 10) notes.push('Great consistency: ' + s.bestStreak + ' correct answers in a row.');
  else if (s.bestStreak >= 5) notes.push('Nice streak of ' + s.bestStreak + ' correct answers.');
  if (s.powersUsed) notes.push('Used ' + s.powersUsed + ' power-up' + (s.powersUsed > 1 ? 's' : '') + '.');
  const parts = Object.entries(s.byParticle);
  const strengths = parts.filter(([, v]) => v.c + v.w >= 2 && v.c / (v.c + v.w) >= 0.8).sort((a, b) => b[1].c - a[1].c).slice(0, 3).map(([k]) => k.toUpperCase());
  const review = parts.filter(([, v]) => v.w >= 1 && v.c / (v.c + v.w) < 0.6).sort((a, b) => b[1].w - a[1].w).slice(0, 3).map(([k]) => k.toUpperCase());
  const seen = new Set();
  const missed = [];
  for (const m of s.missed) { if (!seen.has(m.pv)) { seen.add(m.pv); missed.push(m); } if (missed.length >= 5) break; }
  return { acc: Math.round(acc * 100), pass: acc >= 0.8 && total > 0, headline, notes, strengths, review, missed };
}

function finishRace(room) {
  const r = room.race;
  const t = now();
  const st = standings(room, t);
  const players = [...room.players.values()];
  const counts = players.map(p => p.stats.correct + p.stats.wrong).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)] || 0;
  room.results = {
    circuit: room.settings.circuitName, circuitId: room.settings.circuitId, level: room.settings.level, laps: r.laps,
    fastest: st.fastest[0] || null,
    rows: st.rows.map(row => {
      const p = room.players.get(row.id);
      return {
        pos: row.pos, id: p.id, name: p.name, color: p.color, car: p.car, finished: p.finished,
        time: p.finishTime, gap: row.gap, bestLap: p.bestLap, lapsDone: p.lapsDone,
        correct: p.stats.correct, wrong: p.stats.wrong, bestStreak: p.stats.bestStreak,
        feedback: feedbackFor(p, median),
      };
    }),
  };
  // personal study sheets (downloadable from the phone until the room closes)
  room.reviews = {};
  for (const row of room.results.rows) {
    const p = room.players.get(row.id);
    room.reviews[p.id] = Object.assign({}, row, { circuit: room.results.circuit, level: room.results.level, laps: r.laps, date: t, log: p.stats.log.slice() });
  }
  room.state = 'finished';
  for (const p of players) p.q = null;
  emitRoom(room);
  // global leaderboard (skipped in fast test mode unless PGP_LB_TEST=1)
  if (TEST_SPEED === 1 || process.env.PGP_LB_TEST) {
    const results = room.results;
    LB.saveRace(results, players.length).then(records => {
      results.records = records;
      if (room.hostSocket) io.to(room.hostSocket).emit('race:records', records);
      for (const p of room.players.values()) {
        const mine = records.filter(r => r.name === p.name);
        if (p.socketId && mine.length) io.to(p.socketId).emit('p:records', mine);
      }
    }).catch(e => console.error('leaderboard save failed:', e.message));
  }
}

// ---------- answers & powers ----------
// Last two cars (last one in a 2-car race) that are far behind the leader get catch-up power-ups
function isTrailing(room, p) {
  const active = [...room.players.values()].filter(o => !o.finished);
  if (active.length < 2 || p.finished) return false;
  const order = active.slice().sort((a, b) => b.dist - a.dist);
  const idx = order.indexOf(p);
  const tail = active.length >= 3 ? 2 : 1;
  return idx >= order.length - tail && order[0].dist - p.dist > TRAILING_GAP;
}

function handleAnswer(room, p, seq, choice) {
  if (room.state !== 'race' || !p.q || p.finished) return { error: 'not-active' };
  if (seq !== p.qSeq) return { error: 'stale', question: questionForPhone(p) };
  const t = now();
  const q = p.q;
  const correct = choice === q.correctIdx;
  const s = p.stats;
  const bp = s.byParticle[q.particle] || (s.byParticle[q.particle] = { c: 0, w: 0 });
  let power = null, catchup = false;
  s.log.push({ q: q.q, chosen: q.opts[choice] != null ? q.opts[choice] : '', answer: q.answer, correct, meaning: q.meaning, pv: q.pv });
  if (correct) {
    s.correct++; s.streak++; bp.c++;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
    p.momentum = Math.min(1.7, p.momentum + 0.09);
    p.effects.boost = t + 2000;
    if (!p.pendingPower && s.streak % STREAK_FOR_POWER === 0) { p.pendingPower = true; power = POWERS; }
    else if (!p.pendingPower && isTrailing(room, p)) { p.pendingPower = true; power = POWERS; catchup = true; }
  } else {
    s.wrong++; s.streak = 0; bp.w++;
    s.missed.push({ pv: q.pv, meaning: q.meaning, answer: q.answer, q: q.q });
    p.momentum = Math.max(0.45, p.momentum - 0.12);
    p.effects.stall = t + 1200;
  }
  raceEvent(room, { type: 'answer', id: p.id, correct, streak: s.streak, power: !!power, catchup });
  const result = { correct, correctIdx: q.correctIdx, answer: q.answer, meaning: q.meaning, streak: s.streak, power, catchup };
  result.next = nextQuestion(room, p);
  return result;
}

function usePower(room, p, type) {
  if (room.state !== 'race' || !p.pendingPower || !POWERS.includes(type) || p.finished) return { error: 'no-power' };
  const t = now();
  p.pendingPower = false;
  p.stats.powersUsed++;
  const players = [...room.players.values()].filter(o => !o.finished);
  const ev = { type: 'power', power: type, id: p.id, targets: [], blocked: [] };
  const hit = (o, fn) => {
    if (o.effects.shield > t) { o.effects.shield = 0; ev.blocked.push(o.id); return; }
    fn(o); ev.targets.push(o.id);
  };
  if (type === 'turbo') { p.effects.turbo = t + 6000; ev.targets.push(p.id); }
  else if (type === 'shield') { p.effects.shield = t + 15000; ev.targets.push(p.id); }
  else if (type === 'shrink') { for (const o of players) if (o !== p) hit(o, x => { x.effects.shrink = t + 5500; }); }
  else if (type === 'missile') {
    const order = players.slice().sort((a, b) => b.dist - a.dist);
    let target = order[0] === p ? order[1] : order[0];
    if (target) hit(target, x => { x.effects.spin = t + 2600; x.momentum = Math.max(0.45, x.momentum - 0.08); });
  }
  raceEvent(room, ev);
  for (const o of room.players.values()) {
    if (!o.socketId) continue;
    if (ev.targets.includes(o.id) && o !== p) io.to(o.socketId).emit('p:hit', { power: type, by: p.name });
    if (ev.blocked.includes(o.id)) io.to(o.socketId).emit('p:hit', { power: type, by: p.name, blocked: true });
  }
  return { ok: true, ev };
}

// ---------- sockets ----------
io.on('connection', socket => {
  socket.data = {};

  // ----- host -----
  socket.on('host:create', (msg, ack) => {
    const hostToken = (msg && msg.hostToken) || tok();
    const room = newRoom(hostToken);
    room.hostSocket = socket.id;
    socket.data.room = room.code; socket.data.host = true;
    socket.join('host:' + room.code);
    if (typeof ack === 'function') ack({ ok: true, code: room.code, hostToken });
    emitRoom(room);
  });

  socket.on('host:resume', (msg, ack) => {
    const room = msg && rooms.get(String(msg.code || '').toUpperCase());
    if (!room || room.hostToken !== msg.hostToken) return typeof ack === 'function' && ack({ ok: false });
    room.hostSocket = socket.id;
    socket.data.room = room.code; socket.data.host = true;
    room.lastActivity = now();
    if (typeof ack === 'function') ack({ ok: true, code: room.code, hostToken: room.hostToken });
    emitRoom(room);
    if (room.race && (room.state === 'race' || room.state === 'countdown')) socket.emit('race:standings', standings(room, now()));
  });

  function hostRoom() {
    const room = rooms.get(socket.data.room);
    if (!room || !socket.data.host || room.hostSocket !== socket.id) return null;
    room.lastActivity = now();
    return room;
  }

  socket.on('host:settings', msg => {
    const room = hostRoom(); if (!room || room.state === 'race' || room.state === 'countdown') return;
    const s = room.settings;
    if (msg.level && (LEVELS.includes(msg.level) || msg.level === 'MIX')) s.level = msg.level;
    if (LAP_OPTIONS.includes(+msg.laps)) s.laps = +msg.laps;
    if (msg.circuitId) { s.circuitId = String(msg.circuitId).slice(0, 30); s.circuitName = String(msg.circuitName || '').slice(0, 40); }
    emitRoom(room);
  });

  socket.on('host:start', () => {
    const room = hostRoom(); if (!room) return;
    if (room.state !== 'lobby' && room.state !== 'finished') return;
    if (room.players.size < 1) return;
    startRace(room);
  });

  socket.on('host:lobby', () => {
    const room = hostRoom(); if (!room) return;
    room.state = 'lobby'; room.race = null; room.results = null;
    for (const p of room.players.values()) { p.q = null; p.finished = false; p.pendingPower = false; }
    // drop players who left long ago
    for (const [id, p] of room.players) if (!p.connected && now() - p.lastSeen > 120000) room.players.delete(id);
    emitRoom(room);
  });

  socket.on('host:abort', () => {
    const room = hostRoom(); if (!room || !room.race) return;
    if (room.state === 'race') finishRace(room);
    else if (room.state === 'countdown') { room.state = 'lobby'; room.race = null; for (const p of room.players.values()) p.q = null; emitRoom(room); }
  });

  socket.on('host:kick', msg => {
    const room = hostRoom(); if (!room || room.state !== 'lobby') return;
    const p = room.players.get(msg && msg.id);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('p:kicked');
    room.players.delete(p.id);
    emitRoom(room);
  });

  // ----- phone -----
  socket.on('player:join', (msg, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const code = String((msg && msg.code) || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return reply({ ok: false, error: 'Room not found. Check the code on the screen.' });
    const name = cleanName(msg.name);
    const token = msg.token ? String(msg.token).slice(0, 40) : null;
    let p = token ? [...room.players.values()].find(x => x.token === token) : null;
    if (!p && name) {
      // lost storage / new browser: reclaim a disconnected player with the same name
      p = [...room.players.values()].find(x => !x.connected && x.name.toLowerCase() === name.toLowerCase());
    }
    if (!p) {
      if (!name) return reply({ ok: false, error: 'Write your name.' });
      if (room.state !== 'lobby' && room.state !== 'finished') return reply({ ok: false, error: 'The race already started. Wait for the next one!' });
      if (room.players.size >= MAX_PLAYERS) return reply({ ok: false, error: 'The grid is full (6 drivers).' });
      if ([...room.players.values()].some(x => x.name.toLowerCase() === name.toLowerCase())) return reply({ ok: false, error: 'That name is taken. Try another one.' });
      p = newPlayer(room, name, token);
    }
    // kick older socket of the same player
    if (p.socketId && p.socketId !== socket.id) {
      const old = io.sockets.sockets.get(p.socketId);
      if (old) { old.emit('p:replaced'); old.data.player = null; }
    }
    p.socketId = socket.id; p.connected = true; p.lastSeen = now();
    socket.data.room = room.code; socket.data.player = p.id;
    room.lastActivity = now();
    reply({ ok: true, state: phoneState(room, p) });
    emitRoom(room);
  });

  function me() {
    const room = rooms.get(socket.data.room);
    if (!room) return [];
    const p = room.players.get(socket.data.player);
    if (!p || p.socketId !== socket.id) return [];
    p.lastSeen = now(); room.lastActivity = p.lastSeen;
    return [room, p];
  }

  socket.on('player:car', (msg, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const [room, p] = me(); if (!room) return reply({ ok: false, error: 'Not connected' });
    if (room.state !== 'lobby' && room.state !== 'finished') return reply({ ok: false, error: 'Race in progress' });
    const car = msg && msg.car;
    if (!CAR_IDS.has(car)) return reply({ ok: false });
    const owner = [...room.players.values()].find(o => o.car === car && o !== p);
    if (owner) return reply({ ok: false, error: owner.name + ' already chose that car.' });
    p.car = car;
    reply({ ok: true });
    emitRoom(room);
  });

  socket.on('player:answer', (msg, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const [room, p] = me(); if (!room) return reply({ error: 'not-connected' });
    reply(handleAnswer(room, p, msg && msg.seq, msg && msg.choice));
  });

  socket.on('player:power', (msg, ack) => {
    const reply = typeof ack === 'function' ? ack : () => {};
    const [room, p] = me(); if (!room) return reply({ error: 'not-connected' });
    reply(usePower(room, p, msg && msg.type));
  });

  socket.on('player:sync', (msg, ack) => {
    const [room, p] = me();
    if (typeof ack === 'function') ack(room ? phoneState(room, p) : null);
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    if (socket.data.host && room.hostSocket === socket.id) room.hostSocket = null;
    const p = socket.data.player && room.players.get(socket.data.player);
    if (p && p.socketId === socket.id) {
      p.connected = false; p.socketId = null; p.lastSeen = now();
      emitRoom(room);
    }
  });
});

// ---------- loops ----------
setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    try { tickRoom(room, t); } catch (e) { console.error('tick error', room.code, e); }
  }
}, TICK_MS);

setInterval(() => {
  const t = now();
  for (const [code, room] of rooms) {
    const idle = t - room.lastActivity;
    const anyone = room.hostSocket || [...room.players.values()].some(p => p.connected);
    if ((!anyone && idle > (room.reviews ? 3 * 3600000 : 30 * 60000)) || idle > 6 * 3600000) rooms.delete(code);
  }
}, 60000);

server.listen(PORT, () => console.log('Phrasal Verbs Grand Prix on :' + PORT));
