// Personal study sheet a student can download from their phone after the race (self-contained HTML, works offline)
'use strict';

const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const words = a => String(a).replace(/\s*\/\s*/g, ' … ');
const meaningOnly = m => { const i = m.indexOf('='); return i >= 0 ? m.slice(i + 1).trim() : m; };
function fmt(ms) {
  if (ms == null) return '—';
  const s = ms / 1000, m = Math.floor(s / 60);
  return (m ? m + ':' + String(Math.floor(s % 60)).padStart(2, '0') : Math.floor(s)) + '.' + String(Math.floor(ms % 1000)).padStart(3, '0');
}
// Fill the gap(s) of a sentence with the answer, highlighted
function filled(q, answer, cls) {
  const parts = String(answer).split(/\s*\/\s*/);
  let i = 0;
  return esc(q).replace(/___/g, () => '<b class="' + cls + '">' + esc(parts[Math.min(i++, parts.length - 1)]) + '</b>');
}

function reviewHtml(r) {
  const f = r.feedback;
  const missed = [];
  const seen = new Set();
  for (const x of r.log) if (!x.correct && !seen.has(x.pv)) { seen.add(x.pv); missed.push(x); }
  const right = r.log.filter(x => x.correct);
  const date = new Date(r.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const total = r.correct + r.wrong;
  const passCol = total === 0 ? '#6b7088' : f.pass ? '#0f9d58' : f.acc >= 60 ? '#e09100' : '#d93a4a';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phrasal GP review · ${esc(r.name)}</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#f4f5f9;color:#16181f;line-height:1.45}
.wrap{max-width:760px;margin:0 auto;padding:18px 16px 40px}
.logo{display:inline-block;font-weight:900;font-style:italic;font-size:22px}.logo span{display:inline-block;padding:2px 8px}.logo .a{background:#e10600;color:#fff}.logo .b{background:#16181f;color:#fff}
h1{font-size:26px;margin:14px 0 2px}h2{font-size:18px;margin:26px 0 10px;letter-spacing:.5px;border-bottom:3px solid #e10600;padding-bottom:4px}
.sub{color:#5d6273;font-weight:600}
.card{background:#fff;border-radius:10px;padding:14px 16px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin:10px 0}
.stats{display:flex;flex-wrap:wrap;gap:10px}.stat{flex:1;min-width:120px;background:#fff;border-radius:10px;padding:10px 12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.stat b{display:block;font-size:24px}.stat small{color:#5d6273;font-weight:700;letter-spacing:.5px;text-transform:uppercase;font-size:11px}
.acc b{color:${passCol}}
.head{border-left:5px solid ${passCol};padding-left:10px;font-weight:700}
.tag{display:inline-block;padding:2px 9px;border-radius:99px;font-weight:800;font-size:13px;margin:2px}.g{background:#dff5e8;color:#0b7a43}.r{background:#fde3e6;color:#b4232f}
.pv{font-size:19px;font-weight:900;color:#b4232f}.mean{font-weight:600}.ex{margin-top:6px;color:#333}
b.ok{color:#0b7a43;background:#e5f7ec;padding:0 3px;border-radius:3px}b.bad{color:#b4232f;text-decoration:line-through}
.yours{font-size:13px;color:#5d6273;margin-top:4px}
ol{padding-left:22px}li{margin:6px 0}
details{margin:6px 0}summary{cursor:pointer;color:#3d5afe;font-weight:700}
.gap{display:inline-block;min-width:60px;border-bottom:2px solid #16181f}
.right li{color:#333}
.foot{margin-top:28px;color:#8a8fa3;font-size:13px;text-align:center}
@media print{body{background:#fff}.card,.stat{box-shadow:none;border:1px solid #ddd}details{display:block}.noprint{display:none}}
</style></head><body><div class="wrap">
<div class="logo"><span class="a">PHRASAL</span><span class="b">GP</span></div>
<h1>${esc(r.name)} — study review</h1>
<div class="sub">${esc(r.circuit)} · Level ${esc(r.level === 'MIX' ? 'A2–C1' : r.level)} · ${r.laps} laps · ${esc(date)}</div>

<h2>Your race</h2>
<div class="stats">
<div class="stat"><small>Position</small><b>P${r.pos}</b></div>
<div class="stat acc"><small>Accuracy</small><b>${f.acc}%</b></div>
<div class="stat"><small>Correct / wrong</small><b>${r.correct} / ${r.wrong}</b></div>
<div class="stat"><small>Best streak</small><b>${r.bestStreak}</b></div>
<div class="stat"><small>${r.finished ? 'Race time' : 'Laps'}</small><b>${r.finished ? fmt(r.time) : r.lapsDone}</b></div>
</div>
<div class="card"><div class="head">${esc(f.headline)}</div>
${f.notes && f.notes.length ? '<p class="sub">' + f.notes.map(esc).join(' ') + '</p>' : ''}
<p>${total ? (f.pass ? '✅ You reached the 80% pass mark.' : '↺ Goal: 80% or more. Study the verbs below and try again!') : ''}</p>
${f.strengths.length ? '<div>Strong with: ' + f.strengths.map(x => '<span class="tag g">' + esc(x) + '</span>').join('') + '</div>' : ''}
${f.review.length ? '<div>Review particles: ' + f.review.map(x => '<span class="tag r">' + esc(x) + '</span>').join('') + '</div>' : ''}
</div>

${missed.length ? `<h2>Phrasal verbs to study (${missed.length})</h2>
${missed.map(x => `<div class="card"><div class="pv">${esc(x.pv)}</div><div class="mean">= ${esc(meaningOnly(x.meaning))}</div>
<div class="ex">${filled(x.q, x.answer, 'ok')}</div>
<div class="yours">You chose: <b class="bad">${esc(words(x.chosen))}</b> → correct: <b class="ok">${esc(words(x.answer))}</b></div></div>`).join('')}

<h2>Practice at home</h2>
<p class="sub">Cover the answers, complete each sentence, then check.</p>
<div class="card"><ol>${missed.map(x => `<li>${esc(x.q).replace(/___/g, '<span class="gap"></span>')}<details><summary>Show answer</summary><b class="ok">${esc(words(x.answer))}</b> — ${esc(meaningOnly(x.meaning))}</details></li>`).join('')}</ol></div>`
    : `<h2>Phrasal verbs to study</h2><div class="card">${total ? 'No mistakes this race — fantastic! 🏆' : 'You did not answer any questions this race.'}</div>`}

${right.length ? `<h2>You got these right (${right.length})</h2><div class="card right"><ol>${right.map(x => `<li>${filled(x.q, x.answer, 'ok')}</li>`).join('')}</ol></div>` : ''}

<div class="foot">Phrasal GP · Phrasal Verbs Grand Prix<br><span class="noprint">Tip: use your browser's “Print → Save as PDF” to keep this as a PDF.</span></div>
</div></body></html>`;
}

module.exports = { reviewHtml };
