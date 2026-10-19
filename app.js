/* =====================================================================
   筆順 -hitsujun-  app.js
   Part 1: data, search, filters, home tiles, result grid
   ===================================================================== */
let KANJI_DATA = [];
let KANA_DATA = [];
let kanjiMap = new Map(); // kanji character -> its data entry, for cross-linking compounds
const state = { query:"", strokeFilter:null, radicalFilter:null, jlptFilter:null, gradeFilter:null, favoritesOnly:false, filtered:[], shown:0 };
const PAGE_SIZE = 100; // how many kanji cards are drawn at once
let studyModeActive = false;

const $ = id => document.getElementById(id);
function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
function icon(name){ return `<svg class="ic"><use href="#i-${name}"/></svg>`; }

/* ---- Colours by JLPT level (colour is never the only cue: the level text is always shown too) ---- */
const JLPT_COLOR = { N5:'green', N4:'teal', N3:'blue', N2:'purple', N1:'red' };
function jlptCls(l){ return 'c-' + (JLPT_COLOR[l] || 'gray'); }
const JLPT_HINT = { N5:'Basic', N4:'Elementary', N3:'Intermediate', N2:'Upper intermediate', N1:'Advanced', '対象外':'Not in JLPT lists' };

/* ---- Favorites (stored in the browser, no account needed) ---- */
const FAV_KEY = 'hitsujun-favorites';
let favorites = new Set();
function loadFavorites(){
  try{
    const raw = localStorage.getItem(FAV_KEY);
    favorites = new Set(raw ? JSON.parse(raw) : []);
  } catch(e){
    favorites = new Set(); // localStorage unavailable (e.g. private browsing) - favorites just won't persist
  }
}
function saveFavorites(){
  try{ localStorage.setItem(FAV_KEY, JSON.stringify(Array.from(favorites))); } catch(e){ /* ignore */ }
}
function toggleFavorite(kanji){
  if(favorites.has(kanji)) favorites.delete(kanji); else favorites.add(kanji);
  saveFavorites();
  updateFavToggleLabel();
  if(state.favoritesOnly) applyFilters();
}
function updateFavToggleLabel(){
  $('kjFavCount').textContent = favorites.size ? ` (${favorites.size})` : '';
  $('kjFavToggle').setAttribute('aria-pressed', state.favoritesOnly ? 'true' : 'false');
}

/* ---- Grade helpers ---- */
function gradeBucket(g){
  if(g >= 1 && g <= 6) return g;
  if(g === 8) return 8;
  return 99; // covers grade 9, 10 (jinmeiyou), and ungraded JIS X0208 kanji -> shown as 高校
}
function gradeLabel(g){
  const b = gradeBucket(g);
  if(b === 8) return '中学';
  if(b === 99) return '高校';
  return '小' + b;
}
function gradeEn(g){
  const b = gradeBucket(g);
  if(b === 8) return 'Junior high';
  if(b === 99) return 'High school & above';
  return 'Elementary ' + b;
}

/* ---- Reading helpers ---- */
// 'た.べる' -> stem + faint dot + okurigana (the part after the dot is the kana that follows the kanji)
function fmtReading(r){
  const i = r.indexOf('.');
  if(i < 0) return esc(r);
  return esc(r.slice(0, i)) + '<i class="sep">.</i><span class="okuri">' + esc(r.slice(i + 1)) + '</span>';
}
function kataToHira(s){ return s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60)); }
function normReading(r){ return kataToHira(String(r)).replace(/[.\-\s]/g, ''); }
function normStem(r){ return kataToHira(String(r).split('.')[0]).replace(/[\-\s]/g, ''); }

/* =====================================================================
   Search (readings first, then meanings, then words)
   ===================================================================== */
let searchReady = false;
function ensureSearchIndex(){
  if(searchReady) return;
  KANJI_DATA.forEach((k, i) => {
    const rds = k.on.concat(k.kun);
    k._i = i;
    k._full = rds.map(normReading);
    k._stem = rds.map(normStem);
    k._mean = k.meanings_en.map(m => m.toLowerCase());
    k._rad = (k.radical_meaning_en || '').toLowerCase();
    k._jl = (k.jlpt || '').toLowerCase();
    k._comp = (k.compounds || []).map(c => c.word + ' ' + normReading(c.reading) + ' ' + String(c.meaning_en).toLowerCase()).join('|');
  });
  searchReady = true;
}

/* tier 0 = the kanji itself, 1 = reading matches exactly, 2 = reading starts with the text,
   3 = English word / JLPT level / radical match, 4 = contained in a reading or meaning, 5 = found only in a word that uses it. -1 = no match */
function searchTier(k, q, qr){
  if(q.length <= 8 && q.includes(k.kanji)) return 0;
  const full = k._full, stem = k._stem;
  for(let i = 0; i < full.length; i++){ if(full[i] === qr || stem[i] === qr) return 1; }
  for(let i = 0; i < full.length; i++){ if(full[i].startsWith(qr)) return 2; }
  if(k._jl === q || k.radical === q) return 3;
  for(const m of k._mean){ if(m === q || m.split(/[\s,;()\/]+/).includes(q)) return 3; }
  if(full.some(r => r.includes(qr)) || k._mean.some(m => m.includes(q)) || k._rad.includes(q)) return 4;
  if(k._comp.includes(q) || k._comp.includes(qr)) return 5;
  return -1;
}

function hasCondition(){
  return !!(state.query.trim() || state.strokeFilter || state.radicalFilter || state.jlptFilter || state.gradeFilter !== null || state.favoritesOnly);
}

function applyFilters(){
  const cond = hasCondition();
  if(!cond){
    state.filtered = [];
    state.shown = 0;
    renderGrid(false);
    renderCount();
    return;
  }
  let list = KANJI_DATA.filter(k => {
    if(state.favoritesOnly && !favorites.has(k.kanji)) return false;
    if(state.strokeFilter && k.strokeCount !== state.strokeFilter) return false;
    if(state.radicalFilter && k.radical !== state.radicalFilter) return false;
    if(state.jlptFilter && k.jlpt !== state.jlptFilter) return false;
    if(state.gradeFilter !== null && gradeBucket(k.grade) !== state.gradeFilter) return false;
    return true;
  });
  const q = kataToHira(state.query.trim().toLowerCase());
  if(q){
    ensureSearchIndex();
    const qr = q.replace(/[.\-\s]/g, '') || q;
    const scored = [];
    list.forEach(k => {
      const t = searchTier(k, q, qr);
      if(t >= 0) scored.push({ k, t, p: t === 0 ? q.indexOf(k.kanji) : 0 });
    });
    scored.sort((a, b) => (a.t - b.t) || (a.p - b.p) || (a.k._i - b.k._i));
    list = scored.map(s => s.k);
  }
  state.filtered = list;
  state.shown = 0;
  renderGrid(false);
  renderCount();
}

function renderCount(){
  const el = $('kjCount');
  const clearBtn = $('kjClearFilters');
  if(!hasCondition()){
    el.textContent = `全${KANJI_DATA.length}字 / ${KANJI_DATA.length} kanji in total`;
    clearBtn.disabled = true;
    return;
  }
  clearBtn.disabled = false;
  const n = state.filtered.length;
  let t = `${n}字 見つかりました / ${n} found`;
  if(n > state.shown) t += `（${state.shown}字を表示中 / showing ${state.shown}）`;
  el.textContent = t;
}

/* =====================================================================
   Result grid (100 cards at a time) and home tiles
   ===================================================================== */
function buildStaticGlyph(k){
  return `<svg class="kanji-glyph" viewBox="0 0 109 109" xmlns="http://www.w3.org/2000/svg">${k.strokes.map(d=>`<path d="${d}"/>`).join('')}</svg>`;
}

