// Phrasal GP — projector / host screen
import * as THREE from 'three';
import { CIRCUITS, buildTrack } from '../track.js';
import { RaceView } from './race.js';
import { LobbyView } from './lobby.js';
import { PodiumView, fmtTime } from './podium.js';
import * as C from './commentator.js';
import { initAudio, playSong, sfx, setMuted, isMuted, playVoice, preloadAudio } from './audio.js';

const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
let pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(pixelRatio);
let W = innerWidth, H = innerHeight;

// ---------- state ----------
let room = null, offset = 0, view = null;
let lobbyView = null, raceView = null, podiumView = null, raceKey = null, raceBuilding = null;
let readyPlayed = false, lastRecords = null;
let lastStand = null, lightsShown = 0, greenShown = false, flagShown = false, podiumTimer = null, lastResults = null;
const playersById = () => Object.fromEntries((room ? room.players : []).map(p => [p.id, p]));
const serverNow = () => Date.now() + offset;

// ---------- socket (polling first: works through strict proxies) ----------
const socket = io({ transports: ['polling', 'websocket'], tryAllTransports: true, reconnectionDelay: 800, reconnectionDelayMax: 4000, timeout: 15000 });
socket.on('connect', () => {
  $('net').classList.add('hidden');
  const saved = store.get('pgp_host');
  const urlCode = new URLSearchParams(location.search).get('room');
  const code = urlCode || (saved && saved.code);
  if (saved && code) {
    socket.emit('host:resume', { code, hostToken: saved.hostToken }, res => { if (!res || !res.ok) createRoom(saved.hostToken); else remember(res); });
  } else createRoom();
});
socket.on('disconnect', () => $('net').classList.remove('hidden'));
socket.on('connect_error', () => $('net').classList.remove('hidden'));
function createRoom(hostToken) { socket.emit('host:create', { hostToken }, res => remember(res)); }
function remember(res) {
  if (!res || !res.ok) return;
  store.set('pgp_host', { code: res.code, hostToken: res.hostToken });
  const u = new URL(location.href); u.searchParams.set('host', '1'); u.searchParams.set('room', res.code);
  history.replaceState(null, '', u.toString());
}

socket.on('room:state', onState);
socket.on('race:tick', m => { offset = offset * 0.9 + (m.t - Date.now()) * 0.1; if (raceView) raceView.onTick(m); });
socket.on('race:standings', onStandings);
socket.on('race:event', onEvent);
socket.on('race:records', recs => { lastRecords = recs; showRecords(); });

