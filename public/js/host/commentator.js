// Race commentator using the browser's built-in voices (free). Prefers British voices.
// Best on Edge (Microsoft "Ryan"/"Sonia" Online Natural voices); falls back to any en-GB, then any English voice.
import { setDuck } from './audio.js';

const PREFERRED = [/ryan.*natural|ryan online/i, /thomas.*natural|thomas online/i, /sonia.*natural|sonia online/i, /libby.*natural/i,
  /google uk english male/i, /google uk english female/i, /microsoft george/i, /microsoft hazel/i, /microsoft susan/i, /\bdaniel\b/i, /\barthur\b/i];

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voice = null, enabled = true, speaking = false, queue = [], lastSaid = {}, lastAny = 0, current = null;
try { const v = localStorage.getItem('pgp_commentary'); if (v === '0') enabled = false; } catch (e) { }

function pickVoice() {
  if (!synth) return;
  const vs = synth.getVoices();
  if (!vs.length) return;
  for (const re of PREFERRED) { const v = vs.find(x => re.test(x.name) && /^en/i.test(x.lang)); if (v) { voice = v; return; } }
  voice = vs.find(x => /en[-_]GB/i.test(x.lang)) || vs.find(x => /^en/i.test(x.lang)) || null;
}
if (synth) { pickVoice(); synth.onvoiceschanged = pickVoice; }

export function commentaryAvailable() { return !!synth; }
export function voiceName() { return voice ? voice.name : ''; }
export function isCommentaryOn() { return enabled; }
export function setCommentary(on) {
  enabled = on;
  try { localStorage.setItem('pgp_commentary', on ? '1' : '0'); } catch (e) { }
  if (!on) stop();
}
export function stop() { queue = []; if (synth) synth.cancel(); speaking = false; setDuck(1); }

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
function fill(t, v) { return t.replace(/\{(\w+)\}/g, (_, k) => (v[k] != null ? v[k] : '')); }

// priority: 3 = must say (start, finish, winner), 2 = important (lead change, final lap, attacks), 1 = colour
export function say(lines, vars = {}, priority = 1, key = null, cooldownMs = 0) {
  if (!enabled || !synth) return;
  const now = Date.now();
  if (key && lastSaid[key] && now - lastSaid[key] < cooldownMs) return;
  if (priority === 1 && (speaking || queue.length) ) return;          // colour lines never wait in line
  if (priority === 1 && now - lastAny < 2500) return;
  if (key) lastSaid[key] = now;
  const text = fill(Array.isArray(lines) ? pick(lines) : lines, vars);
  if (priority >= 3) { queue = queue.filter(q => q.priority >= 3); }
  else if (priority === 2) { queue = queue.filter(q => q.priority >= 2); }
  queue.push({ text, priority, at: now });
  queue.sort((a, b) => b.priority - a.priority);
  if (queue.length > 3) queue.length = 3;
  if (priority >= 3 && speaking && current && current.priority < 3) { synth.cancel(); }
  pump();
}

function pump() {
  if (speaking || !queue.length || !synth) return;
  const item = queue.shift();
  if (Date.now() - item.at > (item.priority >= 3 ? 9000 : 4500)) return pump(); // stale news
  const u = new SpeechSynthesisUtterance(item.text);
  if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
  u.rate = item.priority >= 2 ? 1.12 : 1.05;
  u.pitch = 1.0; u.volume = 1;
  speaking = true; current = item; setDuck(0.35);
  const done = () => { if (current !== item) return; speaking = false; current = null; lastAny = Date.now(); if (!queue.length) setDuck(1); setTimeout(pump, 250); };
  u.onend = done; u.onerror = done;
  setTimeout(() => { if (current === item) { synth.cancel(); done(); } }, 12000); // Chrome sometimes never fires onend
  synth.speak(u);
}

// ---------- script ----------
export const L = {
  welcome: ['Welcome to the grid, {name}!', '{name} has joined the grid!', 'Here comes {name}!', '{name} is in the garage. Lovely.'],
  start: ['And they\'re away at the {gp}!', 'Lights out, and away we go at the {gp}!', 'Here we go! The {gp} is underway!'],
  lead: ['{name} takes the lead!', 'And {name} goes into the lead!', 'A new leader! It\'s {name}!', '{name} hits the front! Brilliant!', 'Oh, what a move! {name} is in front!'],
  battle: ['{p2} is right on the gearbox of {p1}!', 'What a battle for the lead! {p1} and {p2}, wheel to wheel!', '{p2} is all over the back of {p1}!'],
  fastest: ['Fastest lap for {name}!', 'Purple sectors everywhere! Fastest lap, {name}!', 'That\'s the quickest lap of the race, from {name}!'],
  streak: ['{name} is on fire! Three in a row!', 'Three correct answers in a row for {name}! Power up!', '{name} is absolutely flying! Power up incoming!'],
  catchup: ['{name} gets a catch-up power! This race is not over!', 'Here comes {name} with a power-up! Watch out, leaders!', '{name} is fighting back!'],
  turbo: ['{name} hits the turbo!', 'Turbo for {name}! Look at that speed!', 'And {name} has found an extra gear!'],
  shrink: ['Mini ray from {name}! Everybody\'s shrinking!', 'Oh, {name} has shrunk the whole field!', 'Lightning strikes! Courtesy of {name}!'],
  missile: ['{name} fires a missile at {target}!', 'Missile away! {name} is targeting {target}!', 'Here comes the missile from {name}! {target}, watch out!'],
  blocked: ['But the shield holds! {target} is safe!', 'Blocked! What a defence from {target}!'],
  shield: ['{name} raises the shield.', 'Shields up for {name}. Very sensible.'],
  finalLap: ['Final lap! {name} leads the way!', 'Here comes the final lap! {name} in front!', 'One lap to go! Can anyone catch {name}?'],
  win: ['And {name} wins the {gp}! What a drive!', '{name} takes the chequered flag! Champion of the {gp}!', 'It\'s {name}! {name} wins it! Absolutely magnificent!'],
  finish: ['{name} crosses the line in P{pos}.', 'And {name} finishes in position {pos}.', 'P{pos} for {name}. Well driven.'],
  points: ['{name} is answering brilliantly. {n} correct so far!', 'Lovely work from {name}. {n} phrasal verbs correct!', '{name} is the top scorer, with {n} correct answers.'],
  midfield: ['{name} is up to P{pos}!', 'Good progress from {name}, now up to P{pos}.', '{name} climbs to P{pos}!'],
  podium: ['Ladies and gentlemen, your winner of the {gp}: {name}!', 'Up on the top step of the podium, {name}!'],
};