function cardReadings(k){
  const kun = k.kun.slice(0, 3).map(fmtReading).join('　') + (k.kun.length > 3 ? '…' : '');
  const on = k.on.slice(0, 2).map(fmtReading).join('　') + (k.on.length > 2 ? '…' : '');
  return (kun ? `<span class="rd-kun">${kun}</span>` : '') + (on ? `<span class="rd-on">${on}</span>` : '');
}

function renderGrid(append){
  const grid = $('kjGrid');
  const results = $('kjResults');
  const home = $('kjHome');
  const more = $('kjMore');
  const cond = hasCondition();

  home.style.display = cond ? 'none' : '';
  results.classList.toggle('show', cond);
  if(!cond){ grid.innerHTML = ''; more.innerHTML = ''; return; }

  if(!append){ grid.innerHTML = ''; state.shown = 0; }

  if(state.filtered.length === 0){
    const msg = (state.favoritesOnly && favorites.size === 0)
      ? 'お気に入りはまだありません。漢字のページを開いて☆マークを押すと、ここに追加されます。<small>No favorites yet. Open a kanji and tap the star to add it here.</small>'
      : '見つかりませんでした。検索語や絞り込みを変えてみてください。<small>Nothing found. Try another word or change the filters.</small>';
    grid.innerHTML = `<div class="kj-empty" style="grid-column:1/-1">${msg}</div>`;
    more.innerHTML = '';
    return;
  }

  const from = state.shown;
  const to = Math.min(state.filtered.length, from + PAGE_SIZE);
  const frag = document.createDocumentFragment();
  for(let i = from; i < to; i++){
    const k = state.filtered[i];
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'kj-card';
    card.setAttribute('aria-label', k.kanji + '　' + k.strokeCount + '画 ' + k.jlpt);
    card.innerHTML = `
      <span class="jlpt-tag ${jlptCls(k.jlpt)}">${esc(k.jlpt)}</span>
      <span class="stamp" title="${k.strokeCount}画 / ${k.strokeCount} strokes">${k.strokeCount}</span>
      <span class="cell">${buildStaticGlyph(k)}</span>
      <span class="info">
        <span class="reading">${cardReadings(k)}</span>
        <span class="meaning-en">${esc(k.meanings_en.slice(0,2).join(', '))}</span>
      </span>`;
    card.addEventListener('click', () => openModal(k));
    frag.appendChild(card);
  }
  grid.appendChild(frag);
  state.shown = to;

  const left = state.filtered.length - to;
  more.innerHTML = '';
  if(left > 0){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kj-btn solid c-green';
    btn.innerHTML = `${icon('plus')}<span class="lb"><b>もっと見る（残り${left}字）</b><small>Show more (${left} left)</small></span>`;
    btn.addEventListener('click', () => { renderGrid(true); renderCount(); });
    more.appendChild(btn);
  }
}

function renderHomeTiles(){
  const gradeCount = {}, jlptCount = {};
  KANJI_DATA.forEach(k => {
    const b = gradeBucket(k.grade);
    gradeCount[b] = (gradeCount[b] || 0) + 1;
    jlptCount[k.jlpt] = (jlptCount[k.jlpt] || 0) + 1;
  });

  const gw = $('kjGradeTiles'); gw.innerHTML = '';
  [1,2,3,4,5,6,8,99].forEach(g => {
    if(!gradeCount[g]) return;
    const t = document.createElement('button');
    t.type = 'button'; t.className = 'kj-tile c-pink';
    const jp = g === 8 ? '中学' : (g === 99 ? '高校〜' : '小学' + g + '年');
    t.innerHTML = `<span class="bd">${esc(gradeLabel(g))}</span><span class="tx"><b>${jp}</b><small>${gradeEn(g)}</small><span class="n">${gradeCount[g]}字</span></span>`;
    t.addEventListener('click', () => { state.gradeFilter = g; syncChips(); applyFilters(); scrollToFilters(); });
    gw.appendChild(t);
  });

  const jw = $('kjJlptTiles'); jw.innerHTML = '';
  ['N5','N4','N3','N2','N1','対象外'].forEach(l => {
    if(!jlptCount[l]) return;
    const t = document.createElement('button');
    t.type = 'button'; t.className = 'kj-tile ' + jlptCls(l);
    t.innerHTML = `<span class="bd">${l === '対象外' ? '－' : l}</span><span class="tx"><b>${l === '対象外' ? '対象外' : 'JLPT ' + l}</b><small>${JLPT_HINT[l]}</small><span class="n">${jlptCount[l]}字</span></span>`;
    t.addEventListener('click', () => { state.jlptFilter = l; syncChips(); applyFilters(); scrollToFilters(); });
    jw.appendChild(t);
  });
}

function scrollToFilters(){
  const el = document.querySelector('.kj-filters');
  if(el) el.scrollIntoView({ behavior:'smooth', block:'start' });
}

/* =====================================================================
   Filter chips
   ===================================================================== */
