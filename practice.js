/* practice.js — 書き順の練習画面（なぞる / れんしゅう）
   「書き順を練習」ボタンを押すと、練習する漢字だけを大きく出す全画面になる。
   strokeOrder.js（判定）と app.js（playAnimation / state / openModal など）のあとに読み込む。
   データの保存・外部への通信はなし。音は sound/correct.mp3 と sound/incorrect.mp3 を使う。 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var COL = { guide: '#E2E8F0', model: '#CBD5E1', accent: '#15803D', accentDark: '#166534', wrong: '#DC2626', hint: '#F59E0B' };
  var SOUND = { ok: 'sound/correct.mp3', ng: 'sound/incorrect.mp3' };

  var cur = null;          // いま開いている練習の状態
  var sounds = {};
  var bodyOverflow = '';

  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    return e;
  }
  function ptsToD(pts) {
    return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  }
  function play(which) {
    try {
      if (!sounds[which]) sounds[which] = new Audio(SOUND[which]);
      var a = sounds[which];
      a.currentTime = 0;
      var p = a.play();
      if (p && p.catch) p.catch(function () { /* 音が出せなくても何もしない */ });
    } catch (e) { /* 何もしない */ }
  }
  function BTN(cls, ic, jp, en, extra) {
    return '<button type="button" class="kj-btn ' + cls + '" ' + (extra || '') + '>' +
      '<svg class="ic"><use href="#i-' + ic + '"/></svg><span class="lb"><b>' + jp + '</b><small>' + en + '</small></span></button>';
  }

  /* いまの検索結果（state.filtered）の中での位置。{ index, total } か、一覧にないときは null */
  function listPos(k) {
    var list = (typeof state !== 'undefined' && state.filtered) || [];
    for (var i = 0; i < list.length; i++) if (list[i].kanji === k.kanji) return { index: i, total: list.length, list: list };
    return null;
  }

  function overlay() { return document.getElementById('kjPrac'); }

  function unmount() {
    if (!cur) return;
    (cur.timers || []).forEach(clearTimeout);
    var o = overlay();
    o.innerHTML = '';
    o.style.display = 'none';
    document.body.style.overflow = bodyOverflow;
    cur = null;
  }

  /* k: 練習する漢字、from: 'modal' か 'fs'（もとの画面）、mode: 'trace' か 'practice' */
  function mount(k, from, mode) {
    var keepOverflow = cur ? bodyOverflow : document.body.style.overflow;
    unmount();
    if (!k || k.isKana || !window.StrokeOrder) return;
    bodyOverflow = keepOverflow;
    document.body.style.overflow = 'hidden';
    var S = {
      k: k, from: from, mode: mode || 'trace', polys: StrokeOrder.strokesToPolylines(k.strokes),
      accepted: 0, mistakes: 0, done: false, animating: false, drawing: null, timers: [], finished: false
    };
    cur = S;
    var pos = listPos(k);
    var o = overlay();
    o.style.display = 'flex';
    o.scrollTop = 0;
    o.innerHTML =
      '<div class="kj-prac-bar">' + BTN('sm c-gray', 'arrow-left', 'もどる', 'Back', 'data-act="back"') +
      '<div class="kj-prac-progress">' + (pos ? (pos.index + 1) + ' / ' + pos.total : '') + '</div></div>' +
      '<div class="kj-prac-main">' +
      '<div class="kj-prac-help" aria-live="polite"></div>' +
      '<div class="kj-prac-box"><svg class="kj-prac-svg" viewBox="0 0 109 109" aria-label="' + k.kanji + ' の書き順 / Stroke order of ' + k.kanji + '"></svg></div>' +
      '<div class="kj-prac-msg" aria-live="polite"></div>' +
      '<div class="kj-prac-btns"></div>' +
      '</div>' +
      '<div class="kj-prac-foot">' +
      '<div class="kj-prac-tabs" role="group" aria-label="練習の種類 / Mode">' +
      BTN('c-blue', 'pen', 'なぞる', 'Trace', 'data-mode="trace"') +
      BTN('c-purple', 'target', 'れんしゅう', 'Practice', 'data-mode="practice"') + '</div>' +
      '<p class="kj-prac-note">1画は、ペンを離さずに書く。 One stroke = write without lifting your pen.</p>' +
      '<p class="kj-prac-credit">書き順データ / Stroke data: KanjiVG (CC BY-SA 3.0)</p>' +
      '</div>';
    S.box = o.querySelector('.kj-prac-box');
    S.svg = o.querySelector('.kj-prac-svg');
    S.msg = o.querySelector('.kj-prac-msg');
    S.help = o.querySelector('.kj-prac-help');
    S.btns = o.querySelector('.kj-prac-btns');
    o.querySelector('[data-act="back"]').onclick = unmount;
    o.querySelectorAll('[data-mode]').forEach(function (b) {
      b.onclick = function () { S.mode = b.dataset.mode; reset(S); };
    });
    bindPointer(S);
    reset(S);
  }

  /* ---------- 描く場所を作り直す ---------- */
  function reset(S) {
    S.timers.forEach(clearTimeout); S.timers = [];
    S.accepted = 0; S.mistakes = 0; S.done = false; S.animating = false; S.drawing = null; S.finished = false;
    var o = overlay();
    S.box.style.display = '';
    o.querySelectorAll('[data-mode]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.mode === S.mode);
      b.setAttribute('aria-pressed', b.dataset.mode === S.mode ? 'true' : 'false');
    });
    var svg = S.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var g0 = el('g', { stroke: COL.guide, 'stroke-width': 0.8, 'stroke-dasharray': '3 3', fill: 'none' });
    g0.appendChild(el('line', { x1: 54.5, y1: 2, x2: 54.5, y2: 107 }));
    g0.appendChild(el('line', { x1: 2, y1: 54.5, x2: 107, y2: 54.5 }));
    svg.appendChild(g0);
    // うすいグレーの手本は、なぞる・れんしゅうのどちらでも出す
    var gm = el('g', {});
    var w = S.k.strokeCount >= 10 ? 5 : 7;
    S.k.strokes.forEach(function (d) {
      gm.appendChild(el('path', { d: d, fill: 'none', stroke: COL.model, 'stroke-width': w, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    });
    svg.appendChild(gm);
    if (S.mode === 'trace') {      // 書き順の番号は、なぞるだけ
      S.polys.forEach(function (p, i) {
        gm.appendChild(el('circle', { cx: p[0][0], cy: p[0][1], r: 4, fill: COL.accent }));
        var t = el('text', { x: p[0][0], y: p[0][1] + 2, 'text-anchor': 'middle', 'font-size': 5.5, 'font-weight': 700, fill: '#fff' });
        t.textContent = String(i + 1); gm.appendChild(t);
      });
    }
    S.gDone = el('g', {}); S.gHint = el('g', {}); S.gUser = el('g', {}); S.gAnim = el('g', {});
    [S.gDone, S.gHint, S.gUser, S.gAnim].forEach(function (g) { svg.appendChild(g); });
    S.help.innerHTML = S.mode === 'trace'
      ? 'グレーの文字を、なぞってください。<small>Trace the gray letter.</small>'
      : 'グレーの文字を、書き順どおりに、1画ずつ書いてください。<small>Write the gray letter one stroke at a time, in the right order.</small>';
    setMsg(S, '', '');
    renderButtons(S);
  }

  function setMsg(S, jp, en, kind) {
    S.msg.className = 'kj-prac-msg' + (kind ? ' ' + kind : '');
    S.msg.innerHTML = jp ? '<b>' + jp + '</b><small>' + en + '</small>' : '';
  }

  function renderButtons(S) {
    var h = '';
    if (S.mode === 'trace') {
      h += BTN('c-gray', 'x', '消す', 'Clear', 'data-act="clear"');
      h += BTN('c-red', 'play', '書き順を見る', 'Watch', 'data-act="watch"');
    } else {
      h += BTN('c-gray', 'rotate', 'もう一度書く', 'Try again', 'data-act="again"');
    }
    var pos = listPos(S.k);
    // 「次の漢字」：なぞるはいつでも、れんしゅうは書き終わったあと。いまの検索結果にない漢字では出さない。
    if (pos && (S.mode === 'trace' || S.done)) h += BTN('c-green solid', 'arrow-left', '次の漢字', 'Next', 'data-act="next"');
    S.btns.innerHTML = h;
    var nx = S.btns.querySelector('[data-act="next"]');
    if (nx) nx.querySelector('.ic').style.transform = 'scaleX(-1)';
    var on = function (a, f) { var b = S.btns.querySelector('[data-act="' + a + '"]'); if (b) b.onclick = f; };
    on('clear', function () { while (S.gUser.firstChild) S.gUser.removeChild(S.gUser.firstChild); });
    on('again', function () { reset(S); });
    on('watch', function () { watch(S); });
    on('next', function () { goNext(S); });
  }

  function goNext(S) {
    var pos = listPos(S.k);
    if (!pos) return;
    if (pos.index + 1 >= pos.total) { showFinished(S); return; }
    var n = pos.list[pos.index + 1], from = S.from, md = S.mode;
    unmount();
    if (from === 'modal') openModal(n); else openFullscreen(n);
    mount(n, from, md);
  }

  function showFinished(S) {
    S.finished = true;
    S.box.style.display = 'none';
    S.help.innerHTML = '';
    S.msg.className = 'kj-prac-msg';
    S.msg.innerHTML = '<div class="kj-prac-finish"><div class="big">おわりました！</div><div class="en">Finished!</div></div>';
    S.btns.innerHTML = BTN('c-gray', 'rotate', 'もう一度', 'Again', 'data-act="restart"') + BTN('c-green solid', 'arrow-left', 'もどる', 'Back', 'data-act="back2"');
    S.btns.querySelector('[data-act="back2"] .ic').style.transform = '';
    S.btns.querySelector('[data-act="back2"]').onclick = unmount;
    S.btns.querySelector('[data-act="restart"]').onclick = function () {
      var pos = listPos(S.k), first = pos && pos.list[0], from = S.from, md = S.mode;
      if (!first) { reset(S); return; }
      unmount();
      if (from === 'modal') openModal(first); else openFullscreen(first);
      mount(first, from, md);
    };
  }

  /* ---------- 書き順を見る（アニメーションは app.js の playAnimation をそのまま使う） ---------- */
  function watch(S) {
    if (S.animating) return;
    S.animating = true;
    while (S.gAnim.firstChild) S.gAnim.removeChild(S.gAnim.firstChild);
    var els = S.k.strokes.map(function (d) {
      var p = el('path', { d: d, fill: 'none', stroke: COL.accentDark, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      S.gAnim.appendChild(p); return p;
    });
    if (typeof currentAnimSpeed !== 'undefined') currentAnimSpeed = 700;
    playAnimation(els);
    S.timers.push(setTimeout(function () {
      S.animating = false;
      while (S.gAnim.firstChild) S.gAnim.removeChild(S.gAnim.firstChild);
    }, S.k.strokes.length * 700 + 900));
  }

  /* ---------- れんしゅう ---------- */
  function drawModel(g, S, idx, color, width, opacity) {
    g.appendChild(el('path', { d: S.k.strokes[idx], fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: opacity || 1 }));
  }
  function showHint(S) {
    while (S.gHint.firstChild) S.gHint.removeChild(S.gHint.firstChild);
    if (S.accepted >= S.polys.length) return;
    drawModel(S.gHint, S, S.accepted, COL.hint, 6, 0.7);
    var st = S.polys[S.accepted][0];
    S.gHint.appendChild(el('circle', { cx: st[0], cy: st[1], r: 4.5, fill: COL.hint }));
  }
  function accept(S) {
    drawModel(S.gDone, S, S.accepted, COL.accentDark, 5, 1);
    S.accepted++;
    while (S.gHint.firstChild) S.gHint.removeChild(S.gHint.firstChild);
    setMsg(S, '', '');
    if (S.accepted >= S.polys.length) {
      S.done = true;
      if (S.mistakes === 0) { setMsg(S, '正解です！', 'Well done!', 'good'); play('ok'); }
      else setMsg(S, '最後まで書けました。でも、まちがいがありました。', 'You finished, but you made a mistake. Try again.', 'bad');
      renderButtons(S);
    }
  }

  function finishStroke(S, pts, pathEl) {
    if (S.mode === 'trace') {                 // 判定しない。書いた線は残す。点は小さな丸
      if (StrokeOrder.polylineLength(pts) < 3) {
        pathEl.remove();
        S.gUser.appendChild(el('circle', { cx: pts[0][0], cy: pts[0][1], r: 2.5, fill: COL.accentDark }));
      } else {
        pathEl.setAttribute('stroke', COL.accentDark);
      }
      return;
    }
    // 触っただけ（次の画が点ではないとき）は、まちがいに数えない
    if (StrokeOrder.polylineLength(pts) < 3 && StrokeOrder.polylineLength(S.polys[S.accepted]) >= StrokeOrder.JUDGE.dotLength) { pathEl.remove(); return; }
    var result = StrokeOrder.judgeStroke(pts, S.polys, S.accepted);
    if (result === 'ok') { pathEl.remove(); accept(S); return; }
    pathEl.setAttribute('stroke', COL.wrong);   // まちがい：赤い線を0.6秒だけ見せる
    S.timers.push(setTimeout(function () { pathEl.remove(); }, 600));
    S.mistakes++;
    play('ng');
    showHint(S);
    if (result === 'order') setMsg(S, '書き順がちがいます', 'Wrong stroke order.', 'bad');
    else setMsg(S, '形か向きがちがいます', 'Check the shape and the direction.', 'bad');
  }

  /* ---------- 入力（Pointer Events） ---------- */
  function bindPointer(S) {
    var box = S.box, svg = S.svg;
    function pos(e) {
      var r = box.getBoundingClientRect(), w = r.width || 1;
      return [((e.clientX - r.left) / w) * 109, ((e.clientY - r.top) / (r.height || w)) * 109];
    }
    box.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (S.drawing || S.animating || (S.mode === 'practice' && S.done) || S.finished) return;
      e.preventDefault();
      try { box.setPointerCapture(e.pointerId); } catch (x) { /* 何もしない */ }
      var p = pos(e);
      var pathEl = el('path', { d: ptsToD([p]), fill: 'none', stroke: COL.accent, 'stroke-width': 4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      S.gUser.appendChild(pathEl);
      S.drawing = { id: e.pointerId, pts: [p], pathEl: pathEl };
      if (S.mode === 'practice' && !S.done) setMsg(S, '', '');   // 次の線を書き始めたら、メッセージを消す
    });
    box.addEventListener('pointermove', function (e) {
      var d = S.drawing; if (!d || e.pointerId !== d.id) return;
      var p = pos(e), last = d.pts[d.pts.length - 1];
      if (Math.abs(p[0] - last[0]) < 0.05 && Math.abs(p[1] - last[1]) < 0.05) return;
      d.pts.push(p);
      d.pathEl.setAttribute('d', ptsToD(d.pts));
    });
    function end(e, cancelled) {
      var d = S.drawing; if (!d || e.pointerId !== d.id) return;
      S.drawing = null;
      try { box.releasePointerCapture(e.pointerId); } catch (x) { /* 何もしない */ }
      if (cancelled) { d.pathEl.remove(); return; }
      finishStroke(S, d.pts, d.pathEl);
    }
    box.addEventListener('pointerup', function (e) { end(e, false); });
    box.addEventListener('pointercancel', function (e) { end(e, true); });
  }

  /* ---------- 「書き順を練習」ボタン・Escキー ---------- */
  function init() {
    var bm = document.getElementById('kjPracOpen');
    var bf = document.getElementById('kjFsPracOpen');
    if (bm) bm.addEventListener('click', function () { if (typeof currentModalKanji !== 'undefined' && currentModalKanji) mount(currentModalKanji, 'modal', 'trace'); });
    if (bf) bf.addEventListener('click', function () { if (typeof fsCurrentKanji !== 'undefined' && fsCurrentKanji) mount(fsCurrentKanji, 'fs', 'trace'); });
    // Escは、練習の画面だけを閉じる（もとの画面は残す）
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && cur) { e.stopImmediatePropagation(); unmount(); }
    }, true);
    // 音を先に読み込んでおく
    ['ok', 'ng'].forEach(function (k) { try { sounds[k] = new Audio(SOUND[k]); sounds[k].preload = 'auto'; } catch (e) { /* 何もしない */ } });
  }
  init();

  window.Practice = { mount: mount, unmount: unmount };
})();
