/* practice.js — 書き順の練習画面（なぞる / れんしゅう）
   詳細モーダルと全画面の通常表示の、両方から使う共通の部品。
   strokeOrder.js（判定）と app.js（playAnimation / state / openModal など）のあとに読み込む。
   データの保存・外部への通信・音はなし。 */
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';
  var COL = { guide: '#E2E8F0', model: '#CBD5E1', ink: '#1F2A22', wrong: '#DC2626', hint: '#F59E0B' };

  var cur = null; // いま開いている練習 { where, host, k, mode, cleanups, ... }

  function el(name, attrs) {
    var e = document.createElementNS(NS, name);
    for (var a in attrs) e.setAttribute(a, attrs[a]);
    return e;
  }
  function ptsToD(pts) {
    return pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
  }
  function polyD(pts) { return ptsToD(pts); }

  function nextKanji(k) {
    var list = (typeof state !== 'undefined' && state.filtered) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].kanji === k.kanji) return i + 1 < list.length ? list[i + 1] : false; // false = 最後
    }
    return null; // 一覧にない
  }

  var BTN = function (cls, ic, jp, en, extra) {
    return '<button type="button" class="kj-btn ' + cls + '" ' + (extra || '') + '>' +
      '<svg class="ic"><use href="#i-' + ic + '"/></svg><span class="lb"><b>' + jp + '</b><small>' + en + '</small></span></button>';
  };

  function where(w) {
    if (w === 'modal') return { host: document.getElementById('kjPracModal'), hide: [document.getElementById('kjStage'), document.querySelector('.kj-modal-btns')] };
    return { host: document.getElementById('kjPracFs'), hide: [document.getElementById('kjFsStage'), document.querySelector('.kj-fs-controls')] };
  }

  function unmount() {
    if (!cur) return;
    cur.cleanups.forEach(function (f) { try { f(); } catch (e) { /* ignore */ } });
    var w = where(cur.where);
    w.host.innerHTML = '';
    w.host.style.display = 'none';
    w.hide.forEach(function (n) { if (n) n.style.display = ''; });
    cur = null;
  }

  function mount(whereName, k, mode) {
    unmount();
    if (!k || k.isKana || !window.StrokeOrder) return;
    var w = where(whereName);
    var polys = StrokeOrder.strokesToPolylines(k.strokes);
    var S = {
      where: whereName, k: k, mode: mode || 'trace', polys: polys, cleanups: [],
      accepted: 0, mistakes: 0, done: false, animating: false,
      drawing: null, userStrokes: []
    };
    cur = S;
    w.hide.forEach(function (n) { if (n) n.style.display = 'none'; });
    w.host.style.display = '';
    w.host.innerHTML =
      '<div class="kj-prac-head">' + BTN('sm c-gray', 'arrow-left', 'もどる', 'Back', 'data-act="back"') +
      '<div class="kj-prac-title"><span class="kj-prac-k">' + k.kanji + '</span><span>' + k.strokeCount + ' 画 <small>strokes</small></span></div></div>' +
      '<div class="kj-prac-tabs" role="group" aria-label="練習の種類 / Mode">' +
      BTN('c-blue', 'pen', 'なぞる', 'Trace', 'data-mode="trace"') +
      BTN('c-purple', 'check', 'れんしゅう', 'Practice', 'data-mode="practice"') + '</div>' +
      '<div class="kj-prac-box"><svg class="kj-prac-svg" viewBox="0 0 109 109" aria-label="書く場所 / Writing area"></svg></div>' +
      '<div class="kj-prac-msg" aria-live="polite"></div>' +
      '<div class="kj-prac-btns"></div>' +
      '<p class="kj-prac-note">1画は、ペンを離さずに書く。<small>One stroke = write without lifting your pen.</small></p>' +
      '<p class="kj-prac-note">見るのは、場所・向き・長さです。とめ・はね・はらいは見ません。<small>We check position, direction and length. We do not check stops, hooks or sweeps.</small></p>' +
      '<p class="kj-prac-credit">書き順データ / Stroke data: KanjiVG (CC BY-SA 3.0)</p>';
    S.host = w.host;
    S.svg = w.host.querySelector('.kj-prac-svg');
    S.msg = w.host.querySelector('.kj-prac-msg');
    S.btns = w.host.querySelector('.kj-prac-btns');

    w.host.querySelector('[data-act="back"]').onclick = unmount;
    w.host.querySelectorAll('[data-mode]').forEach(function (b) {
      b.onclick = function () { S.mode = b.dataset.mode; reset(S); };
    });
    bindPointer(S);
    reset(S);
    var first = w.host.querySelector('[data-mode="' + S.mode + '"]');
    if (first && first.scrollIntoView) { /* 画面内に収まるようにする */ w.host.scrollIntoView({ block: 'nearest' }); }
  }

  /* ---------- 描く場所を作り直す ---------- */
  function reset(S) {
    (S.timers || []).forEach(clearTimeout);
    S.timers = [];
    S.accepted = 0; S.mistakes = 0; S.done = false; S.animating = false; S.drawing = null; S.userStrokes = [];
    S.host.querySelectorAll('[data-mode]').forEach(function (b) { b.classList.toggle('on', b.dataset.mode === S.mode); b.setAttribute('aria-pressed', b.dataset.mode === S.mode ? 'true' : 'false'); });
    var svg = S.svg;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    // 十字のガイド
    var g0 = el('g', { stroke: COL.guide, 'stroke-width': 0.8, 'stroke-dasharray': '3 3', fill: 'none' });
    g0.appendChild(el('line', { x1: 54.5, y1: 0, x2: 54.5, y2: 109 }));
    g0.appendChild(el('line', { x1: 0, y1: 54.5, x2: 109, y2: 54.5 }));
    svg.appendChild(g0);
    S.gModel = el('g', {}); S.gDone = el('g', {}); S.gHint = el('g', {}); S.gUser = el('g', {}); S.gAnim = el('g', {});
    [S.gModel, S.gDone, S.gHint, S.gUser, S.gAnim].forEach(function (g) { svg.appendChild(g); });
    if (S.mode === 'trace') {
      S.k.strokes.forEach(function (d) {
        S.gModel.appendChild(el('path', { d: d, fill: 'none', stroke: COL.model, 'stroke-width': S.k.strokeCount >= 12 ? 4.5 : 7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      });
      S.polys.forEach(function (p, i) {
        S.gModel.appendChild(el('circle', { cx: p[0][0], cy: p[0][1], r: 4, fill: '#fff', stroke: '#64748B', 'stroke-width': 0.8 }));
        var t = el('text', { x: p[0][0], y: p[0][1] + 1.6, 'text-anchor': 'middle', 'font-size': 4.6, 'font-weight': 700, fill: '#334155' });
        t.textContent = String(i + 1); S.gModel.appendChild(t);
      });
    }
    setMsg(S, '', '');
    if (S.mode === 'trace') {
      setMsg(S, 'お手本をなぞって書きましょう。', 'Trace the gray strokes.');
    } else {
      setMsg(S, '1画目から、じゅんばんに書きましょう。', 'Write the strokes one by one, in order.');
    }
    renderButtons(S);
  }

  function setMsg(S, jp, en, kind) {
    S.msg.className = 'kj-prac-msg' + (kind ? ' ' + kind : '');
    S.msg.innerHTML = jp ? '<b>' + jp + '</b><small>' + en + '</small>' : '';
  }

  function renderButtons(S) {
    var h = '';
    if (S.mode === 'trace') {
      h += BTN('c-gray', 'rotate', '消す', 'Clear', 'data-act="clear"');
      h += BTN('c-red', 'play', '書き順を見る', 'Watch', 'data-act="watch"');
    } else if (S.done) {
      h += BTN('c-gray', 'rotate', 'もう一度書く', 'Again', 'data-act="again"');
    } else {
      h += BTN('c-gray', 'rotate', 'もう一度書く', 'Start over', 'data-act="again"');
      h += BTN('c-orange', 'arrow-left', 'スキップ', 'Skip', 'data-act="skip"');
    }
    var nx = nextKanji(S.k);
    if (nx !== null) h += BTN('c-green solid', 'arrow-left', '次の漢字', 'Next', 'data-act="next" class-flip' + (nx === false ? ' disabled' : ''));
    S.btns.innerHTML = h;
    S.btns.querySelectorAll('[class-flip]').forEach(function (b) { b.removeAttribute('class-flip'); b.querySelector('.ic').style.transform = 'scaleX(-1)'; });
    var sk = S.btns.querySelector('[data-act="skip"]'); if (sk) sk.querySelector('.ic').style.transform = 'scaleX(-1)';
    var on = function (a, f) { var b = S.btns.querySelector('[data-act="' + a + '"]'); if (b) b.onclick = f; };
    on('clear', function () { reset(S); });
    on('again', function () { reset(S); });
    on('watch', function () { watch(S); });
    on('skip', function () { skip(S); });
    on('next', function () {
      var n = nextKanji(S.k); if (!n) return;
      var wn = S.where, md = S.mode;
      unmount();
      if (wn === 'modal') openModal(n); else openFullscreen(n);
      mount(wn, n, md);
    });
  }

  /* ---------- 書き順を見る（なぞるモード。アニメーションは app.js の playAnimation をそのまま使う） ---------- */
  function watch(S) {
    if (S.animating) return;
    S.animating = true;
    while (S.gAnim.firstChild) S.gAnim.removeChild(S.gAnim.firstChild);
    var els = S.k.strokes.map(function (d) {
      var p = el('path', { d: d, fill: 'none', stroke: '#DC2626', 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      S.gAnim.appendChild(p); return p;
    });
    if (typeof currentAnimSpeed !== 'undefined') currentAnimSpeed = 700;
    playAnimation(els);
    var t = setTimeout(function () {
      S.animating = false;
      while (S.gAnim.firstChild) S.gAnim.removeChild(S.gAnim.firstChild);
    }, S.k.strokes.length * 700 + 900);
    S.timers.push(t);
  }

  /* ---------- れんしゅうモード ---------- */
  function drawModel(S, g, idx, color, width, opacity) {
    g.appendChild(el('path', { d: S.k.strokes[idx], fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: opacity || 1 }));
  }
  function showHint(S) {
    while (S.gHint.firstChild) S.gHint.removeChild(S.gHint.firstChild);
    if (S.accepted >= S.polys.length) return;
    drawModel(S, S.gHint, S.accepted, COL.hint, 6, 0.7);
    var st = S.polys[S.accepted][0];
    S.gHint.appendChild(el('circle', { cx: st[0], cy: st[1], r: 4.5, fill: COL.hint }));
  }
  function clearHint(S) { while (S.gHint.firstChild) S.gHint.removeChild(S.gHint.firstChild); }

  function accept(S) {
    drawModel(S, S.gDone, S.accepted, COL.ink, 5, 1);
    S.accepted++;
    clearHint(S);
    if (S.accepted >= S.polys.length) {
      S.done = true;
      if (S.mistakes === 0) setMsg(S, '正解です！', 'Correct!', 'good');
      else setMsg(S, '最後まで書けました。でも、まちがいがありました。', 'You finished, but there were mistakes.', 'good');
      renderButtons(S);
    } else {
      setMsg(S, (S.accepted + 1) + '画目を書きましょう。', 'Write stroke ' + (S.accepted + 1) + '.');
    }
  }

  function skip(S) {
    if (S.done || S.mode !== 'practice') return;
    S.mistakes++;
    accept(S);
    if (!S.done) setMsg(S, (S.accepted + 1) + '画目を書きましょう。', 'Write stroke ' + (S.accepted + 1) + '.');
  }

  function finishStroke(S, pts, pathEl) {
    if (S.mode === 'trace') {
      // 判定しない。書いた線は残す。点は小さな丸にする。
      if (StrokeOrder.polylineLength(pts) < 3) {
        pathEl.remove();
        var c = pts[0];
        S.gUser.appendChild(el('circle', { cx: c[0], cy: c[1], r: 2.6, fill: COL.ink }));
      }
      return;
    }
    // れんしゅう
    var wasRealTouch = StrokeOrder.polylineLength(pts) >= 3;
    var nextLen = StrokeOrder.polylineLength(S.polys[S.accepted]);
    if (!wasRealTouch && nextLen >= StrokeOrder.JUDGE.dotLength) { pathEl.remove(); return; } // うっかり触れただけ：数えない
    var result = StrokeOrder.judgeStroke(pts, S.polys, S.accepted);
    if (result === 'ok') {
      pathEl.remove();
      accept(S);
      return;
    }
    // まちがい：赤い線を0.6秒だけ見せる
    pathEl.setAttribute('stroke', COL.wrong);
    var t = setTimeout(function () { pathEl.remove(); }, 600);
    S.timers.push(t);
    S.mistakes++;
    showHint(S);
    if (result === 'order') setMsg(S, '書き順がちがいます', 'Wrong stroke order', 'bad');
    else setMsg(S, '形か向きがちがいます', 'Wrong shape or direction', 'bad');
  }

  /* ---------- 入力（Pointer Events） ---------- */
  function bindPointer(S) {
    var svg = S.svg;
    function pos(e) {
      var r = svg.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * 109, ((e.clientY - r.top) / r.height) * 109];
    }
    function canDraw() { return !S.animating && !(S.mode === 'practice' && S.done); }
    svg.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (S.drawing || !canDraw()) return;
      e.preventDefault();
      try { svg.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      var p = pos(e);
      var pathEl = el('path', { d: ptsToD([p]), fill: 'none', stroke: COL.ink, 'stroke-width': 5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' });
      S.gUser.appendChild(pathEl);
      S.drawing = { id: e.pointerId, pts: [p], pathEl: pathEl };
    });
    svg.addEventListener('pointermove', function (e) {
      var d = S.drawing; if (!d || e.pointerId !== d.id) return;
      var p = pos(e), last = d.pts[d.pts.length - 1];
      if (Math.abs(p[0] - last[0]) < 0.05 && Math.abs(p[1] - last[1]) < 0.05) return;
      d.pts.push(p);
      d.pathEl.setAttribute('d', polyD(d.pts));
    });
    function end(e, cancelled) {
      var d = S.drawing; if (!d || e.pointerId !== d.id) return;
      S.drawing = null;
      try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* ignore */ }
      if (cancelled) { d.pathEl.remove(); return; }
      finishStroke(S, d.pts, d.pathEl);
    }
    svg.addEventListener('pointerup', function (e) { end(e, false); });
    svg.addEventListener('pointercancel', function (e) { end(e, true); });
  }

  /* ---------- 「書き順を練習」ボタン ---------- */
  function init() {
    var bm = document.getElementById('kjPracOpen');
    var bf = document.getElementById('kjFsPracOpen');
    if (bm) bm.addEventListener('click', function () { if (typeof currentModalKanji !== 'undefined' && currentModalKanji) mount('modal', currentModalKanji, 'trace'); });
    if (bf) bf.addEventListener('click', function () { if (typeof fsCurrentKanji !== 'undefined' && fsCurrentKanji) mount('fs', fsCurrentKanji, 'trace'); });
  }
  init();

  window.Practice = { mount: mount, unmount: unmount };
})();