function makeChip(label, cls, kind, value, onClick){
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip' + (cls ? ' ' + cls : '');
  b.textContent = label;
  b.dataset.kind = kind;
  b.dataset.v = String(value);
  b.setAttribute('aria-pressed', 'false');
  b.addEventListener('click', onClick);
  return b;
}
function syncChips(){
  const on = { stroke:String(state.strokeFilter), jlpt:String(state.jlptFilter), grade:String(state.gradeFilter) };
  document.querySelectorAll('.chip[data-kind]').forEach(el => {
    const active = on[el.dataset.kind] === el.dataset.v;
    el.classList.toggle('on', active);
    el.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  $('kjRadicalSelect').value = state.radicalFilter || '';
}
function renderStrokeChips(){
  const counts = Array.from(new Set(KANJI_DATA.map(k=>k.strokeCount))).sort((a,b)=>a-b);
  const wrap = $('kjStrokeChips');
  counts.forEach(c => {
    wrap.appendChild(makeChip(c + '画', '', 'stroke', c, () => {
      state.strokeFilter = (state.strokeFilter === c) ? null : c;
      syncChips(); applyFilters();
    }));
  });
}
function renderRadicalChips(){
  // ~200 distinct radicals are too many for a chip row, so the radical filter is a <select>.
  const counts = {};
  KANJI_DATA.forEach(k => { counts[k.radical] = (counts[k.radical]||0) + 1; });
  const rads = Array.from(new Set(KANJI_DATA.map(k=>k.radical))).sort((a,b) => a.localeCompare(b, 'ja'));
  const select = $('kjRadicalSelect');
  rads.forEach(r => {
    const k = KANJI_DATA.find(x => x.radical === r);
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = `${r} (${k.radical_meaning_en}) ・${counts[r]}字`;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    state.radicalFilter = select.value || null;
    applyFilters();
  });
}
function renderGradeChips(){
  const grades = Array.from(new Set(KANJI_DATA.map(k=>gradeBucket(k.grade)))).sort((a,b)=>a-b);
  const wrap = $('kjGradeChips');
  grades.forEach(g => {
    wrap.appendChild(makeChip(gradeLabel(g), '', 'grade', g, () => {
      state.gradeFilter = (state.gradeFilter === g) ? null : g;
      syncChips(); applyFilters();
    }));
  });
}
function renderJlptChips(){
  const order = ['N5','N4','N3','N2','N1','対象外'];
  const levels = Array.from(new Set(KANJI_DATA.map(k=>k.jlpt))).sort((a,b) => order.indexOf(a) - order.indexOf(b));
  const wrap = $('kjJlptChips');
  levels.forEach(l => {
    wrap.appendChild(makeChip(l, jlptCls(l), 'jlpt', l, () => {
      state.jlptFilter = (state.jlptFilter === l) ? null : l;
      syncChips(); applyFilters();
    }));
  });
}

/* =====================================================================
   Search box, reset, favorites, study mode, panels
   ===================================================================== */
let searchTimer = null;
function onQueryChanged(immediate){
  const inp = $('kjSearchInput');
  state.query = inp.value;
  $('kjSearchClear').classList.toggle('show', inp.value.length > 0);
  clearTimeout(searchTimer);
  if(immediate) applyFilters();
  else searchTimer = setTimeout(applyFilters, 130);
}
$('kjSearchInput').addEventListener('input', () => onQueryChanged(false));
$('kjSearchClear').addEventListener('click', () => { $('kjSearchInput').value = ''; onQueryChanged(true); $('kjSearchInput').focus(); });

function resetAll(){
  state.strokeFilter = null; state.radicalFilter = null; state.jlptFilter = null; state.gradeFilter = null; state.query = ""; state.favoritesOnly = false;
  $('kjSearchInput').value = "";
  $('kjSearchClear').classList.remove('show');
  syncChips();
  updateFavToggleLabel();
  applyFilters();
}
$('kjClearFilters').addEventListener('click', resetAll);

const PANELS = [
  { btn:'kjKanaToggle',    panel:'kjKanaPanel' },
  { btn:'kjHwToggle',      panel:'kjHwPanel' },
  { btn:'kjJukugoToggle',  panel:'kjJukugoPanel' }
];
function closePanels(exceptPanel){
  PANELS.forEach(p => {
    if(p.panel === exceptPanel) return;
    $(p.panel).classList.remove('show');
    $(p.btn).setAttribute('aria-pressed', 'false');
  });
}
function togglePanel(panelId, btnId){
  const el = $(panelId);
  closePanels(panelId);
  el.classList.toggle('show');
  const open = el.classList.contains('show');
  $(btnId).setAttribute('aria-pressed', open ? 'true' : 'false');
  return open;
}

$('kjHomeLink').addEventListener('click', () => {
  closePanels(null);
  jukugoReset();
  if($('kjFullscreen').classList.contains('show')) closeFullscreen();
  closeModal();
  resetAll();
  window.scrollTo({top:0, behavior:'smooth'});
});

$('kjFavToggle').addEventListener('click', () => {
  state.favoritesOnly = !state.favoritesOnly;
  updateFavToggleLabel();
  applyFilters();
});

$('kjStudyModeToggle').addEventListener('click', () => {
  studyModeActive = !studyModeActive;
  $('kjStudyModeToggle').setAttribute('aria-pressed', studyModeActive ? 'true' : 'false');
});

/* =====================================================================
   Kana keyboard (五十音表): tap letters to fill the search box
   ===================================================================== */
const KANA_TABS = {
  basic: { cls:'t-basic', rows:[
    ['あ','い','う','え','お'], ['か','き','く','け','こ'], ['さ','し','す','せ','そ'], ['た','ち','つ','て','と'], ['な','に','ぬ','ね','の'],
    ['は','ひ','ふ','へ','ほ'], ['ま','み','む','め','も'], ['や','','ゆ','','よ'], ['ら','り','る','れ','ろ'], ['わ','','','','を'] ] },
  voiced: { cls:'t-voiced', rows:[
    ['が','ぎ','ぐ','げ','ご'], ['ざ','じ','ず','ぜ','ぞ'], ['だ','ぢ','づ','で','ど'], ['ば','び','ぶ','べ','ぼ'], ['ぱ','ぴ','ぷ','ぺ','ぽ'] ] },
  contracted: { cls:'t-contracted', rows:[
    ['きゃ','きゅ','きょ'], ['しゃ','しゅ','しょ'], ['ちゃ','ちゅ','ちょ'], ['にゃ','にゅ','にょ'], ['ひゃ','ひゅ','ひょ'], ['みゃ','みゅ','みょ'],
    ['りゃ','りゅ','りょ'], ['ぎゃ','ぎゅ','ぎょ'], ['じゃ','じゅ','じょ'], ['びゃ','びゅ','びょ'], ['ぴゃ','ぴゅ','ぴょ'] ] }
};
function kanaInsert(ch){
  const inp = $('kjSearchInput');
  inp.value += ch;
  onQueryChanged(true);
}
function kanaBackspace(){
  const inp = $('kjSearchInput');
  inp.value = Array.from(inp.value).slice(0, -1).join('');
  onQueryChanged(true);
}
function renderKanaTab(name){
  const def = KANA_TABS[name];
  const box = $('kjKanaKeys');
  box.className = 'kj-kana-keys ' + def.cls;
  box.innerHTML = '';
  def.rows.forEach(row => row.forEach(ch => {
    const b = document.createElement('button');
    b.type = 'button';
    if(!ch){ b.className = 'kj-key blank'; b.tabIndex = -1; b.setAttribute('aria-hidden', 'true'); }
    else { b.className = 'kj-key'; b.textContent = ch; b.addEventListener('click', () => kanaInsert(ch)); }
    box.appendChild(b);
  }));
  document.querySelectorAll('#kjKanaPanel .kj-kana-tabs button').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false'));
}
function buildKanaSpecial(){
  const box = $('kjKanaSpecial');
  box.innerHTML = '';
  ['ん','っ','ー','ゃ','ゅ','ょ'].forEach(ch => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'kj-key'; b.textContent = ch;
    b.addEventListener('click', () => kanaInsert(ch));
    box.appendChild(b);
  });
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'kj-key act del';
  del.innerHTML = `${icon('backspace')}<span>1文字消す<br><small>Delete</small></span>`;
  del.addEventListener('click', kanaBackspace);
  box.appendChild(del);
  const clr = document.createElement('button');
  clr.type = 'button'; clr.className = 'kj-key act clr';
  clr.innerHTML = `${icon('rotate')}<span>全部消す<br><small>Clear</small></span>`;
  clr.addEventListener('click', () => { $('kjSearchInput').value = ''; onQueryChanged(true); });
  box.appendChild(clr);
}
document.querySelectorAll('#kjKanaPanel .kj-kana-tabs button').forEach(t => t.addEventListener('click', () => renderKanaTab(t.dataset.tab)));
$('kjKanaToggle').addEventListener('click', () => { togglePanel('kjKanaPanel', 'kjKanaToggle'); });
renderKanaTab('basic');
buildKanaSpecial();

/* =====================================================================
   Detail modal + stroke order animation
   ===================================================================== */
let currentAnimSpeed = 700;
let currentModalKanji = null;
let modalHistory = [];

function renderCompoundsList(container, k){
  container.innerHTML = '';
  if(!k.compounds || k.compounds.length === 0){
    container.innerHTML = '<div class="none">この漢字が使われる一般的な熟語は見つかりませんでした（単独で使われることが多い漢字です）。<br>No common words found. This kanji is often used alone.</div>';
    return;
  }
  k.compounds.forEach(c => {
    const row = document.createElement('div');
    row.className = 'kj-compound-item';
    const wordHtml = Array.from(c.word).map(ch => {
      if(ch === k.kanji) return `<span class="wc current">${esc(ch)}</span>`;
      if(kanjiMap.has(ch)) return `<span class="wc link" data-kanji="${esc(ch)}">${esc(ch)}</span>`;
      return `<span class="wc">${esc(ch)}</span>`;
    }).join('');
    row.innerHTML = `<span class="word">${wordHtml}</span><span class="reading">${esc(c.reading)}</span><span class="gloss">${esc(c.meaning_en)}</span>`;
    container.appendChild(row);
  });
}

function buildStrokeSvg(container, strokes){
  container.querySelectorAll('svg').forEach(el=>el.remove());
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 109 109');
  svg.classList.add('kanji-glyph');
  const g = document.createElementNS(svgNS, 'g');
  const pathEls = [];
  strokes.forEach(d => { const p = document.createElementNS(svgNS,'path'); p.setAttribute('d', d); g.appendChild(p); pathEls.push(p); });
  svg.appendChild(g); container.appendChild(svg);
  return pathEls;
}

/* The 6 information tiles (shared by the modal and the fullscreen view) */
function infoTile(cls, ic, jp, en, valueHtml){
  return `<div class="kj-info ${cls}"><span class="bd">${icon(ic)}</span><div class="tx"><span class="k">${jp} <small>${en}</small></span><span class="v">${valueHtml}</span></div></div>`;
}
function renderInfoTiles(container, k){
  const on = k.on.length ? k.on.map(fmtReading).join('、') : '－';
  const kun = k.kun.length ? k.kun.map(fmtReading).join('、') : '－';
  container.innerHTML = [
    infoTile('c-orange', 'hash', '画数', 'Strokes', `${k.strokeCount}<span class="sub"> 画</span>`),
    infoTile('c-blue', 'grid', '部首', 'Radical', `${esc(k.radical)} <span class="sub">${esc(k.radical_meaning_en)}</span>`),
    infoTile('c-purple', 'volume', '音読み', 'On-yomi', on),
    infoTile('c-green', 'book', '訓読み', 'Kun-yomi', kun),
    infoTile(jlptCls(k.jlpt), 'award', 'JLPT', 'Level', `<span class="lvl">${esc(k.jlpt)}</span>`),
    infoTile('c-pink', 'cap', '学年', 'Grade', `${gradeLabel(k.grade)} <span class="sub">${gradeEn(k.grade)}</span>`)
  ].join('');
}
function hlSentence(text, kanji){
  return esc(text).split(esc(kanji)).join(`<span class="hl">${esc(kanji)}</span>`);
}
function setStarButton(btn, isFav){
  btn.classList.toggle('active', isFav);
  btn.setAttribute('aria-pressed', isFav ? 'true' : 'false');
  btn.title = isFav ? 'お気に入りから削除 / Remove from favorites' : 'お気に入りに登録 / Add to favorites';
}

function openModal(k, opts){
  opts = opts || {};
  if(k.isKana){
    renderKanaModal(k, opts);
    return;
  }
  if(studyModeActive){
    openFullscreen(k);
    return;
  }
  if(!opts.fromHistory){
    // starting a fresh lookup (from the grid, search, or handwriting results) resets the trail
    modalHistory = [];
  }
  currentModalKanji = k;
  $('kjModalBack').style.display = modalHistory.length > 0 ? '' : 'none';

  const modalEl = document.querySelector('.kj-modal');
  if(modalEl) modalEl.scrollTop = 0;
  $('kjModalKanjiRows').style.display = '';
  $('kjModalKanaRow').style.display = 'none';
  $('kjModalCompoundsBox').style.display = '';

  $('kjModalMeaning').textContent = k.meanings_en.join(', ');
  renderInfoTiles($('kjModalTiles'), k);

  const exBox = $('kjModalExampleBox');
  if(k.ex_ja){
    exBox.style.display = '';
    $('kjModalExJa').innerHTML = hlSentence(k.ex_ja, k.kanji);
    $('kjModalExEn').textContent = k.ex_en || '';
  } else {
    exBox.style.display = 'none';
  }

  renderCompoundsList($('kjModalCompounds'), k);

  // Show the modal BEFORE building/measuring the stroke SVG. path.getTotalLength()
  // (used by playAnimation) can return an incorrect length — often 0 — when called on an
  // element that's still inside a display:none ancestor. Flip the overlay visible first,
  // then force a synchronous layout flush so the browser has a real layout to measure.
  const overlayEl = $('kjOverlay');
  overlayEl.classList.add('show');
  void overlayEl.offsetHeight;

  const pathEls = buildStrokeSvg($('kjStage'), k.strokes);
  currentAnimSpeed = 700;
  playAnimation(pathEls);
  $('kjReplay').onclick = () => playAnimation(pathEls);
  $('kjSlow').onclick = () => { currentAnimSpeed = 1400; playAnimation(pathEls); };
  $('kjCopyKanji').onclick = () => copyTextToClipboard(k.kanji, $('kjCopyKanji'));

  const starBtn = $('kjModalStar');
  setStarButton(starBtn, favorites.has(k.kanji));
  starBtn.onclick = () => { toggleFavorite(k.kanji); setStarButton(starBtn, favorites.has(k.kanji)); };
}

/* Hiragana get a deliberately minimal version of the same modal: just the
   character, its stroke-order animation, and copy/favorite — no readings,
   meaning, JLPT, example sentence, or compounds, since none of that applies. */
function renderKanaModal(k, opts){
  opts = opts || {};
  if(!opts.fromHistory){
    modalHistory = [];
  }
  currentModalKanji = k;
  $('kjModalBack').style.display = modalHistory.length > 0 ? '' : 'none';

  const modalEl = document.querySelector('.kj-modal');
  if(modalEl) modalEl.scrollTop = 0;
  $('kjModalKanjiRows').style.display = 'none';
  $('kjModalKanaRow').style.display = '';
  $('kjModalExampleBox').style.display = 'none';
  $('kjModalCompoundsBox').style.display = 'none';
  $('kjModalKanaStroke').innerHTML = `${k.strokeCount}<span class="sub"> 画</span>`;

  const overlayEl = $('kjOverlay');
  overlayEl.classList.add('show');
  void overlayEl.offsetHeight;

  const pathEls = buildStrokeSvg($('kjStage'), k.strokes);
  currentAnimSpeed = 700;
  playAnimation(pathEls);
  $('kjReplay').onclick = () => playAnimation(pathEls);
  $('kjSlow').onclick = () => { currentAnimSpeed = 1400; playAnimation(pathEls); };
  $('kjCopyKanji').onclick = () => copyTextToClipboard(k.kanji, $('kjCopyKanji'));

  const starBtn = $('kjModalStar');
  setStarButton(starBtn, favorites.has(k.kanji));
  starBtn.onclick = () => { toggleFavorite(k.kanji); setStarButton(starBtn, favorites.has(k.kanji)); };
}

function playAnimation(pathEls){
  // 1) Instantly hide every stroke (no transition yet).
  pathEls.forEach(p => {
    const len = p.getTotalLength();
    p.style.transition = 'none';
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
  });
  // 2) Wait two animation frames before starting the transition so the browser has
  //    really painted the "hidden" state first (otherwise the first strokes can skip their draw-in).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pathEls.forEach((p, i) => {
        p.style.transition = `stroke-dashoffset ${currentAnimSpeed}ms ease-in-out`;
        p.style.transitionDelay = (i * currentAnimSpeed) + 'ms';
        p.style.strokeDashoffset = 0;
      });
    });
  });
}

