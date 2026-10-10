// Procedural music + SFX with WebAudio (no audio files → nothing for the proxy to block)
let ctx = null, master, musicBus, sfxBus, noiseBuf, song = null, nextT = 0, step = 0, timer = null, muted = false;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(master);
  musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(comp);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 0.7; sfxBus.connect(comp);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  timer = setInterval(schedule, 25);
}
export function setMuted(m) { muted = m; if (master) master.gain.setTargetAtTime(m ? 0 : 0.9, ctx.currentTime, 0.05); for (const k in fileEls) fileEls[k].muted = m; for (const k in voiceEls) voiceEls[k].muted = m; }

// ---- recorded music & voice lines (served by our own server: proxy-safe) ----
const FILE_SONGS = { lobby: { src: 'assets/audio/lobby.mp3', vol: 0.55 }, race: { src: 'assets/audio/race.mp3', vol: 0.42 } };
const VOICES = { choose: 'assets/audio/choose-your-car.mp3', ready: 'assets/audio/get-ready.mp3' };
const fileEls = {}, voiceEls = {};
let fileSong = null, duck = 1;
function fileEl(name) {
  if (!fileEls[name]) { const a = new Audio(FILE_SONGS[name].src); a.loop = true; a.preload = 'auto'; a.volume = 0; a.muted = muted; fileEls[name] = a; }
  return fileEls[name];
}
export function preloadAudio() { for (const k in FILE_SONGS) fileEl(k); for (const k in VOICES) voiceEl(k); }
function voiceEl(name) { if (!voiceEls[name]) { const a = new Audio(VOICES[name]); a.preload = 'auto'; a.muted = muted; voiceEls[name] = a; } return voiceEls[name]; }
function fadeTo(a, target, ms = 600) {
  clearInterval(a._fade);
  const start = a.volume, t0 = performance.now();
  a._fade = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    a.volume = Math.max(0, Math.min(1, start + (target - start) * k));
    if (k >= 1) { clearInterval(a._fade); if (target === 0) a.pause(); }
  }, 40);
}
export function setDuck(v) { duck = v; applyDuck(); if (musicBus && ctx && song) musicBus.gain.setTargetAtTime((song === SONGS.race ? 0.22 : 0.32) * v, ctx.currentTime, 0.1); }
function applyDuck() { if (fileSong) fadeTo(fileEl(fileSong), FILE_SONGS[fileSong].vol * duck, 250); }
export function playVoice(name, delayMs = 0) {
  if (!ctx) return;
  const a = voiceEl(name);
  setTimeout(() => {
    try { a.currentTime = 0; } catch (e) { }
    duck = 0.35; applyDuck();
    a.onended = () => { duck = 1; applyDuck(); };
    a.play().catch(() => { duck = 1; applyDuck(); });
  }, Math.max(0, delayMs));
}
export function isMuted() { return muted; }

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function env(g, t, a, peak, dcy, sus = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + dcy);
}
function osc(type, freq, t, dur, vol, bus, opts = {}) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(opts.slide, t + dur);
  if (opts.detune) o.detune.value = opts.detune;
  let node = o;
  if (opts.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(opts.lp, t); if (opts.lpEnd) f.frequency.exponentialRampToValueAtTime(opts.lpEnd, t + dur); f.Q.value = opts.q || 1; o.connect(f); node = f; }
  node.connect(g); g.connect(bus || sfxBus);
  env(g, t, opts.a || 0.005, vol, dur);
  o.start(t); o.stop(t + dur + 0.05);
}
function noise(t, dur, vol, type, freq, bus, q = 1) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain(); s.connect(f); f.connect(g); g.connect(bus || sfxBus);
  env(g, t, 0.002, vol, dur);
  s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
// drum voices
const kick = (t, b) => osc('sine', 150, t, 0.28, 0.9, b, { slide: 42 });
const snare = (t, b) => { noise(t, 0.16, 0.35, 'bandpass', 1800, b, 0.8); osc('triangle', 210, t, 0.08, 0.25, b, { slide: 120 }); };
const hat = (t, b, o) => noise(t, o ? 0.12 : 0.03, o ? 0.12 : 0.08, 'highpass', 8000, b);
const bass = (t, m, d, b) => { osc('sawtooth', mtof(m), t, d, 0.28, b, { lp: 900, lpEnd: 200, q: 6 }); osc('square', mtof(m - 12), t, d, 0.12, b, { lp: 400 }); };
const lead = (t, m, d, b, v = 0.09) => { osc('square', mtof(m), t, d, v, b, { lp: 3200, a: 0.01 }); osc('sawtooth', mtof(m), t, d, v * 0.6, b, { detune: 9, lp: 2600 }); };
const pad = (t, ms, d, b, v = 0.035) => ms.forEach(m => { osc('sawtooth', mtof(m), t, d, v, b, { lp: 1400, a: 0.25, detune: -7 }); osc('sawtooth', mtof(m), t, d, v, b, { lp: 1400, a: 0.25, detune: 7 }); });
const pluck = (t, m, b, v = 0.1) => osc('triangle', mtof(m), t, 0.25, v, b, { lp: 4000 });