// ---------- QR ----------
let qrFor = null;
function renderQR(code) {
  if (qrFor === code) return; qrFor = code;
  const url = location.origin + '/?r=' + code;
  $('joinUrl').textContent = url.replace(/^https?:\/\//, '');
  $('roomCode').textContent = code; $('roomCode2').textContent = code;
  document.title = 'Phrasal GP · ' + code;
  try {
    const q = qrcode(0, 'M'); q.addData(url); q.make();
    const src = q.createDataURL(8, 2);
    $('qrBig').innerHTML = '<img alt="QR" src="' + src + '">';
    $('qrSmall').innerHTML = '<img alt="QR" src="' + src + '">';
  } catch (e) { console.warn(e); }
}

// ---------- state machine ----------
function onState(st) {
  const prev = room;
  room = st;
  offset = st.serverNow - Date.now();
  renderQR(st.code);
  if (st.state === 'lobby') enterLobby(st, prev);
  else if (st.state === 'countdown' || st.state === 'race') enterRace(st);
  else if (st.state === 'finished') {
    lastResults = st.results;
    if (view === 'race') finishSequence(st.results);
    else if (view !== 'podium' && view !== 'report') enterPodium(st.results);
  }
}

function showLayer(id) {
  for (const l of ['lobby', 'hud', 'podium']) $(l).classList.toggle('hidden', l !== id);
  $('report').classList.add('hidden');
}

// ----- lobby -----
async function enterLobby(st, prev) {
  if (view !== 'lobby') {
    view = 'lobby';
    showLayer('lobby');
    disposeRace(); disposePodium();
    if (!lobbyView) { lobbyView = new LobbyView(renderer, $('lobbyPlates')); }
    $('lobbyPlates').classList.remove('hidden');
    resize();
    playSong('lobby');
  }
  buildSetup(st);
  const cName = (CIRCUITS.find(c => c.id === st.settings.circuitId) || CIRCUITS[0]).name;
  lobbyView.setTitle(cName);
  if (prev && prev.players && st.players.length > prev.players.length) {
    sfx.join();
    if (Date.now() - (enterLobby.lastVoice || 0) > 6000) { enterLobby.lastVoice = Date.now(); playVoice('choose', 350); }
    const nw = st.players.filter(p => !prev.players.some(q => q.id === p.id));
    nw.forEach((p, i) => setTimeout(() => C.say(C.L.welcome, { name: p.name }, 2), 2300 + i * 1500));
  }
  await lobbyView.setPlayers(st.players, st.cars);
  // kick buttons
  lobbyView.slots.forEach(s => {
    let k = s.plate.querySelector('.kick');
    if (!k) { k = document.createElement('button'); k.className = 'kick'; k.textContent = '×'; k.title = 'Remove driver'; s.plate.appendChild(k); k.onclick = () => { if (s.plate.dataset.id) socket.emit('host:kick', { id: s.plate.dataset.id }); }; }
  });
  const n = st.players.length;
  $('startBtn').disabled = n < 1;
  $('startHint').textContent = n < 1 ? 'WAITING FOR DRIVERS' : n + ' DRIVER' + (n > 1 ? 'S' : '') + ' ON THE GRID';
}

let setupBuilt = false;
function buildSetup(st) {
  if (!setupBuilt) {
    setupBuilt = true;
    const cc = $('circuits');
    CIRCUITS.forEach(c => {
      const b = document.createElement('button'); b.className = 'ccard'; b.dataset.id = c.id;
      b.innerHTML = miniMap(c) + '<b></b>'; b.querySelector('b').textContent = c.short;
      b.title = c.name + ' — ' + c.blurb;
      b.onclick = () => { sfx.click(); socket.emit('host:settings', { circuitId: c.id, circuitName: c.name }); };
      cc.appendChild(b);
    });
    st.levels.forEach(l => { const b = document.createElement('button'); b.className = 'chip'; b.dataset.v = l; b.textContent = l === 'MIX' ? 'MIX' : l; b.title = l === 'MIX' ? 'A2 → C1 mixed' : 'Level ' + l; b.onclick = () => { sfx.click(); socket.emit('host:settings', { level: l }); }; $('levels').appendChild(b); });
    st.laps.forEach(l => { const b = document.createElement('button'); b.className = 'chip'; b.dataset.v = l; b.textContent = l; b.onclick = () => { sfx.click(); socket.emit('host:settings', { laps: l }); }; $('laps').appendChild(b); });
    $('startBtn').onclick = () => { initAudio(); socket.emit('host:start'); };
    // make sure the server knows the default circuit name
    if (!CIRCUITS.find(c => c.id === st.settings.circuitId)) socket.emit('host:settings', { circuitId: CIRCUITS[0].id, circuitName: CIRCUITS[0].name });
  }
  for (const b of $('circuits').children) b.classList.toggle('on', b.dataset.id === st.settings.circuitId);
  for (const b of $('levels').children) b.classList.toggle('on', b.dataset.v === st.settings.level);
  for (const b of $('laps').children) b.classList.toggle('on', +b.dataset.v === st.settings.laps);
}

function miniMap(c) {
  const t = buildTrack(c.cmds), b = t.bounds;
  const d = t.pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' ') + 'Z';
  return '<svg viewBox="' + (b.minX - 0.3) + ' ' + (b.minZ - 0.3) + ' ' + (b.maxX - b.minX + 0.6) + ' ' + (b.maxZ - b.minZ + 0.6) + '" preserveAspectRatio="xMidYMid meet"><path d="' + d + '" fill="none" stroke="#fff" stroke-width="0.32" stroke-linejoin="round"/><circle cx="2.5" cy="0" r="0.35" fill="#e10600"/></svg>';
}