function copyTextToClipboard(text, btn){
  const original = btn.innerHTML;
  const flash = (html, cls) => {
    btn.innerHTML = html;
    if(cls) btn.classList.add(cls);
    setTimeout(() => { btn.innerHTML = original; if(cls) btn.classList.remove(cls); }, 1500);
  };
  const showCopied = () => flash(`${icon('check')}<span class="lb"><b>コピーしました</b><small>Copied</small></span>`, 'copied');
  const showFailed = () => flash(`<span class="lb"><b>コピーできませんでした</b><small>Could not copy</small></span>`, null);

  if(navigator.clipboard && window.isSecureContext){
    navigator.clipboard.writeText(text).then(showCopied).catch(() => fallbackCopy(text, showCopied, showFailed));
  } else {
    fallbackCopy(text, showCopied, showFailed);
  }
}

function fallbackCopy(text, onSuccess, onFail){
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    ok ? onSuccess() : onFail();
  } catch(e){
    onFail();
  }
}
$('kjModalClose').addEventListener('click', closeModal);
$('kjOverlay').addEventListener('click', e => { if(e.target.id === 'kjOverlay') closeModal(); });
$('kjModalCompounds').addEventListener('click', e => {
  const el = e.target.closest('.wc.link');
  if(!el) return;
  const entry = kanjiMap.get(el.dataset.kanji);
  if(entry){
    if(currentModalKanji) modalHistory.push(currentModalKanji);
    openModal(entry, {fromHistory:true});
  }
});
$('kjModalBack').addEventListener('click', () => {
  const prev = modalHistory.pop();
  if(prev) openModal(prev, {fromHistory:true});
});
function closeModal(){ $('kjOverlay').classList.remove('show'); }
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if($('kjFullscreen').classList.contains('show')) closeFullscreen();
  else closeModal();
});