// ---- songs (16th-note steps) ----
const SONGS = {
  lobby: {
    bpm: 108, bars: 4,
    play(t, s) {
      const bar = Math.floor(s / 16) % 4, i = s % 16;
      const roots = [57, 53, 48, 55]; const r = roots[bar];
      if (i % 8 === 0) kick(t, musicBus);
      if (i === 4 || i === 12) noise(t, 0.12, 0.18, 'bandpass', 2500, musicBus, 1.2);
      if (i % 2 === 1) hat(t, musicBus, i === 15);
      if ([0, 3, 6, 10, 12].includes(i)) bass(t, r - 12, 0.16, musicBus);
      if (i === 0) pad(t, [r, r + 4 - (bar === 0 ? 1 : 0), r + 7, r + 12], 1.9, musicBus);
      const arp = [0, 7, 12, 16, 12, 7, 19, 12];
      if (i % 2 === 0) pluck(t, r + 12 + arp[(i / 2) % 8] - (bar === 0 && arp[(i / 2) % 8] === 16 ? 1 : 0), musicBus, 0.06);
    }
  },
  race: {
    bpm: 128, bars: 8,
    play(t, s) {
      const bar = Math.floor(s / 16) % 8, i = s % 16;
      const prog = [45, 45, 41, 41, 48, 48, 43, 44]; const r = prog[bar];
      if (i % 4 === 0) kick(t, musicBus);
      if (i === 4 || i === 12) snare(t, musicBus);
      if (i % 2 === 1) hat(t, musicBus, i % 4 === 3);
      if (i % 2 === 0 || i === 7 || i === 15) bass(t, r - 12 + (i === 14 ? 12 : 0), 0.11, musicBus);
      if (i === 0 && bar % 2 === 0) pad(t, [r + 12, r + 15 + (r === 48 ? 1 : 0), r + 19], 3.6, musicBus, 0.022);
      const mel = [[69, 0, 72, 0, 74, 0, 76, 0, 74, 0, 72, 0, 69, 0, 67, 0], [69, 0, 0, 72, 0, 0, 76, 0, 79, 0, 76, 0, 74, 0, 72, 0]];
      if (bar >= 4) { const m = mel[bar % 2][i]; if (m) lead(t, m - (bar === 6 || bar === 7 ? 2 : 0), 0.13, musicBus, 0.05); }
    }
  },
  podium: {
    bpm: 120, bars: 4,
    play(t, s) {
      const bar = Math.floor(s / 16) % 4, i = s % 16;
      const prog = [48, 53, 55, 48]; const r = prog[bar];
      if (i % 4 === 0) kick(t, musicBus);
      if (i === 4 || i === 12) snare(t, musicBus);
      if (i % 2 === 1) hat(t, musicBus);
      if (i % 4 === 0 || i === 6 || i === 14) bass(t, r - 12, 0.18, musicBus);
      if (i === 0) pad(t, [r + 12, r + 16, r + 19, r + 24], 1.9, musicBus, 0.03);
      const fan = [[72, 0, 0, 72, 76, 0, 79, 0, 84, 0, 0, 0, 79, 0, 84, 0], [77, 0, 0, 77, 81, 0, 84, 0, 89, 0, 0, 0, 84, 0, 81, 0], [79, 0, 0, 79, 83, 0, 86, 0, 91, 0, 0, 0, 86, 0, 83, 0], [84, 0, 0, 0, 79, 0, 76, 0, 84, 0, 0, 0, 0, 0, 0, 0]];
      const m = fan[bar][i]; if (m) { lead(t, m, 0.22, musicBus, 0.08); osc('sawtooth', mtof(m - 12), t, 0.25, 0.05, musicBus, { lp: 2000 }); }
    }
  }
};

function schedule() {
  if (!ctx || !song) return;
  const spb = 60 / song.bpm / 4;
  while (nextT < ctx.currentTime + 0.12) {
    song.play(nextT, step);
    step++; nextT += spb;
  }
}
export function playSong(name) {
  if (!ctx) return;
  // recorded tracks for lobby / race
  if (fileSong && fileSong !== name) { fadeTo(fileEl(fileSong), 0, 700); fileSong = null; }
  if (FILE_SONGS[name]) {
    if (song) { song = null; }
    if (fileSong !== name) {
      fileSong = name;
      const a = fileEl(name);
      if (name === 'race') { try { a.currentTime = 0; } catch (e) { } }
      a.play().catch(() => {});
      fadeTo(a, FILE_SONGS[name].vol * duck, 900);
    }
    return;
  }
  const s = SONGS[name] || null;
  if (song === s) return;
  // quick fade swap
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
  setTimeout(() => {
    song = s; step = 0; nextT = ctx.currentTime + 0.05;
    musicBus.gain.setTargetAtTime(name === 'race' ? 0.22 : 0.32, ctx.currentTime, 0.2);
  }, 260);
}
export function stopSong() { song = null; }