// ----- race -----
async function enterRace(st) {
  const key = st.raceNo + ':' + st.settings.circuitId;
  if (view !== 'race' || raceKey !== key) {
    view = 'race';
    showLayer('hud');
    $('lobbyPlates').classList.add('hidden');
    disposePodium(); disposeRace();
    raceKey = key; lastStand = null; lightsShown = 0; readyPlayed = false; lastRecords = null; Object.assign(com, { green: Date.now() + 8000, leader: null, finalLap: false, pos: {}, lastFill: Date.now() }); C.stop(); greenShown = st.state === 'race' && serverNow() - st.race.greenAt > 3000; flagShown = !!st.race.flagAt;
    $('flag').classList.add('hidden'); $('feed').innerHTML = ''; $('towerRows').innerHTML = ''; towerEls.clear();
    const circuit = CIRCUITS.find(c => c.id === st.settings.circuitId) || CIRCUITS[0];
    $('gpName').textContent = circuit.name; $('gpLevel').textContent = (st.settings.level === 'MIX' ? 'LEVEL A2–C1' : 'LEVEL ' + st.settings.level) + ' · PHRASAL VERBS';
    $('lapOf').textContent = st.race.laps; $('tLaps').textContent = st.race.laps;
    const rv = new RaceView(renderer, circuit, $('plates'));
    raceBuilding = rv.build().then(() => rv.setCars(st.players, st.race.grid)).then(() => { raceView = rv; resize(); });
    await raceBuilding;
    if (st.state === 'countdown') playSong(null); else playSong('race');
    if (lastStand) onStandings(lastStand);
  } else {
    if (raceBuilding) await raceBuilding;
    if (raceView) await raceView.setCars(st.players, st.race.grid);
  }
  if (st.state === 'race' && !greenShown) goGreen();
}

function goGreen() {
  greenShown = true;
  $('lights').classList.remove('hidden'); $('lights').classList.add('go');
  if (raceView) raceView.setStartLights(5, true);
  banner('LIGHTS OUT', 'AND AWAY WE GO!');
  com.green = Date.now();
  setTimeout(() => C.say(C.L.start, { gp: $('gpName').textContent }, 3), 1300);
  sfx.go();
  playSong('race');
  setTimeout(() => { $('lights').classList.add('hidden'); $('lights').classList.remove('go'); if (raceView) raceView.setStartLights(0); }, 1600);
}

function countdownTick() {
  if (view !== 'race' || !room || room.state !== 'countdown' || !room.race) return;
  const ms = room.race.greenAt - serverNow();
  const n = Math.max(0, Math.min(5, 5 - Math.ceil((ms - 1000) / 1000) ));
  // "GET READY… 3, 2, 1, GO!" — the GO in the clip starts 3.85 s in, timed to lights out
  if (!readyPlayed && ms < 4600 && ms > 2000) { readyPlayed = true; playVoice('ready', ms - 3850); }
  const lights = $('lights');
  if (ms < 6200) lights.classList.remove('hidden');
  if (n !== lightsShown) {
    lightsShown = n;
    lights.querySelectorAll('.col').forEach((c, i) => c.querySelectorAll('i').forEach(x => x.classList.toggle('on', i < n)));
    if (raceView) raceView.setStartLights(n);

  }
}

function banner(big, small) {
  const b = $('banner');
  b.innerHTML = ''; b.classList.remove('show'); void b.offsetWidth;
  b.textContent = big; if (small) { const s = document.createElement('small'); s.textContent = small; b.appendChild(s); }
  b.classList.add('show');
  clearTimeout(banner.t); banner.t = setTimeout(() => { b.classList.remove('show'); b.innerHTML = ''; }, 2700);
}