/* =====================================================================
   Fullscreen lesson mode (with A− / A＋ text size)
   ===================================================================== */
let fsCurrentKanji = null;
let fsMode = 'normal'; // 'normal' | 'reading' | 'writing'
let fsSelectedWord = null;
let fsRevealed = false;

const FS_SCALE_KEY = 'hitsujun-fs-scale';
let fsScale = 1;
try{ const v = parseFloat(localStorage.getItem(FS_SCALE_KEY)); if(v >= 0.8 && v <= 1.6) fsScale = v; } catch(e){ /* ignore */ }
function applyFsScale(){
  fsScale = Math.round(fsScale * 10) / 10;
  $('kjFullscreen').style.setProperty('--s', fsScale);
  $('kjFsSizeOut').textContent = Math.round(fsScale * 100) + '%';
  $('kjFsSmaller').disabled = fsScale <= 0.8;
  $('kjFsLarger').disabled = fsScale >= 1.6;
  try{ localStorage.setItem(FS_SCALE_KEY, String(fsScale)); } catch(e){ /* ignore */ }
}
$('kjFsSmaller').addEventListener('click', () => { fsScale -= 0.1; applyFsScale(); });
$('kjFsLarger').addEventListener('click', () => { fsScale += 0.1; applyFsScale(); });
applyFsScale();

function setFsMode(mode){
  fsMode = mode;
  $('kjFullscreen').dataset.mode = mode;
  document.querySelectorAll('.kj-fs-modebtn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
}

function openFullscreen(k){
  fsCurrentKanji = k;
  fsSelectedWord = null;
  fsRevealed = false;
  setFsMode('normal');
  $('kjFsNormal').style.display = 'flex';
  $('kjFsStudyView').style.display = 'none';
  document.body.style.overflow = 'hidden';

  // Show the fullscreen panel and force a layout flush BEFORE renderFsNormal builds/measures the stroke SVG.
  const fsEl = $('kjFullscreen');
  fsEl.classList.add('show');
  void fsEl.offsetHeight;

  renderFsNormal(k);
}

function closeFullscreen(){
  $('kjFullscreen').classList.remove('show');
  document.body.style.overflow = '';
}

$('kjFsClose').addEventListener('click', closeFullscreen);

function renderFsNormal(k){
  $('kjFsMeaning').textContent = k.meanings_en.join(', ');
  renderInfoTiles($('kjFsTiles'), k);

  const exBox = $('kjFsExample');
  if(k.ex_ja){
    exBox.style.display = '';
    $('kjFsExJa').innerHTML = hlSentence(k.ex_ja, k.kanji);
    $('kjFsExEn').textContent = k.ex_en || '';
  } else {
    exBox.style.display = 'none';
  }

  renderCompoundsList($('kjFsCompoundsList'), k);

  const pathEls = buildStrokeSvg($('kjFsStage'), k.strokes);
  currentAnimSpeed = 700;
  playAnimation(pathEls);
  $('kjFsReplay').onclick = () => playAnimation(pathEls);
  $('kjFsSlow').onclick = () => { currentAnimSpeed = 1400; playAnimation(pathEls); };
  $('kjFsCopy').onclick = () => copyTextToClipboard(k.kanji, $('kjFsCopy'));

  const starBtn = $('kjFsStar');
  const setFsStarUI = () => starBtn.setAttribute('aria-pressed', favorites.has(k.kanji) ? 'true' : 'false');
  setFsStarUI();
  starBtn.onclick = () => { toggleFavorite(k.kanji); setFsStarUI(); };
}

$('kjFsCompoundsList').addEventListener('click', e => {
  const el = e.target.closest('.wc.link');
  if(!el) return;
  const entry = kanjiMap.get(el.dataset.kanji);
  if(entry) openFullscreen(entry);
});

document.querySelectorAll('.kj-fs-modebtn').forEach(btn => {
  btn.addEventListener('click', () => {
    setFsMode(btn.dataset.mode);
    if(fsMode === 'normal'){
      $('kjFsNormal').style.display = 'flex';
      $('kjFsStudyView').style.display = 'none';
    } else {
      $('kjFsNormal').style.display = 'none';
      $('kjFsStudyView').style.display = 'flex';
      fsSelectedWord = null;
      fsRevealed = false;
      renderFsWordList();
      renderFsStage();
    }
  });
});

function renderFsWordList(){
  const box = $('kjFsWordList');
  box.innerHTML = '';
  const words = (fsCurrentKanji && fsCurrentKanji.study_words) || [];
  if(words.length === 0){
    box.innerHTML = '<div class="kj-fs-empty">この漢字には学習用の言葉が見つかりませんでした。<br>No study words for this kanji.</div>';
    return;
  }
  words.forEach(w => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'kj-fs-word-chip' + (fsSelectedWord === w ? ' selected' : '');
    const cardLabel = fsMode === 'writing' ? w.reading : w.word;
    chip.innerHTML = `${esc(cardLabel)}<span class="tag">${w.type === 'kun' ? '訓読み / Kun-yomi' : '熟語 / Word'}</span>`;
    chip.addEventListener('click', () => {
      fsSelectedWord = w;
      fsRevealed = false;
      renderFsWordList();
      renderFsStage();
    });
    box.appendChild(chip);
  });
}

const FONT_KANJI = "'Klee One', sans-serif";
const FONT_KANA = "'Klee One', sans-serif";

function renderFsStage(){
  const back = $('kjFsBack');
  const front = $('kjFsFront');
  const meaning = $('kjFsWordMeaning');
  const stage = $('kjFsStage2');

  if(!fsSelectedWord){
    front.textContent = '言葉を選んでください';
    front.style.fontFamily = FONT_KANA;
    front.style.fontSize = 'calc(48px * var(--s))';
    back.textContent = '';
    meaning.textContent = 'Choose a word below';
    stage.onclick = null;
    return;
  }

  const w = fsSelectedWord;
  meaning.textContent = w.meaning_en;

  if(fsMode === 'reading'){
    // kanji word always shown big; reading revealed on click, above, at ~1/4 size
    front.textContent = w.word;
    front.style.fontFamily = FONT_KANJI;
    front.style.fontSize = 'calc(min(18vw, 22vh, 200px) * var(--s))';
    back.style.fontFamily = FONT_KANA;
    back.style.fontSize = 'calc(min(4.5vw, 5.5vh, 50px) * var(--s))';
    back.textContent = fsRevealed ? w.reading : '';
  } else {
    // writing mode: reading always shown; kanji revealed on click, above, prominently
    front.textContent = w.reading;
    front.style.fontFamily = FONT_KANA;
    front.style.fontSize = 'calc(min(11vw, 13vh, 110px) * var(--s))';
    back.style.fontFamily = FONT_KANJI;
    back.style.fontSize = 'calc(min(18vw, 22vh, 200px) * var(--s))';
    back.textContent = fsRevealed ? w.word : '';
  }

  stage.onclick = () => {
    fsRevealed = !fsRevealed;
    renderFsStage();
  };
}