// ---- SFX ----
export const sfx = {
  beep(hi) { if (!ctx) return; const t = ctx.currentTime; osc('square', hi ? 1320 : 660, t, hi ? 0.6 : 0.18, 0.22, sfxBus, { lp: 5000 }); },
  go() { if (!ctx) return; const t = ctx.currentTime; [0, 4, 7, 12].forEach((n, k) => lead(t + k * 0.05, 72 + n, 0.5, sfxBus, 0.1)); noise(t, 1.4, 0.25, 'lowpass', 900, sfxBus); },
  lap() { if (!ctx) return; const t = ctx.currentTime; pluck(t, 84, sfxBus, 0.12); pluck(t + 0.08, 88, sfxBus, 0.12); },
  fastest() { if (!ctx) return; const t = ctx.currentTime; [76, 79, 83, 88].forEach((m, k) => osc('sine', mtof(m), t + k * 0.07, 0.35, 0.16, sfxBus)); },
  ok() { if (!ctx) return; const t = ctx.currentTime; osc('sine', 1046, t, 0.08, 0.05, sfxBus); },
  whoosh() { if (!ctx) return; const t = ctx.currentTime; const s = ctx.createBufferSource(); s.buffer = noiseBuf; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 2; f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(4000, t + 0.5); const g = ctx.createGain(); env(g, t, 0.05, 0.4, 0.6); s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + 0.8); },
  boom() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.9, 0.7, 'lowpass', 600, sfxBus); osc('sine', 110, t, 0.6, 0.6, sfxBus, { slide: 30 }); },
  shrink() { if (!ctx) return; const t = ctx.currentTime; osc('square', 900, t, 0.5, 0.12, sfxBus, { slide: 120, lp: 3000 }); osc('sine', 1400, t + 0.1, 0.4, 0.08, sfxBus, { slide: 200 }); },
  shield() { if (!ctx) return; const t = ctx.currentTime; [0, 5, 9, 12].forEach((n, k) => osc('triangle', mtof(79 + n), t + k * 0.04, 0.6, 0.08, sfxBus)); },
  oil() { if (!ctx) return; const t = ctx.currentTime; noise(t, 0.35, 0.4, 'lowpass', 500, sfxBus); osc('sine', 200, t, 0.3, 0.3, sfxBus, { slide: 60 }); },
  streak() { if (!ctx) return; const t = ctx.currentTime; [72, 76, 79, 84, 88].forEach((m, k) => pluck(t + k * 0.05, m, sfxBus, 0.12)); },
  horn() { if (!ctx) return; const t = ctx.currentTime; [60, 64, 67].forEach(m => osc('sawtooth', mtof(m), t, 1.2, 0.07, sfxBus, { lp: 1800, a: 0.04 })); },
  cheer(dur = 3) {
    if (!ctx) return; const t = ctx.currentTime;
    for (let k = 0; k < 6; k++) { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 700 + k * 260; f.Q.value = 1.4; const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.09, t + 0.3); g.gain.setValueAtTime(0.09, t + dur * 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); const lfo = ctx.createOscillator(); lfo.frequency.value = 3 + k * 1.3; const lg = ctx.createGain(); lg.gain.value = 0.04; lfo.connect(lg); lg.connect(g.gain); s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur); lfo.start(t); lfo.stop(t + dur); }
  },
  firework() {
    if (!ctx) return; const t = ctx.currentTime + Math.random() * 0.05;
    osc('sine', 300, t, 0.5, 0.06, sfxBus, { slide: 1200 });
    noise(t + 0.45, 0.5, 0.45, 'lowpass', 1200, sfxBus);
    for (let k = 0; k < 10; k++) noise(t + 0.6 + Math.random() * 0.9, 0.03, 0.08, 'highpass', 5000, sfxBus);
  },
  trophy() { if (!ctx) return; const t = ctx.currentTime; [0, 4, 7, 11, 14, 19, 24].forEach((n, k) => osc('sine', mtof(72 + n), t + k * 0.09, 1.6, 0.06, sfxBus, { a: 0.02 })); },
  click() { if (!ctx) return; const t = ctx.currentTime; osc('square', 1800, t, 0.03, 0.05, sfxBus, { lp: 4000 }); },
  join() { if (!ctx) return; const t = ctx.currentTime; pluck(t, 76, sfxBus, 0.12); pluck(t + 0.09, 83, sfxBus, 0.12); pluck(t + 0.18, 88, sfxBus, 0.1); },
};