// timing tower
const towerEls = new Map();
let rowH = 0;
function onStandings(st) {
  lastStand = st;
  if (view !== 'race') return;
  $('lapN').textContent = Math.min(st.leaderLap, st.laps); $('tLap').textContent = Math.min(st.leaderLap, st.laps);
  const rowsEl = $('towerRows');
  const keep = new Set();
  st.rows.forEach((r, i) => {
    keep.add(r.id);
    let el = towerEls.get(r.id);
    if (!el) {
      el = document.createElement('div'); el.className = 'trow';
      el.innerHTML = '<div class="p"></div><div class="bar"></div><img class="th" alt=""><div class="nm"><span class="t"></span><span class="fx"></span></div><div class="gap"></div><div class="sec"><i></i><i></i><i></i></div>';
      rowsEl.appendChild(el); towerEls.set(r.id, el);
    }
    el.style.setProperty('--team', r.color);
    el.querySelector('.p').textContent = r.pos;
    el.querySelector('.th').src = 'assets/thumbs/' + r.car + '.png';
    el.querySelector('.t').textContent = r.name;
    el.querySelector('.fx').textContent = r.finished ? ' 🏁' : r.power ? ' ⚡' : (r.flags & 32) ? ' 🛡️' : (r.flags & 4) ? ' 🚀' : '';
    const gap = el.querySelector('.gap');
    gap.textContent = r.gap; gap.classList.toggle('lead', i === 0);
    el.classList.toggle('first', i === 0);
    el.classList.toggle('off', !r.connected);
    el.classList.toggle('fin', r.finished);
    el.querySelectorAll('.sec i').forEach((s, k) => { s.className = r.sectorCol[k] || ''; });
    if (!rowH) rowH = el.offsetHeight || 46;
    el.style.transform = 'translateY(' + (i * rowH) + 'px)';
  });
  for (const [id, el] of towerEls) if (!keep.has(id)) { el.remove(); towerEls.delete(id); }
  rowsEl.style.height = (st.rows.length * rowH) + 'px';
  // fastest laps
  const pl = playersById();
  $('fastList').innerHTML = st.fastest.length ? st.fastest.slice(0, 6).map((f, i) => '<div class="prow' + (i === 0 ? ' best' : '') + '" style="--team:' + f.color + '"><span class="r">' + (i + 1) + '</span><span class="b"></span><span class="n">' + esc(f.name) + '</span><span class="v">' + fmtTime(f.t) + '</span></div>').join('') : '<div class="empty">No laps completed yet</div>';
  $('secList').innerHTML = st.sectors.map((s, i) => '<div class="prow secrow" style="--team:' + (s ? s.color : '#333') + '"><span class="s">S' + (i + 1) + '</span><span class="b"></span><span class="n">' + (s ? esc(s.name) : '—') + '</span><span class="v" style="color:var(--purple)">' + (s ? (s.t / 1000).toFixed(3) : '') + '</span></div>').join('');
  const pts = st.rows.slice().sort((a, b) => b.correct - a.correct || a.wrong - b.wrong);
  $('ptsList').innerHTML = pts.map((r, i) => { const tot = r.correct + r.wrong; return '<div class="prow" style="--team:' + r.color + '"><span class="r">' + (i + 1) + '</span><span class="b"></span><span class="n">' + esc(r.name) + (r.streak >= 3 ? ' 🔥' + r.streak : '') + '</span><span class="v ok">' + r.correct + '</span><span class="acc">' + (tot ? Math.round(r.correct / tot * 100) + '%' : '—') + '</span></div>'; }).join('');
  if (raceView) raceView.setPositions(st.rows);
  if (st.flag && !flagShown) showFlag(st.rows[0]);
  commentStandings(st);
}