/* ================= Handwriting recognition ================================
   Uses "DaKanji Single Kanji Recognition" (CaptainDario, MIT license): a CNN
   (EfficientNet-Lite0) trained on the ETL Character Database + KanjiVG,
   covering 6,507 characters (kanji / hiragana / katakana). The SavedModel was
   converted to a uint8-quantized TensorFlow.js graph model and is embedded
   directly in this page (loaded from memory, no external model server),
   so recognition runs fully offline in the browser once the page has loaded.
   Because it is a real trained classifier (not a shape-matching heuristic),
   it tolerates wrong stroke order, wrong stroke count, and messy handwriting
   much better than a geometric matcher. */

let dakanjiModel = null;
let dakanjiLoading = null;

function setHwStatus(text, loading){
  const el = document.getElementById('kjHwStatus');
  el.classList.toggle('loading', !!loading);
  el.querySelector('.txt').textContent = text;
}

let DAKANJI_LABELS = null;

async function loadDaKanjiModel(){
  if(dakanjiModel) return dakanjiModel;
  if(dakanjiLoading) return dakanjiLoading;
  dakanjiLoading = (async () => {
    setHwStatus('認識モデルを読み込み中…（初回のみ、通信します） / Loading the AI model (first time only)…', true);
    const [model, labels] = await Promise.all([
      tf.loadGraphModel('./model/model.json'),
      fetch('./model/labels.json').then(r => r.json())
    ]);
    dakanjiModel = model;
    DAKANJI_LABELS = labels;
    setHwStatus('読み込み完了。書いて「認識する」を押してください。 / Ready. Write, then press Recognize.', false);
    return model;
  })();
  return dakanjiLoading;
}

function renderStrokesToInferenceCanvas(strokes, size){
  // Build a size x size grayscale image: black background, white strokes,
  // matching the convention the model was trained on (bright glyph on dark ground).
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0,0,size,size);

  if(strokes.length === 0) return c;

  // fit all strokes into the canvas with some margin, preserving aspect ratio
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  strokes.forEach(s => s.forEach(p => {
    minX=Math.min(minX,p.x); minY=Math.min(minY,p.y);
    maxX=Math.max(maxX,p.x); maxY=Math.max(maxY,p.y);
  }));
  const w = Math.max(1, maxX-minX), h = Math.max(1, maxY-minY);
  const margin = size * 0.14;
  const scale = Math.min((size - margin*2)/w, (size - margin*2)/h);
  const offX = (size - w*scale)/2 - minX*scale;
  const offY = (size - h*scale)/2 - minY*scale;

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(3, size*0.07);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  strokes.forEach(s => {
    if(s.length < 2){
      if(s.length===1){
        ctx.beginPath();
        ctx.arc(s[0].x*scale+offX, s[0].y*scale+offY, ctx.lineWidth/2, 0, Math.PI*2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
      return;
    }
    ctx.beginPath();
    ctx.moveTo(s[0].x*scale+offX, s[0].y*scale+offY);
    for(let i=1;i<s.length;i++) ctx.lineTo(s[i].x*scale+offX, s[i].y*scale+offY);
    ctx.stroke();
  });
  return c;
}

async function recognizeWithModel(strokes){
  const model = await loadDaKanjiModel();
  const canvas = renderStrokesToInferenceCanvas(strokes, 96);

  const results = tf.tidy(() => {
    let img = tf.browser.fromPixels(canvas, 1); // [H,W,1], uint8 (grayscale channel already replicated by fromPixels unless we pass numChannels=1 correctly)
    img = img.toFloat();
    const batched = img.expandDims(0); // [1,H,W,1]
    return batched;
  });

  let output;
  try{
    output = model.execute(results);
  } catch(e){
    output = await model.executeAsync(results);
  }
  const data = await output.data();
  results.dispose();
  output.dispose();

  const scored = Array.from(data).map((p, i) => ({ idx:i, prob:p }));
  scored.sort((a,b) => b.prob - a.prob);
  return scored.slice(0, 8).map(s => ({
    char: DAKANJI_LABELS[s.idx],
    prob: s.prob
  }));
}

/* ================= Kanji Canvas (shape-matching, V2 backup recognizer) =================
   DaKanji (the CNN above) is the primary recognizer. Kanji Canvas (asdfjkl/kanjicanvas,
   MIT license) uses a completely different, non-neural approach: it compares the drawn
   stroke shapes directly against a reference stroke database (derived from KanjiVG),
   tolerating imperfect stroke order/count. Testing showed the two make different mistakes,
   so here it is used only to *add* extra candidates DaKanji missed — never to replace or
   reorder DaKanji's own results. It reports no confidence score (just a ranked list), so
   its candidates are shown with a "形状候補" tag instead of a percentage. */

let kanjiCanvasRefLoading = null;
function loadKanjiCanvasRefPatterns(){
  // kanji-canvas.min.js itself pre-declares KanjiCanvas.refPatterns = [] (an empty
  // array), so a plain truthy check here would wrongly think the 6.4MB reference
  // data is already loaded and skip loading it. Check its length instead.
  if(window.KanjiCanvas && KanjiCanvas.refPatterns && KanjiCanvas.refPatterns.length > 0) return Promise.resolve();
  if(kanjiCanvasRefLoading) return kanjiCanvasRefLoading;
  kanjiCanvasRefLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = './model/kanjicanvas/ref-patterns.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load kanji canvas reference data'));
    document.head.appendChild(s);
  });
  return kanjiCanvasRefLoading;
}

const KC_HIDDEN_ID = 'kcHiddenCanvas';
let kcHiddenCanvasEl = null;
function ensureKcHiddenCanvas(){
  if(kcHiddenCanvasEl) return;
  kcHiddenCanvasEl = document.createElement('canvas');
  kcHiddenCanvasEl.width = 256; kcHiddenCanvasEl.height = 256;
  KanjiCanvas['canvas_'+KC_HIDDEN_ID] = kcHiddenCanvasEl;
  KanjiCanvas['ctx_'+KC_HIDDEN_ID] = kcHiddenCanvasEl.getContext('2d');
  KanjiCanvas['w_'+KC_HIDDEN_ID] = 256; KanjiCanvas['h_'+KC_HIDDEN_ID] = 256;
}

/* strokes: array of strokes captured by createDrawPad, in CSS-pixel space of a
   srcWidth x srcHeight canvas. Returns an ordered array of candidate characters
   (no confidence values available), or [] on any failure. */
async function getKanjiCanvasCandidates(strokes, srcWidth, srcHeight){
  if(!strokes || strokes.length === 0) return [];
  try{
    await loadKanjiCanvasRefPatterns();
  } catch(e){
    console.error(e);
    return [];
  }
  ensureKcHiddenCanvas();
  const sx = 255 / (srcWidth || 170);
  const sy = 255 / (srcHeight || 170);
  KanjiCanvas['recordedPattern_'+KC_HIDDEN_ID] = strokes.map(s => s.map(p => [p.x*sx, p.y*sy]));
  try{
    const result = KanjiCanvas.recognize(KC_HIDDEN_ID) || '';
    return result.trim().split(/\s+/).filter(Boolean);
  } catch(e){
    console.error(e);
    return [];
  }
}

/* Combine DaKanji's (up to 8) results with extra Kanji Canvas candidates DaKanji
   missed, up to MAX_TOTAL_CANDIDATES total. DaKanji's own ranking/scores are never
   altered — Kanji Canvas entries are only ever appended at the end. */
