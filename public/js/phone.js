/* Phrasal GP — phone controller. Plain ES5 on purpose (old iPhones / Androids). */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  // ---------- storage with fallbacks (private mode / old Safari) ----------
  function sget(k) {
    try { var v = window.localStorage.getItem(k); if (v) return v; } catch (e) { }
    var m = document.cookie.match(new RegExp('(?:^|; )' + k + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function sset(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { }
    try { document.cookie = k + '=' + encodeURIComponent(v) + '; max-age=' + (60 * 60 * 24 * 7) + '; path=/; SameSite=Lax'; } catch (e2) { }
  }
  function rid() { var s = ''; for (var i = 0; i < 24; i++) s += Math.floor(Math.random() * 16).toString(16); return s; }

  var token = sget('pgp_token') || rid();
  sset('pgp_token', token);

  var params = {};
  location.search.replace(/^\?/, '').split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) params[p[0]] = decodeURIComponent(p[1] || ''); });
  $('inCode').value = (params.r || sget('pgp_code') || '').toUpperCase();
  $('inName').value = sget('pgp_name') || '';
  if (!$('inCode').value) $('inCode').focus();

  // ---------- state ----------
  var st = null, joined = false, wantJoin = false, me = null;
  var curQ = null, answering = false, fbTimer = null, offset = 0, countTimer = null, lastPhase = null, connectFails = 0, lastAnswerAt = 0;

  // ---------- socket: long-polling first (passes strict proxies), upgrade when possible ----------
  var socket = io({ transports: ['polling', 'websocket'], tryAllTransports: true, reconnection: true, reconnectionDelay: 700, reconnectionDelayMax: 3000, timeout: 12000 });

  socket.on('connect', function () {
    connectFails = 0;
    netBar(false);
    if (wantJoin) doJoin(true);
  });
  socket.on('disconnect', function () { netBar(true, 'Connection lost — reconnecting…'); setDot(false); });
  socket.on('connect_error', function () {
    connectFails++;
    netBar(true, 'Trying to connect… (' + connectFails + ')');
    // proxies that break WebSockets: stay on long-polling only
    if (connectFails >= 3 && socket.io && socket.io.opts) socket.io.opts.transports = ['polling'];
  });
  socket.on('p:state', function (s) { applyState(s); });
  socket.on('p:race', onRace);
  socket.on('p:finished', function (d) { showScreen('sDone'); $('doneTxt').textContent = 'P' + d.pos + '!'; vibrate([60, 60, 200]); });
  socket.on('p:hit', function (d) { showHit(d); });
  socket.on('p:kicked', function () { joined = false; wantJoin = false; showScreen('sJoin'); $('joinErr').textContent = 'The teacher removed you from the grid.'; });
  socket.on('p:replaced', function () { netBar(true, 'Opened on another tab/phone'); });

  function netBar(show, txt) { $('net').className = show ? '' : 'hidden'; if (txt) $('netTxt').textContent = txt; }
  $('netBtn').onclick = function () {
    try { socket.disconnect(); } catch (e) { }
    setTimeout(function () { socket.connect(); }, 150);
    // still offline after 8 s → full reload keeps token + name
    setTimeout(function () { if (!socket.connected) location.reload(); }, 8000);
  };
  // iOS kills sockets when the screen locks: reconnect as soon as we come back
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      if (!socket.connected) socket.connect(); else if (joined) sync();
    }
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted && !socket.connected) socket.connect(); });
  window.addEventListener('online', function () { if (!socket.connected) socket.connect(); });
  // watchdog: if we are "connected" but stuck with no question, ask for a sync
  setInterval(function () {
    if (joined && socket.connected && st && st.phase === 'race' && !curQ && !answering && me && !me.finished) sync();
  }, 4000);

  function sync() { socket.emit('player:sync', {}, function (s) { if (s) applyState(s); }); }

  // ---------- join ----------
  $('joinBtn').onclick = function () {
    var code = $('inCode').value.replace(/\s/g, '').toUpperCase();
    var name = $('inName').value.replace(/^\s+|\s+$/g, '');
    if (code.length !== 4) { $('joinErr').textContent = 'The room code has 4 letters.'; return; }
    if (!name) { $('joinErr').textContent = 'Write your name.'; return; }
    sset('pgp_code', code); sset('pgp_name', name);
    wantJoin = true;
    $('joinErr').textContent = 'Connecting…';
    if (socket.connected) doJoin(false); else socket.connect();
  };
  $('inName').addEventListener('keydown', function (e) { if (e.keyCode === 13) $('joinBtn').onclick(); });

  function doJoin(silent) {
    var code = sget('pgp_code') || $('inCode').value.toUpperCase();
    var name = sget('pgp_name') || $('inName').value;
    socket.emit('player:join', { code: code, name: name, token: token }, function (res) {
      if (!res || !res.ok) {
        joined = false;
        if (!silent || !st) { showScreen('sJoin'); }
        $('joinErr').textContent = (res && res.error) || 'Could not join.';
        if (res && /not found/i.test(res.error || '')) wantJoin = false;
        return;
      }
      joined = true;
      $('joinErr').textContent = '';
      if (res.state.you && res.state.you.token) { token = res.state.you.token; sset('pgp_token', token); }
      applyState(res.state);
    });
  }
  // auto re-join after reload if we were in a room
  if (sget('pgp_code') && sget('pgp_name') && (params.r ? params.r.toUpperCase() === sget('pgp_code') : true) && sget('pgp_joined') === sget('pgp_code')) {
    wantJoin = true;
  }

  // ---------- state ----------
  function applyState(s) {
    st = s; me = s.you;
    offset = s.serverNow - Date.now();
    sset('pgp_joined', s.code);
    document.documentElement.style.setProperty('--team', me.color);
    qsa('.myName').forEach(function (e) { e.textContent = me.name; });
    qsa('.me').forEach(function (e) { e.style.borderLeftColor = me.color; });
    qsa('.room').forEach(function (e) { e.textContent = 'ROOM ' + s.code; });
    $('sRace').querySelector('.hud').style.borderLeftColor = me.color;
    setDot(true);
    var phase = s.phase;
    if (phase === 'lobby') { renderGarage(); showScreen('sGarage'); }
    else if (phase === 'countdown') { showCountdown(); }
    else if (phase === 'race') {
      if (me.finished) { showScreen('sDone'); }
      else {
        showScreen('sRace');
        $('hLaps').textContent = '/' + (s.race ? s.race.laps : '');
        if (s.question && (!curQ || curQ.seq !== s.question.seq) && !answering) showQuestion(s.question);
        $('powerBtn').className = me.pendingPower ? '' : 'hidden';
        if (lastPhase === 'countdown') { $('status').textContent = 'GO GO GO!'; vibrate(200); }
      }
    } else if (phase === 'finished') { showResults(s.results); }
    lastPhase = phase;
  }
  function setDot(on) { qsa('.me .dot').forEach(function (d) { d.className = on ? 'dot' : 'dot off'; }); }

  function showScreen(id) {
    qsa('.screen').forEach(function (s) { s.className = s.className.replace(/\s*hidden/g, '') + (s.id === id ? '' : ' hidden'); });
    if (id !== 'sRace') { $('power').className = 'overlay hidden'; $('fb').className = 'fb hidden'; }
    if (id !== 'sCount' && countTimer) { clearInterval(countTimer); countTimer = null; }
    window.scrollTo(0, 0);
  }

  // ---------- garage ----------
  function renderGarage() {
    var taken = {};
    (st.taken || []).forEach(function (t) { taken[t.car] = t.name; });
    var html = '';
    st.cars.forEach(function (c) {
      var cls = 'car' + (me.car === c.id ? ' mine' : '') + (taken[c.id] ? ' taken' : '');
      html += '<div class="' + cls + '"><button data-car="' + c.id + '"' + (taken[c.id] ? ' disabled' : '') + '><img src="assets/thumbs/' + c.id + '.png" alt=""><b>' + c.name + '</b>' + (taken[c.id] ? '<span class="owner">' + esc(taken[c.id]) + '</span>' : '') + '</button></div>';
    });
    $('cars').innerHTML = html;
    qsa('#cars button').forEach(function (b) {
      b.onclick = function () {
        var car = b.getAttribute('data-car');
        socket.emit('player:car', { car: car }, function (res) { if (res && !res.ok && res.error) { $('garageInfo').textContent = res.error; } });
        vibrate(20);
      };
    });
    var lv = st.settings.level === 'MIX' ? 'A2–C1' : st.settings.level;
    $('garageInfo').innerHTML = (me.car ? '✅ Car selected! ' : '👆 Pick a car. ') + '<br><b>' + esc(st.settings.circuitName || '') + '</b> · Level ' + lv + ' · ' + st.settings.laps + ' laps<br>Waiting for the teacher to start…';
  }

  // ---------- countdown ----------
  function showCountdown() {
    showScreen('sCount');
    $('countCar').src = 'assets/thumbs/' + (me.car || 'race') + '.png';
    if (countTimer) clearInterval(countTimer);
    var lights = qsa('#sCount .lights i');
    countTimer = setInterval(function () {
      if (!st || !st.race) return;
      var ms = st.race.greenAt - (Date.now() + offset);
      var n = Math.max(0, Math.min(5, 6 - Math.ceil(ms / 1000)));
      lights.forEach(function (l, i) { l.className = i < n ? 'on' : ''; });
      $('countTxt').textContent = ms > 5000 ? 'GET READY' : ms > 0 ? 'WAIT FOR IT…' : 'GO!';
      if (ms <= 0) { $('sCount').querySelector('.lights').className = 'lights go'; }
    }, 100);
    $('sCount').querySelector('.lights').className = 'lights';
  }

  // ---------- questions ----------
  function fmtOpt(o) { return esc(o).replace(/\s*\/\s*/g, ' … '); }
  function showQuestion(q) {
    curQ = q; answering = false; window.__q = q;
    $('qLvl').textContent = q.level;
    $('qText').innerHTML = esc(q.q).replace(/___/g, '<span class="gap">?</span>');
    var html = '';
    for (var i = 0; i < q.options.length; i++) html += '<button data-i="' + i + '">' + fmtOpt(q.options[i]) + '</button>';
    $('opts').innerHTML = html;
    qsa('#opts button').forEach(function (b) { b.onclick = function () { answer(+b.getAttribute('data-i'), b); }; });
  }

  function answer(i, btn) {
    if (answering || !curQ) return;
    answering = true; lastAnswerAt = Date.now();
    qsa('#opts button').forEach(function (b) { b.disabled = true; });
    var seq = curQ.seq;
    var done = false;
    var guard = setTimeout(function () { if (!done) { answering = false; curQ = null; sync(); } }, 7000);
    socket.emit('player:answer', { seq: seq, choice: i }, function (res) {
      done = true; clearTimeout(guard);
      if (!res || res.error) {
        answering = false;
        if (res && res.question) showQuestion(res.question); else { curQ = null; sync(); }
        return;
      }
      var btns = qsa('#opts button');
      if (btns[res.correctIdx]) btns[res.correctIdx].className = 'right';
      if (!res.correct) btn.className = 'wrong';
      $('hStreak').textContent = res.streak;
      var fb = $('fb');
      if (res.correct) {
        fb.className = 'fb ok';
        fb.innerHTML = '✓ CORRECT! SPEED UP 🚀' + (res.streak >= 3 ? '<small>🔥 ' + res.streak + ' in a row</small>' : '');
        vibrate(30);
      } else {
        fb.className = 'fb bad';
        fb.innerHTML = 'ANSWER: ' + fmtOpt(res.answer) + '<small>' + esc(res.meaning) + '</small>';
        vibrate([80, 40, 80]);
      }
      clearTimeout(fbTimer);
      fbTimer = setTimeout(function () {
        fb.className = 'fb hidden';
        answering = false;
        if (res.next) showQuestion(res.next);
        if (res.power) openPower();
      }, res.correct ? 650 : 2300);
    });
  }

  // ---------- race hud ----------
  function onRace(d) {
    $('hPos').textContent = d.pos; $('hOf').textContent = '/' + d.of;
    $('hLap').textContent = d.lap; $('hLaps').textContent = '/' + d.laps;
    $('hStreak').textContent = d.streak;
    var pct = Math.max(5, Math.min(100, (d.momentum - 0.45) / (1.7 - 0.45) * 100));
    var bar = $('speedBar'); bar.style.width = pct + '%';
    bar.style.background = d.momentum >= 1.1 ? '#46ff9a' : d.momentum >= 0.8 ? '#ffd400' : '#ff4d5e';
    var s = '';
    if (d.flags & 16) s = '💥 SPINNING!'; else if (d.flags & 8) s = '⚡ SHRUNK!'; else if (d.flags & 4) s = '🚀 TURBO!'; else if (d.flags & 32) s = '🛡️ SHIELD ON'; else if (d.flags & 1) s = 'BOOST!'; else if (d.flags & 2) s = 'Slow… answer correctly!';
    $('status').textContent = s;
  }

  // ---------- power-ups ----------
  function openPower() { $('power').className = 'overlay'; $('powerBtn').className = ''; vibrate([40, 40, 40, 40, 120]); }
  $('powerBtn').onclick = openPower;
  $('powerLater').onclick = function () { $('power').className = 'overlay hidden'; };
  qsa('#power .powers button').forEach(function (b) {
    b.onclick = function () {
      var p = b.getAttribute('data-p');
      socket.emit('player:power', { type: p }, function (res) {
        $('power').className = 'overlay hidden';
        if (res && res.ok) { $('powerBtn').className = 'hidden'; $('status').textContent = 'POWER USED!'; }
      });
    };
  });
  var NAMES = { turbo: 'TURBO', shrink: 'MINI-RAY ⚡', missile: 'MISSILE 🎯', shield: 'SHIELD' };
  function showHit(d) {
    var h = $('hit');
    h.className = 'hit' + (d.blocked ? ' blocked' : '');
    h.textContent = d.blocked ? '🛡️ Your shield blocked ' + d.by + '\'s ' + NAMES[d.power] + '!' : 'Hit by ' + d.by + '\'s ' + NAMES[d.power] + '!';
    vibrate([200, 80, 200]);
    setTimeout(function () { h.className = 'hit hidden'; }, 1800);
  }

  // ---------- results ----------
  function showResults(r) {
    if (!r) return;
    showScreen('sRes');
    var row = null;
    for (var i = 0; i < r.rows.length; i++) if (r.rows[i].id === me.id) row = r.rows[i];
    if (!row) return;
    var f = row.feedback, tot = row.correct + row.wrong;
    $('resPos').textContent = 'P' + row.pos;
    $('resAcc').textContent = f.acc + '%';
    $('resPass').textContent = tot === 0 ? '' : f.pass ? '✅ PASS (80%+)' : '↺ BELOW 80% — KEEP PRACTISING';
    $('resPass').style.color = f.pass ? '#46ff9a' : '#ffb020';
    $('resStats').textContent = row.correct + ' correct · ' + row.wrong + ' wrong · best streak ' + row.bestStreak;
    $('resHead').textContent = f.headline;
    var m = '';
    f.missed.forEach(function (x) { var mm = x.meaning.split('='); m += '<div><b>' + fmtOpt(x.answer) + '</b> — ' + esc(mm.length > 1 ? mm.slice(1).join('=') : x.meaning) + '</div>'; });
    $('resMissed').innerHTML = m ? '<p style="font-weight:900;letter-spacing:2px;margin:12px 0 4px">REVIEW</p>' + m : '';
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function vibrate(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { } }
})();