// ---------- commentator triggers ----------
const com = { green: 0, leader: null, finalLap: false, pos: {}, lastFill: 0 };
function commentStandings(st) {
  if (!room || room.state !== 'race' || st.flag) { com.leader = st.rows[0] && st.rows[0].id; return; }
  const now = Date.now(), early = now - com.green < 6000;
  const lead = st.rows[0];
  if (lead && com.leader && lead.id !== com.leader && !early) C.say(C.L.lead, { name: lead.name }, 2, 'lead', 5000);
  com.leader = lead && lead.id;
  if (!com.finalLap && st.laps > 1 && st.leaderLap >= st.laps && lead) { com.finalLap = true; C.say(C.L.finalLap, { name: lead.name }, 2); }
  const p2 = st.rows[1];
  if (p2 && !early) { const g = parseFloat(String(p2.gap).replace('+', '')); if (!isNaN(g) && g < 0.4 && !/LAP/.test(p2.gap)) C.say(C.L.battle, { p1: lead.name, p2: p2.name }, 1, 'battle', 25000); }
  st.rows.forEach(r => { const before = com.pos[r.id]; if (!early && before && r.pos <= 3 && r.pos < before - 0 && r.pos > 1 && before - r.pos >= 1) C.say(C.L.midfield, { name: r.name, pos: r.pos }, 1, 'mid' + r.id, 15000); com.pos[r.id] = r.pos; });
  if (now - com.lastFill > 22000 && !early) {
    com.lastFill = now;
    const top = st.rows.slice().sort((a, b) => b.correct - a.correct)[0];
    if (top && top.correct >= 3) C.say(C.L.points, { name: top.name, n: top.correct }, 1);
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function feed(html, color, cls) {
  const f = $('feed');
  const d = document.createElement('div'); d.className = 'fmsg' + (cls ? ' ' + cls : '');
  if (color) d.style.setProperty('--team', color);
  d.innerHTML = '<span class="rc">RACE CONTROL</span>' + html;
  f.insertBefore(d, f.firstChild);
  while (f.children.length > 4) f.lastChild.remove();
  setTimeout(() => { d.classList.add('out'); setTimeout(() => d.remove(), 500); }, 5200);
}

const POWER_TXT = { turbo: 'TURBO 🚀', shrink: 'MINI-RAY ⚡', missile: 'MISSILE 🎯', shield: 'SHIELD 🛡️' };
function onEvent(ev) {
  if (view !== 'race' || !raceView) return;
  const pl = playersById();
  const p = pl[ev.id]; const name = p ? esc(p.name) : '?'; const col = p ? p.color : null;
  if (ev.type === 'answer') {
    raceView.answerPop(ev.id, ev.correct);
    if (ev.correct) sfx.ok();
    if (ev.power) { feed('<b>' + name + '</b> ' + (ev.catchup ? 'GETS A CATCH-UP POWER 🔋' : '3 IN A ROW! POWER-UP READY ⚡'), col); sfx.streak(); C.say(ev.catchup ? C.L.catchup : C.L.streak, { name: p ? p.name : '' }, 1, 'streak' + ev.id, 15000); }
  } else if (ev.type === 'lap') {
    if (ev.fastest) {
      feed('FASTEST LAP · <b>' + name + '</b> · ' + fmtTime(ev.time), col, 'purple'); sfx.fastest();
      if (ev.lap >= 2) C.say(C.L.fastest, { name: p ? p.name : '' }, 1, 'fastest', 12000);
      const el = towerEls.get(ev.id); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
    }
  } else if (ev.type === 'finish') {
    if (ev.pos === 1) showFlag({ name: p ? p.name : '?' });
    else { feed('<b>' + name + '</b> FINISHES P' + ev.pos, col); C.say(C.L.finish, { name: p ? p.name : '', pos: ev.pos }, 2); }
  } else if (ev.type === 'power') {
    raceView.powerFx(ev);
    { const nm = p ? p.name : ''; const tg = pl[ev.targets[0] || ev.blocked[0]];
      if (ev.power === 'missile') { C.say(C.L.missile, { name: nm, target: tg ? tg.name : 'the leader' }, 2); if (ev.blocked.length) C.say(C.L.blocked, { target: tg ? tg.name : '' }, 2); }
      else C.say(C.L[ev.power], { name: nm }, ev.power === 'shrink' ? 2 : 1); }
    if (ev.power === 'shrink') { const fl = $('flashscreen'); fl.style.opacity = '0.75'; setTimeout(() => fl.style.opacity = '0', 140); }
    let txt = '<b>' + name + '</b> USED ' + POWER_TXT[ev.power];
    if (ev.power === 'missile') { const t = pl[ev.targets[0] || ev.blocked[0]]; if (t) txt += ' ON <b>' + esc(t.name) + '</b>'; }
    if (ev.power === 'shrink') txt += ' ON EVERYONE!';
    if (ev.blocked && ev.blocked.length) txt += ' · BLOCKED BY SHIELD';
    feed(txt, col);
  }
}

function showFlag(row) {
  if (flagShown) return; flagShown = true;
  $('flagTxt').textContent = (row.name || '').toUpperCase() + ' WINS THE ' + ($('gpName').textContent || '').toUpperCase();
  $('flag').classList.remove('hidden');
  sfx.horn(); sfx.cheer(3);
  C.say(C.L.win, { name: row.name || '', gp: $('gpName').textContent }, 3);
  setTimeout(() => $('flag').classList.add('hidden'), 4000);
}

function finishSequence(results) {
  if (podiumTimer) return;
  showFlag(results.rows[0] || {});
  podiumTimer = setTimeout(() => { podiumTimer = null; enterPodium(results); }, 3800);
}

// ----- podium -----
async function enterPodium(results) {
  if (!results) return;
  view = 'podium';
  showLayer('podium');
  disposeRace();
  $('lobbyPlates').classList.add('hidden');
  const pv = new PodiumView(renderer, $('plates'));
  podiumView = pv;
  await pv.setup(results);
  resize();
  const w = results.rows[0];
  $('podGp').textContent = (results.circuit || '').toUpperCase() + ' · WINNER';
  $('podWinner').textContent = w ? w.name : '';
  if (w) setTimeout(() => { if (view === 'podium') C.say(C.L.podium, { name: w.name, gp: results.circuit || 'Grand Prix' }, 3); }, 7600);
  playSong('podium');
  sfx.cheer(3);
  showRecords();
}

// ---------- global leaderboard ----------
let lbFilter = { circuit: CIRCUITS[0].id, laps: 5 };
function showRecords() {
  const box = $('records'); if (!box) return;
  box.innerHTML = '';
  if (view !== 'podium' || !lastRecords || !lastRecords.length) return;
  const sorted = lastRecords.slice().sort((a, b) => a.rank - b.rank).slice(0, 5);
  sorted.forEach((r, i) => setTimeout(() => {
    const d = document.createElement('div'); d.className = 'rec';
    d.innerHTML = '<small>' + (r.rank === 1 ? (r.kind === 'race' ? 'NEW TRACK RECORD!' : 'NEW LAP RECORD!') : 'GLOBAL TOP 10 · ' + (r.kind === 'race' ? 'RACE' : 'LAP')) + '</small>#' + r.rank + ' ' + esc(r.name.toUpperCase()) + ' · ' + fmtTime(r.ms);
    box.appendChild(d); if (r.rank === 1) sfx.fastest(); else sfx.lap();
  }, 8000 + i * 700));
}
function openLeaderboard(circuit, laps) {
  if (circuit) lbFilter.circuit = circuit; if (laps) lbFilter.laps = laps;
  const cc = $('lbCircuits'), lc = $('lbLaps');
  if (!cc.children.length) {
    CIRCUITS.forEach(c => { const b = document.createElement('button'); b.className = 'chip'; b.dataset.v = c.id; b.textContent = c.short; b.onclick = () => { sfx.click(); openLeaderboard(c.id); }; cc.appendChild(b); });
    [5, 10, 20, 30].forEach(l => { const b = document.createElement('button'); b.className = 'chip'; b.dataset.v = l; b.textContent = l + ' LAPS'; b.onclick = () => { sfx.click(); openLeaderboard(null, l); }; lc.appendChild(b); });
  }
  for (const b of cc.children) b.classList.toggle('on', b.dataset.v === lbFilter.circuit);
  for (const b of lc.children) b.classList.toggle('on', +b.dataset.v === lbFilter.laps);
  const circ = CIRCUITS.find(c => c.id === lbFilter.circuit) || CIRCUITS[0];
  $('lbTitle').innerHTML = 'GLOBAL LEADERBOARD <span>' + esc(circ.name.toUpperCase()) + ' · ' + lbFilter.laps + ' LAPS</span>';
  $('lbSub1').textContent = circ.short; $('lbSub2').textContent = circ.short; $('lbSub3').textContent = 'ALL CIRCUITS · ' + lbFilter.laps + ' LAPS';
  const loading = '<div class="empty">Loading…</div>';
  $('lbRaces').innerHTML = $('lbLapsTop').innerHTML = $('lbAnswers').innerHTML = loading;
  $('lb').classList.remove('hidden');
  const want = lbFilter.circuit + ':' + lbFilter.laps;
  fetch('/api/leaderboard?circuit=' + lbFilter.circuit + '&laps=' + lbFilter.laps).then(r => r.json()).then(d => {
    if (want !== lbFilter.circuit + ':' + lbFilter.laps) return;
    if (!d.enabled) { $('lbRaces').innerHTML = $('lbLapsTop').innerHTML = $('lbAnswers').innerHTML = '<div class="empty">Leaderboard not configured on the server</div>'; return; }
    const mine = (name, ms) => lastResults && lastResults.rows.some(r => r.name === name && (r.time === ms || r.bestLap === ms || ms == null));
    const row = (i, x, val, isMine, extra) => '<div class="prow' + (i < 3 ? ' gold' : '') + (isMine ? ' me' : '') + '"><span class="r">' + (i + 1) + '</span><img src="assets/thumbs/' + esc(x.car) + '.png" alt=""><span class="n">' + esc(x.name) + ' <span class="lv">' + esc(x.level === 'MIX' ? 'A2–C1' : x.level) + '</span></span><span class="v">' + val + '</span>' + (extra || '') + '<span class="d">' + (x.created_at ? new Date(x.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '') + '</span></div>';
    const none = '<div class="empty">No results yet — be the first!</div>';
    $('lbRaces').innerHTML = d.races.length ? d.races.map((x, i) => row(i, x, fmtTime(x.race_ms), mine(x.name, x.race_ms))).join('') : none;
    $('lbLapsTop').innerHTML = d.laps_top.length ? d.laps_top.map((x, i) => row(i, x, fmtTime(x.best_lap_ms), mine(x.name, x.best_lap_ms))).join('') : none;
    $('lbAnswers').innerHTML = d.answers.length ? d.answers.map((x, i) => row(i, x, '✓ ' + x.correct, false, '<span class="acc">' + x.accuracy + '%</span>')).join('') : none;
  }).catch(() => { $('lbRaces').innerHTML = $('lbLapsTop').innerHTML = $('lbAnswers').innerHTML = '<div class="empty">Leaderboard unavailable right now</div>'; });
}
function renderComBtn() { const b = $('comBtn'); if (!b) return; b.textContent = C.isCommentaryOn() ? '🎙 COMMENTATOR: ON' : '🎙 COMMENTATOR: OFF'; b.title = C.voiceName() ? 'Voice: ' + C.voiceName() : 'No English voice found in this browser'; b.classList.toggle('off', !C.isCommentaryOn()); }
if ($('comBtn')) { $('comBtn').onclick = () => { C.setCommentary(!C.isCommentaryOn()); renderComBtn(); if (C.isCommentaryOn()) C.say('Good afternoon, and welcome to Phrasal G P!', {}, 3); }; setTimeout(renderComBtn, 500); if (window.speechSynthesis) window.speechSynthesis.addEventListener && window.speechSynthesis.addEventListener('voiceschanged', renderComBtn); }
$('lbLobbyBtn').onclick = () => { sfx.click(); openLeaderboard(room ? room.settings.circuitId : null, room ? room.settings.laps : null); };
$('lbPodBtn').onclick = () => { sfx.click(); openLeaderboard(lastResults ? lastResults.circuitId : null, lastResults ? lastResults.laps : null); };
$('lbClose').onclick = () => $('lb').classList.add('hidden');

$('reportBtn').onclick = () => { sfx.click(); showReport(lastResults); };
$('repBack').onclick = () => { $('report').classList.add('hidden'); };
$('againBtn').onclick = $('repAgain').onclick = () => { sfx.click(); socket.emit('host:lobby'); };
$('endBtn').onclick = () => { if ($('endBtn').dataset.armed) { socket.emit('host:abort'); } else { $('endBtn').dataset.armed = '1'; $('endBtn').textContent = 'CLICK AGAIN TO END'; setTimeout(() => { delete $('endBtn').dataset.armed; $('endBtn').textContent = 'END RACE'; }, 3000); } };

function showReport(res) {
  if (!res) return;
  $('repTitle').innerHTML = esc(res.circuit || 'RACE') + ' REPORT <span>LEVEL ' + esc(res.level === 'MIX' ? 'A2–C1' : res.level) + ' · ' + res.laps + ' LAPS · PASS MARK 80%</span>';
  $('repGrid').innerHTML = res.rows.map(r => {
    const f = r.feedback, tot = r.correct + r.wrong;
    const rc = tot === 0 ? '#6b7088' : f.pass ? '#00d26a' : f.acc >= 60 ? '#ffb020' : '#ff4d5e';
    return '<div class="rcard" style="--team:' + r.color + ';--rc:' + rc + '">' +
      '<div class="top"><span class="pos">P' + r.pos + '</span><span class="nm">' + esc(r.name) + '</span><img src="assets/thumbs/' + r.car + '.png" alt=""></div>' +
      '<div class="ring" style="--pct:' + f.acc + '"><b>' + f.acc + '%</b><small>' + (tot === 0 ? 'NO DATA' : f.pass ? 'PASS' : 'BELOW 80%') + '</small></div>' +
      '<div class="stats">✓ <b>' + r.correct + '</b> correct · ✗ <b>' + r.wrong + '</b> wrong<br>Best streak <b>' + r.bestStreak + '</b><br>' + (r.finished ? 'Time <b>' + fmtTime(r.time) + '</b>' : 'Laps <b>' + r.lapsDone + '</b>') + ' · Best lap <b>' + fmtTime(r.bestLap) + '</b></div>' +
      '<div class="head">' + esc(f.headline) + '</div>' +
      (f.notes.length ? '<div class="notes">' + f.notes.map(esc).join(' ') + '</div>' : '') +
      ((f.strengths.length || f.review.length) ? '<div class="tags">' + f.strengths.map(s => '<span class="tag g">' + esc(s) + ' ✓</span>').join('') + f.review.map(s => '<span class="tag r">' + esc(s) + ' ↺</span>').join('') + '</div>' : '') +
      (f.missed.length ? '<div class="missed">' + f.missed.map(m => '<div><b>' + esc(m.answer.replace(/\s*\/\s*/g, ' … ')) + '</b> — ' + esc(m.meaning.split('=').slice(1).join('=').trim() || m.meaning) + '</div>').join('') + '</div>' : '') +
      '</div>';
  }).join('');
  $('report').classList.remove('hidden');
}

function disposeRace() {
  if (raceView) { raceView.dispose(); raceView = null; }
  raceKey = null; raceBuilding = null;
  $('plates').innerHTML = '';
  towerEls.clear();
  if (podiumTimer) { clearTimeout(podiumTimer); podiumTimer = null; }
}
function disposePodium() { if (podiumView) { podiumView.dispose(); podiumView = null; } $('plates').innerHTML = ''; }

// ---------- loop ----------
function insets() {
  const t = $('tower').getBoundingClientRect(), s = $('side').getBoundingClientRect(), tb = document.querySelector('#hud .topbar').getBoundingClientRect();
  return { l: t.right + 12, r: W - s.left + 12, t: tb.bottom + 12, b: 70 };
}
function resize() {
  W = innerWidth; H = innerHeight;
  renderer.setSize(W, H, false);
  if (lobbyView) lobbyView.fit(W, H);
  if (raceView && view === 'race') raceView.fit(W, H, insets());
  if (podiumView) podiumView.fit(W, H);
}
addEventListener('resize', resize);

let last = performance.now(), fpsAcc = 0, fpsN = 0, fpsT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  let v = null;
  if (view === 'lobby') v = lobbyView;
  else if (view === 'race') v = raceView;
  else if (view === 'podium') v = podiumView;
  countdownTick();
  if (view === 'race' && room && room.race) {
    const r = room.race;
    let el = 0;
    if (room.state === 'race') el = serverNow() - r.greenAt;
    if (lastStand && lastStand.flag && lastStand.rows[0] && lastStand.rows[0].finished) el = Math.min(el, (lastStand.el || el));
    $('clock').textContent = fmtClock(Math.max(0, el));
  }
  if (v) {
    v.update(dt, room && room.state === 'race');
    renderer.render(v.scene, v.cam);
    v.updatePlates(W, H);
  }
  // adaptive quality for modest classroom PCs
  fpsAcc += dt; fpsN++; fpsT += dt;
  if (fpsT > 3) {
    const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; fpsT = 0;
    if (fps < 34 && pixelRatio > 0.75) { pixelRatio = Math.max(0.75, pixelRatio - 0.25); renderer.setPixelRatio(pixelRatio); resize(); }
    else if (fps < 30 && renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; scenesNeedUpdate(); }
  }
}
function scenesNeedUpdate() { for (const v of [lobbyView, raceView, podiumView]) if (v) v.scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => m.needsUpdate = true); }); }
function fmtClock(ms) { const s = ms / 1000; return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') + '.' + Math.floor((ms % 1000) / 100); }
requestAnimationFrame(frame);
resize();

// ---------- audio / keys ----------
function enableSound() {
  initAudio(); preloadAudio();
  $('tapsound').classList.add('hidden');
  if (view === 'lobby') playSong('lobby'); else if (view === 'race' && room && room.state === 'race') playSong('race'); else if (view === 'podium') playSong('podium');
}
$('tapsound').onclick = e => { e.stopPropagation(); enableSound(); };
addEventListener('pointerdown', () => { if (!$('tapsound').classList.contains('hidden')) enableSound(); }, true);
addEventListener('keydown', e => {
  if (e.key === 'm' || e.key === 'M') { setMuted(!isMuted()); if (isMuted()) C.stop(); }
  if (e.key === 'c' || e.key === 'C') { C.setCommentary(!C.isCommentaryOn()); renderComBtn(); }
  if (e.key === 'f' || e.key === 'F') { if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen().catch(() => {}); else document.exitFullscreen(); }
});
// demo podium (for testing the ceremony without racing): /?host=1&demo=podium
if (new URLSearchParams(location.search).get('demo') === 'podium') {
  const fb = { acc: 85, pass: true, headline: 'Solid result — you passed the 80% mark.', notes: [], strengths: ['UP'], review: ['OFF'], missed: [] };
  lastResults = { circuit: 'Boston Grand Prix', level: 'B1', laps: 5, rows: [
    { pos: 1, id: 'a', name: 'Sofía', color: '#27f4d2', car: 'race', finished: true, time: 151234, gap: 'WINNER', bestLap: 28123, lapsDone: 5, correct: 30, wrong: 3, bestStreak: 12, feedback: fb },
    { pos: 2, id: 'b', name: 'Mateo', color: '#3671c6', car: 'taxi', finished: true, time: 158000, gap: '+6.766', bestLap: 29000, lapsDone: 5, correct: 25, wrong: 6, bestStreak: 7, feedback: fb },
    { pos: 3, id: 'c', name: 'Valen', color: '#229971', car: 'kart-oozi', finished: true, time: 160000, gap: '+8.766', bestLap: 30000, lapsDone: 5, correct: 22, wrong: 8, bestStreak: 5, feedback: fb }] };
  setTimeout(() => { socket.disconnect(); enterPodium(lastResults); }, 300);
}
// expose for automated checks
window.__pgp = { get view() { return view; }, get room() { return room; }, get raceView() { return raceView; } };