const MAX_TOTAL_CANDIDATES = 16;
async function recognizeCombined(strokes, srcWidth, srcHeight){
  const daResults = await recognizeWithModel(strokes); // [{char, prob}], up to 8
  const daChars = new Set(daResults.map(r => r.char));
  const kcChars = await getKanjiCanvasCandidates(strokes, srcWidth, srcHeight);
  const extra = kcChars
    .filter(c => !daChars.has(c))
    .slice(0, Math.max(0, MAX_TOTAL_CANDIDATES - daResults.length))
    .map(c => ({ char: c, source: 'shape' }));
  return daResults.map(r => ({ char: r.char, prob: r.prob, source: 'dakanji' })).concat(extra);
}

/* Shared rendering for both the standalone handwriting tool and the jukugo tool's
   per-character step. DaKanji entries show a confidence %; Kanji Canvas (shape-matching)
   entries have no real confidence value, so they get a "形状候補" tag instead — showing a
   fake percentage next to a real one would be misleading. */
function renderCandidateBox(box, results, onPick){
  box.innerHTML = '';
  results.forEach((r, i) => {
    const match = kanjiMap.get(r.char);
    const isShape = r.source === 'shape';
    const el = document.createElement('div');
    el.className = 'kj-hw-cand' + (i===0 && !isShape ? ' best' : '') + (match ? '' : ' notfound') + (isShape ? ' shape' : '');
    const scoreHtml = isShape ? `` : `<div class="score">${(r.prob*100).toFixed(0)}%</div>`;
    el.innerHTML = match
      ? `<div class="g">${buildStaticGlyph(match)}</div>${scoreHtml}`
      : `<div class="g">${r.char}</div>${scoreHtml}`;
    if(match && onPick){
      el.addEventListener('click', () => onPick(match));
    }
    box.appendChild(el);
  });
}

/* ---- generic draw pad factory (reused by the standalone handwriting tool and the jukugo tool) ---- */
function createDrawPad(canvas, wrapEl){
  const ratio = window.devicePixelRatio || 1;
  const rect = wrapEl.getBoundingClientRect();
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.strokeStyle = '#1F2A22'; ctx.lineWidth = 4; ctx.lineCap='round'; ctx.lineJoin='round';

  let strokes = [];
  let current = null;

  function pos(e){
    const r = canvas.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
    return {x:cx, y:cy};
  }
  function start(e){ e.preventDefault(); const p = pos(e); current = [p]; ctx.beginPath(); ctx.moveTo(p.x,p.y); }
  function move(e){ if(!current) return; e.preventDefault(); const p = pos(e); current.push(p); ctx.lineTo(p.x,p.y); ctx.stroke(); }
  function end(){ if(!current) return; if(current.length>=1) strokes.push(current); current=null; }
  canvas.onmousedown = start; canvas.onmousemove = move;
  window.addEventListener('mouseup', end);
  canvas.ontouchstart = start; canvas.ontouchmove = move; canvas.ontouchend = end;

  return {
    getStrokes: () => strokes,
    width: rect.width,
    height: rect.height,
    clear: () => { ctx.clearRect(0,0,canvas.width, canvas.height); strokes = []; current = null; }
  };
}


/* ---- handwriting pad UI (single-kanji lookup) ---- */
const hwToggle = $('kjHwToggle');
const hwPanel = $('kjHwPanel');
let hwModelPreloadStarted = false;
let hwPad = null;
hwToggle.addEventListener('click', () => {
  const open = togglePanel('kjHwPanel', 'kjHwToggle');
  if(open){
    hwPad = createDrawPad($('kjHwCanvas'), document.querySelector('.kj-hw-canvas-wrap'));
    if(!hwModelPreloadStarted){
      hwModelPreloadStarted = true;
      loadDaKanjiModel().catch(err => {
        console.error(err);
        setHwStatus('モデルの読み込みに失敗しました（通信環境をご確認ください）。 / Could not load the model. Please check your connection.', false);
      });
      loadKanjiCanvasRefPatterns().catch(err => console.error(err));
    }
  }
});

$('kjHwClear').onclick = () => {
  if(hwPad) hwPad.clear();
  setHwStatus('', false);
  $('kjHwResults').innerHTML = '';
};

$('kjHwRecognize').onclick = async () => {
  const strokes = hwPad ? hwPad.getStrokes() : [];
  if(strokes.length === 0){
    setHwStatus('まず枠の中に書いてください。 / Please write inside the box first.', false);
    return;
  }
  setHwStatus('認識しています… / Recognizing…', true);
  $('kjHwRecognize').disabled = true;
  try{
    const results = await recognizeCombined(strokes, hwPad.width, hwPad.height);
    setHwStatus('候補を表示しました（左ほど自信度が高い） / Results shown (most likely on the left)', false);
    const box = $('kjHwResults');
    renderCandidateBox(box, results, openModal);
    if(!results.some(r => kanjiMap.has(r.char))){
      const note = document.createElement('div');
      note.className = 'kj-hw-note';
      note.style.flexBasis = '100%';
      note.textContent = '認識モデル自体はこの文字を含む6500字以上を識別できますが、収録されている常用漢字・ひらがなの範囲外（人名や旧字体など）の可能性があります。 / This character may be outside the kanji in this dictionary (for example names or old forms).';
      box.appendChild(note);
    }
  } catch(err){
    console.error(err);
    setHwStatus('認識中にエラーが発生しました。 / An error happened.', false);
  } finally {
    $('kjHwRecognize').disabled = false;
  }
};

/* ================= Jukugo / general dictionary lookup tool ================= */
let COMPOUNDS_INDEX = null;
let compoundsIndexLoading = null;
async function loadCompoundsIndex(){
  if(COMPOUNDS_INDEX) return COMPOUNDS_INDEX;
  if(compoundsIndexLoading) return compoundsIndexLoading;
  compoundsIndexLoading = Promise.all([
    fetch('./data/dict-index-part1.json').then(r => r.json()),
    fetch('./data/dict-index-part2.json').then(r => r.json())
  ]).then(([part1, part2]) => {
    COMPOUNDS_INDEX = Object.assign({}, part1, part2);
    return COMPOUNDS_INDEX;
  });
  return compoundsIndexLoading;
}

const jukugoState = { totalChars: null, chars: [], pad: null };

function jukugoWordHtml(word){
  return Array.from(word).map(ch => {
    if(kanjiMap.has(ch)) return `<span class="wc link" data-kanji="${ch}">${ch}</span>`;
    return `<span class="wc">${ch}</span>`;
  }).join('');
}

function setJukugoStatus(text, loading){
  const el = document.getElementById('kjJukugoStatus');
  el.classList.toggle('loading', !!loading);
  el.querySelector('.txt').textContent = text;
}

function renderJukugoProgress(){
  const box = document.getElementById('kjJukugoProgress');
  box.innerHTML = '';
  for(let i=0;i<jukugoState.totalChars;i++){
    const slot = document.createElement('div');
    const filled = i < jukugoState.chars.length;
    slot.className = 'slot' + (filled ? ' filled' : (i === jukugoState.chars.length ? ' current' : ''));
    slot.textContent = filled ? jukugoState.chars[i] : '';
    box.appendChild(slot);
  }
}

async function jukugoLookup(word){
  document.getElementById('kjJukugoBuild').style.display = 'none';
  const resultBox = document.getElementById('kjJukugoResultBox');
  resultBox.style.display = 'block';
  resultBox.innerHTML = '<div class="notfound-msg">調べています…（初回は時間がかかります） / Searching… (the first time can take a while)</div>';

  const index = await loadCompoundsIndex().catch(() => null);
  if(!index){
    resultBox.innerHTML = '<div class="notfound-msg">熟語データの読み込みに失敗しました。通信環境をご確認のうえ、もう一度お試しください。<br>Could not load the word data. Please check your connection and try again.</div>';
    return;
  }

  const entries = index[word];
  if(entries && entries.length){
    resultBox.innerHTML = entries.map(e => `
      <div class="word">${jukugoWordHtml(e.display)}</div>
      <div class="reading">${e.reading}</div>
      <div class="gloss">${e.meaning_en}</div>
    `).join('<div style="height:14px"></div>') + `
      <button class="kj-btn sm c-gray" id="kjJukugoAgain" type="button" style="margin-top:8px;"><svg class="ic"><use href="#i-rotate"/></svg><span class="lb"><b>別の言葉を調べる</b><small>Look up another word</small></span></button>
    `;
  } else {
    resultBox.innerHTML = `
      <div class="notfound-msg">「${esc(word)}」は現在のデータベースには見つかりませんでした。下のボタンでコピーして、他の辞書で調べることができます。<br>“${esc(word)}” was not found. You can copy it with the button below and look it up in another dictionary.</div>
      <div class="notfound-word">${esc(word)}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="kj-btn c-blue" id="kjJukugoCopy" type="button"><svg class="ic"><use href="#i-copy"/></svg><span class="lb"><b>この言葉をコピー</b><small>Copy this word</small></span></button>
        <button class="kj-btn c-gray" id="kjJukugoAgain" type="button"><svg class="ic"><use href="#i-rotate"/></svg><span class="lb"><b>別の言葉を調べる</b><small>Look up another word</small></span></button>
      </div>
    `;
    document.getElementById('kjJukugoCopy').onclick = () => copyTextToClipboard(word, document.getElementById('kjJukugoCopy'));
  }
  const againBtn = document.getElementById('kjJukugoAgain');
  if(againBtn) againBtn.onclick = jukugoReset;
}

function jukugoStartCount(n){
  jukugoState.totalChars = n;
  jukugoState.chars = [];
  document.querySelectorAll('#kjJukugoCountBox .kj-btn').forEach(b => b.classList.toggle('on', Number(b.dataset.n) === n));
  document.getElementById('kjJukugoResultBox').style.display = 'none';
  document.getElementById('kjJukugoBuild').style.display = 'block';
  renderJukugoProgress();
  jukugoState.pad = createDrawPad(document.getElementById('kjJukugoCanvas'), document.querySelector('#kjJukugoBuild .kj-jk-canvas-wrap'));
  document.getElementById('kjJukugoResults').innerHTML = '';
  setJukugoStatus('1文字目を書いてください。 / Write letter 1.', false);
  loadDaKanjiModel().catch(()=>{});
  loadKanjiCanvasRefPatterns().catch(()=>{});
}

function jukugoPickChar(kanjiChar){
  jukugoState.chars.push(kanjiChar);
  renderJukugoProgress();
  document.getElementById('kjJukugoResults').innerHTML = '';
  if(jukugoState.pad) jukugoState.pad.clear();

  if(jukugoState.chars.length >= jukugoState.totalChars){
    const word = jukugoState.chars.join('');
    jukugoLookup(word);
  } else {
    setJukugoStatus((jukugoState.chars.length+1) + '文字目を書いてください。 / Write letter ' + (jukugoState.chars.length+1) + '.', false);
  }
}

function jukugoReset(){
  jukugoState.totalChars = null;
  jukugoState.chars = [];
  jukugoState.pad = null;
  document.querySelectorAll('#kjJukugoCountBox .kj-btn').forEach(b => b.classList.remove('on'));
  document.getElementById('kjJukugoBuild').style.display = 'none';
  document.getElementById('kjJukugoResultBox').style.display = 'none';
  document.getElementById('kjJukugoResultBox').innerHTML = '';
  document.getElementById('kjJukugoInput').value = '';
}

const jukugoToggle = document.getElementById('kjJukugoToggle');
const jukugoPanel = document.getElementById('kjJukugoPanel');
jukugoToggle.addEventListener('click', () => {
  const open = togglePanel('kjJukugoPanel', 'kjJukugoToggle');
  if(open){
    loadCompoundsIndex().catch(()=>{});
  }
});

document.querySelectorAll('#kjJukugoCountBox .kj-btn').forEach(btn => {
  btn.addEventListener('click', () => jukugoStartCount(Number(btn.dataset.n)));
});

document.getElementById('kjJukugoRestart').addEventListener('click', jukugoReset);

document.getElementById('kjJukugoClear').addEventListener('click', () => {
  if(jukugoState.pad) jukugoState.pad.clear();
  document.getElementById('kjJukugoResults').innerHTML = '';
  setJukugoStatus('', false);
});

document.getElementById('kjJukugoRecognize').addEventListener('click', async () => {
  const strokes = jukugoState.pad ? jukugoState.pad.getStrokes() : [];
  if(strokes.length === 0){
    setJukugoStatus('まず枠の中に書いてください。 / Please write inside the box first.', false);
    return;
  }
  setJukugoStatus('認識しています… / Recognizing…', true);
  document.getElementById('kjJukugoRecognize').disabled = true;
  try{
    const results = await recognizeCombined(strokes, jukugoState.pad.width, jukugoState.pad.height);
    setJukugoStatus('候補を表示しました（左ほど自信度が高い） / Results shown (most likely on the left)', false);
    const box = document.getElementById('kjJukugoResults');
    renderCandidateBox(box, results, match => jukugoPickChar(match.kanji));
  } catch(err){
    console.error(err);
    setJukugoStatus('認識中にエラーが発生しました。 / An error happened.', false);
  } finally {
    document.getElementById('kjJukugoRecognize').disabled = false;
  }
});

document.getElementById('kjJukugoResultBox').addEventListener('click', e => {
  const el = e.target.closest('.wc.link');
  if(!el) return;
  const entry = kanjiMap.get(el.dataset.kanji);
  if(entry) openModal(entry);
});

function jukugoTypeSearch(){
  const word = document.getElementById('kjJukugoInput').value.trim();
  if(!word) return;
  document.getElementById('kjJukugoBuild').style.display = 'none';
  jukugoLookup(word);
}
document.getElementById('kjJukugoTypeSearch').addEventListener('click', jukugoTypeSearch);
document.getElementById('kjJukugoInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') jukugoTypeSearch();
});

async function boot(){
  const grid = $('kjGrid');
  // Show a loading message first (the home tiles stay hidden until the data is ready)
  $('kjHome').style.display = 'none';
  $('kjResults').classList.add('show');
  grid.innerHTML = `<div class="kj-empty" style="grid-column:1/-1">辞書データを読み込み中…<small>Loading the dictionary…</small></div>`;
  try{
    const res = await fetch('./data/kanji-data.json');
    KANJI_DATA = await res.json();
  } catch(err){
    console.error(err);
    grid.innerHTML = `<div class="kj-empty" style="grid-column:1/-1">辞書データの読み込みに失敗しました。data/kanji-data.json が index.html と同じ階層構造で置かれているかご確認ください。<small>Could not load the dictionary data.</small></div>`;
    return;
  }
  kanjiMap = new Map(KANJI_DATA.map(k => [k.kanji, k]));

  // Hiragana: loaded separately (much smaller dataset, stroke order only) and merged
  // into the same lookup map so kana can be picked/linked everywhere kanji can be.
  try{
    const kanaRes = await fetch('./data/kana-data.json');
    KANA_DATA = await kanaRes.json();
    KANA_DATA.forEach(k => {
      kanjiMap.set(k.kana, { kanji: k.kana, strokes: k.strokes, strokeCount: k.strokeCount, isKana: true });
    });
  } catch(err){
    console.error('kana data failed to load (non-fatal):', err);
  }

  loadFavorites();
  updateFavToggleLabel();
  renderStrokeChips();
  renderRadicalChips();
  renderJlptChips();
  renderGradeChips();
  renderHomeTiles();
  syncChips();
  applyFilters(); // no condition yet -> shows the home tiles, not the kanji list
}
boot();
