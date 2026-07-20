/* ================= Grid / search / filters ================= */
let KANJI_DATA = [];
let kanjiMap = new Map(); // kanji character -> its data entry, for cross-linking compounds
const state = { query:"", strokeFilter:null, radicalFilter:null, jlptFilter:null, gradeFilter:null, favoritesOnly:false, filtered:[] };
let studyModeActive = false;

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
  const btn = document.getElementById('kjFavToggle');
  btn.textContent = (state.favoritesOnly ? '★' : '☆') + ' お気に入り' + (favorites.size ? ` (${favorites.size})` : '');
}

function applyFilters(){
  const q = state.query.trim().toLowerCase();
  state.filtered = KANJI_DATA.filter(k => {
    if(state.favoritesOnly && !favorites.has(k.kanji)) return false;
    if(state.strokeFilter && k.strokeCount !== state.strokeFilter) return false;
    if(state.radicalFilter && k.radical !== state.radicalFilter) return false;
    if(state.jlptFilter && k.jlpt !== state.jlptFilter) return false;
    if(state.gradeFilter !== null && gradeBucket(k.grade) !== state.gradeFilter) return false;
    if(!q) return true;
    const compoundHay = (k.compounds||[]).map(c => c.word+' '+c.reading+' '+c.meaning_en).join(' ');
    const hay = [k.kanji, ...k.on, ...k.kun, ...k.meanings_en, k.radical, k.radical_meaning_en, k.jlpt, compoundHay].join(" ").toLowerCase();
    return hay.includes(q);
  });
  renderGrid(); renderCount();
}
function renderCount(){ document.getElementById('kjCount').textContent = state.filtered.length + ' / ' + KANJI_DATA.length + ' 字'; }

function buildStaticGlyph(k){
  return `<svg class="kanji-glyph" viewBox="0 0 109 109" xmlns="http://www.w3.org/2000/svg">${k.strokes.map(d=>`<path d="${d}"/>`).join('')}</svg>`;
}

function renderGrid(){
  const grid = document.getElementById('kjGrid');
  grid.innerHTML = "";
  if(state.filtered.length === 0){
    const msg = (state.favoritesOnly && favorites.size === 0)
      ? 'お気に入りはまだありません。漢字のページを開いて☆マークを押すと、ここに追加されます。'
      : '見つかりませんでした。検索語や絞り込みを変えてみてください。';
    grid.innerHTML = `<div class="kj-empty">${msg}</div>`;
    return;
  }
  state.filtered.forEach(k => {
    const card = document.createElement('div');
    card.className = 'kj-card';
    card.innerHTML = `
      <div class="jlpt-tag">${k.jlpt}</div>
      <div class="stamp">${k.strokeCount}</div>
      <div class="cell">${buildStaticGlyph(k)}</div>
      <div class="info">
        <div class="reading">${k.kun.join('・')}${k.on.length?'　'+k.on.join('・'):''}</div>
        <div class="meaning-en">${k.meanings_en.slice(0,2).join(', ')}</div>
      </div>`;
    card.addEventListener('click', () => openModal(k));
    grid.appendChild(card);
  });
}

function renderStrokeChips(){
  const counts = Array.from(new Set(KANJI_DATA.map(k=>k.strokeCount))).sort((a,b)=>a-b);
  const wrap = document.getElementById('kjStrokeChips');
  counts.forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.textContent = c + '画';
    chip.addEventListener('click', () => {
      state.strokeFilter = (state.strokeFilter === c) ? null : c;
      document.querySelectorAll('#kjStrokeChips .chip').forEach(el=>el.classList.remove('on'));
      if(state.strokeFilter) chip.classList.add('on');
      applyFilters();
    });
    wrap.appendChild(chip);
  });
}
function renderRadicalChips(){
  // With 2136 kanji there are ~200 distinct radicals, too many for a chip row,
  // so the radical filter is a searchable <select> instead.
  const counts = {};
  KANJI_DATA.forEach(k => { counts[k.radical] = (counts[k.radical]||0) + 1; });
  const rads = Array.from(new Set(KANJI_DATA.map(k=>k.radical)))
    .sort((a,b) => a.localeCompare(b, 'ja'));
  const select = document.getElementById('kjRadicalSelect');
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

function renderGradeChips(){
  const grades = Array.from(new Set(KANJI_DATA.map(k=>gradeBucket(k.grade)))).sort((a,b)=>a-b);
  const wrap = document.getElementById('kjGradeChips');
  grades.forEach(g => {
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.textContent = gradeLabel(g);
    chip.addEventListener('click', () => {
      state.gradeFilter = (state.gradeFilter === g) ? null : g;
      document.querySelectorAll('#kjGradeChips .chip').forEach(el=>el.classList.remove('on'));
      if(state.gradeFilter !== null) chip.classList.add('on');
      applyFilters();
    });
    wrap.appendChild(chip);
  });
}
function renderJlptChips(){
  const levels = Array.from(new Set(KANJI_DATA.map(k=>k.jlpt))).sort();
  const wrap = document.getElementById('kjJlptChips');
  levels.forEach(l => {
    const chip = document.createElement('span');
    chip.className = 'chip'; chip.textContent = l;
    chip.addEventListener('click', () => {
      state.jlptFilter = (state.jlptFilter === l) ? null : l;
      document.querySelectorAll('#kjJlptChips .chip').forEach(el=>el.classList.remove('on'));
      if(state.jlptFilter) chip.classList.add('on');
      applyFilters();
    });
    wrap.appendChild(chip);
  });
}

document.getElementById('kjSearchInput').addEventListener('input', e => { state.query = e.target.value; applyFilters(); });
document.getElementById('kjClearFilters').addEventListener('click', () => {
  state.strokeFilter=null; state.radicalFilter=null; state.jlptFilter=null; state.gradeFilter=null; state.query=""; state.favoritesOnly=false;
  document.getElementById('kjSearchInput').value="";
  document.getElementById('kjRadicalSelect').value="";
  document.querySelectorAll('.chip').forEach(el=>el.classList.remove('on'));
  document.getElementById('kjFavToggle').classList.remove('active');
  updateFavToggleLabel();
  applyFilters();
});

document.getElementById('kjHomeLink').addEventListener('click', () => {
  state.strokeFilter=null; state.radicalFilter=null; state.jlptFilter=null; state.gradeFilter=null; state.query=""; state.favoritesOnly=false;
  document.getElementById('kjSearchInput').value="";
  document.getElementById('kjRadicalSelect').value="";
  document.querySelectorAll('.chip').forEach(el=>el.classList.remove('on'));
  document.getElementById('kjFavToggle').classList.remove('active');
  updateFavToggleLabel();
  document.getElementById('kjHwPanel').classList.remove('show');
  document.getElementById('kjJukugoPanel').classList.remove('show');
  jukugoReset();
  if(document.getElementById('kjFullscreen').classList.contains('show')) closeFullscreen();
  closeModal();
  applyFilters();
  window.scrollTo({top:0, behavior:'smooth'});
});

document.getElementById('kjFavToggle').addEventListener('click', () => {
  state.favoritesOnly = !state.favoritesOnly;
  document.getElementById('kjFavToggle').classList.toggle('active', state.favoritesOnly);
  updateFavToggleLabel();
  applyFilters();
});

document.getElementById('kjStudyModeToggle').addEventListener('click', () => {
  studyModeActive = !studyModeActive;
  document.getElementById('kjStudyModeToggle').classList.toggle('active', studyModeActive);
});

/* ================= Modal + stroke order animation ================= */
let currentAnimSpeed = 700;
let currentModalKanji = null;
let modalHistory = [];

function renderCompoundsList(container, k){
  container.innerHTML = '';
  if(!k.compounds || k.compounds.length === 0){
    container.innerHTML = '<div class="none">この漢字が使われる一般的な熟語は見つかりませんでした（単独で使われることが多い漢字です）。</div>';
    return;
  }
  k.compounds.forEach(c => {
    const row = document.createElement('div');
    row.className = 'kj-compound-item';
    const wordHtml = Array.from(c.word).map(ch => {
      if(ch === k.kanji) return `<span class="wc current">${ch}</span>`;
      if(kanjiMap.has(ch)) return `<span class="wc link" data-kanji="${ch}">${ch}</span>`;
      return `<span class="wc">${ch}</span>`;
    }).join('');
    row.innerHTML = `<span class="word">${wordHtml}</span><span class="reading">${c.reading}</span><span class="gloss">${c.meaning_en}</span>`;
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

function openModal(k, opts){
  opts = opts || {};
  if(studyModeActive){
    openFullscreen(k);
    return;
  }
  if(!opts.fromHistory){
    // starting a fresh lookup (from the grid, search, or handwriting results) resets the trail
    modalHistory = [];
  }
  currentModalKanji = k;
  const backBtn = document.getElementById('kjModalBack');
  backBtn.style.display = modalHistory.length > 0 ? '' : 'none';

  const modalEl = document.querySelector('.kj-modal');
  if(modalEl) modalEl.scrollTop = 0;
  document.getElementById('kjModalKanjiTiny').textContent = k.kanji + '　部首：' + k.radical + '（' + k.radical_meaning_en + '）';
  document.getElementById('kjModalJlpt').textContent = k.jlpt;
  document.getElementById('kjModalOn').textContent = k.on.length ? k.on.join('、') : '－';
  document.getElementById('kjModalKun').textContent = k.kun.length ? k.kun.join('、') : '－';
  document.getElementById('kjModalMeaning').textContent = k.meanings_en.join(', ');
  document.getElementById('kjModalMeaningEn').textContent = '学習学年：' + gradeLabel(k.grade);
  document.getElementById('kjModalStrokeRadical').textContent = k.strokeCount + '画　／　部首：' + k.radical + '（' + k.radical_meaning_en + '）';
  document.getElementById('kjModalExJa').textContent = k.ex_ja;
  document.getElementById('kjModalExEn').textContent = k.ex_en;

  renderCompoundsList(document.getElementById('kjModalCompounds'), k);

  const stage = document.getElementById('kjStage');
  const pathEls = buildStrokeSvg(stage, k.strokes);

  currentAnimSpeed = 700;
  playAnimation(pathEls);
  document.getElementById('kjReplay').onclick = () => playAnimation(pathEls);
  document.getElementById('kjSlow').onclick = () => { currentAnimSpeed = 1400; playAnimation(pathEls); };
  document.getElementById('kjCopyKanji').onclick = () => copyTextToClipboard(k.kanji, document.getElementById('kjCopyKanji'));

  const starBtn = document.getElementById('kjModalStar');
  const setStarUI = () => {
    const isFav = favorites.has(k.kanji);
    starBtn.textContent = isFav ? '★' : '☆';
    starBtn.classList.toggle('active', isFav);
    starBtn.title = isFav ? 'お気に入りから削除' : 'お気に入りに登録';
  };
  setStarUI();
  starBtn.onclick = () => { toggleFavorite(k.kanji); setStarUI(); };

  document.getElementById('kjOverlay').classList.add('show');
}
function playAnimation(pathEls){
  pathEls.forEach((p, i) => {
    const len = p.getTotalLength();
    p.style.transition = 'none';
    p.style.strokeDasharray = len;
    p.style.strokeDashoffset = len;
    p.getBoundingClientRect();
    p.style.transition = `stroke-dashoffset ${currentAnimSpeed}ms ease-in-out`;
    p.style.transitionDelay = (i * currentAnimSpeed) + 'ms';
    requestAnimationFrame(() => { p.style.strokeDashoffset = 0; });
  });
}

function copyTextToClipboard(text, btn){
  const showCopied = () => {
    const original = btn.innerHTML;
    btn.innerHTML = '✓ コピーしました';
    btn.classList.add('copied');
    setTimeout(() => { btn.innerHTML = original; btn.classList.remove('copied'); }, 1500);
  };
  const showFailed = () => {
    const original = btn.innerHTML;
    btn.innerHTML = 'コピーできませんでした';
    setTimeout(() => { btn.innerHTML = original; }, 1500);
  };

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
document.getElementById('kjModalClose').addEventListener('click', closeModal);
document.getElementById('kjOverlay').addEventListener('click', e => { if(e.target.id === 'kjOverlay') closeModal(); });
document.getElementById('kjModalCompounds').addEventListener('click', e => {
  const el = e.target.closest('.wc.link');
  if(!el) return;
  const ch = el.dataset.kanji;
  const entry = kanjiMap.get(ch);
  if(entry){
    if(currentModalKanji) modalHistory.push(currentModalKanji);
    openModal(entry, {fromHistory:true});
  }
});
document.getElementById('kjModalBack').addEventListener('click', () => {
  const prev = modalHistory.pop();
  if(prev) openModal(prev, {fromHistory:true});
});
function closeModal(){ document.getElementById('kjOverlay').classList.remove('show'); }
document.addEventListener('keydown', e => {
  if(e.key !== 'Escape') return;
  if(document.getElementById('kjFullscreen').classList.contains('show')) closeFullscreen();
  else closeModal();
});

/* ================= Fullscreen Lesson Mode ================= */
let fsCurrentKanji = null;
let fsMode = 'normal'; // 'normal' | 'reading' | 'writing'
let fsSelectedWord = null;
let fsRevealed = false;

function openFullscreen(k){
  fsCurrentKanji = k;
  fsMode = 'normal';
  fsSelectedWord = null;
  fsRevealed = false;
  document.querySelectorAll('.kj-fs-modebtn').forEach(b => b.classList.toggle('active', b.dataset.mode === 'normal'));
  document.getElementById('kjFsNormal').style.display = 'flex';
  document.getElementById('kjFsStudyView').style.display = 'none';
  renderFsNormal(k);
  document.body.style.overflow = 'hidden';
  document.getElementById('kjFullscreen').classList.add('show');
}

function closeFullscreen(){
  document.getElementById('kjFullscreen').classList.remove('show');
  document.body.style.overflow = '';
}

document.getElementById('kjFsClose').addEventListener('click', closeFullscreen);

function renderFsNormal(k){
  document.getElementById('kjFsKanjiSmall').textContent = k.kanji + '　部首：' + k.radical + '（' + k.radical_meaning_en + '）';
  document.getElementById('kjFsJlpt').textContent = k.jlpt;
  document.getElementById('kjFsOn').textContent = k.on.length ? k.on.join('、') : '－';
  document.getElementById('kjFsKun').textContent = k.kun.length ? k.kun.join('、') : '－';
  document.getElementById('kjFsMeaning').textContent = k.meanings_en.join(', ');
  document.getElementById('kjFsStrokeRadical').textContent = k.strokeCount + '画　／　部首：' + k.radical + '（' + k.radical_meaning_en + '）　／　' + gradeLabel(k.grade);

  const exBox = document.getElementById('kjFsExample');
  if(k.ex_ja){
    exBox.style.display = '';
    exBox.innerHTML = `<div>${k.ex_ja}</div><div class="en">${k.ex_en}</div>`;
  } else {
    exBox.style.display = 'none';
  }

  renderCompoundsList(document.getElementById('kjFsCompoundsList'), k);

  const pathEls = buildStrokeSvg(document.getElementById('kjFsStage'), k.strokes);
  currentAnimSpeed = 700;
  playAnimation(pathEls);
  document.getElementById('kjFsReplay').onclick = () => playAnimation(pathEls);
  document.getElementById('kjFsSlow').onclick = () => { currentAnimSpeed = 1400; playAnimation(pathEls); };
  document.getElementById('kjFsCopy').onclick = () => copyTextToClipboard(k.kanji, document.getElementById('kjFsCopy'));

  const starBtn = document.getElementById('kjFsStar');
  const setFsStarUI = () => {
    const isFav = favorites.has(k.kanji);
    starBtn.textContent = isFav ? '★' : '☆';
    starBtn.classList.toggle('active', isFav);
  };
  setFsStarUI();
  starBtn.onclick = () => { toggleFavorite(k.kanji); setFsStarUI(); };
}

document.getElementById('kjFsCompoundsList').addEventListener('click', e => {
  const el = e.target.closest('.wc.link');
  if(!el) return;
  const entry = kanjiMap.get(el.dataset.kanji);
  if(entry) openFullscreen(entry);
});

document.querySelectorAll('.kj-fs-modebtn').forEach(btn => {
  btn.addEventListener('click', () => {
    fsMode = btn.dataset.mode;
    document.querySelectorAll('.kj-fs-modebtn').forEach(b => b.classList.toggle('active', b === btn));
    if(fsMode === 'normal'){
      document.getElementById('kjFsNormal').style.display = 'flex';
      document.getElementById('kjFsStudyView').style.display = 'none';
    } else {
      document.getElementById('kjFsNormal').style.display = 'none';
      document.getElementById('kjFsStudyView').style.display = 'flex';
      fsSelectedWord = null;
      fsRevealed = false;
      renderFsWordList();
      renderFsStage();
    }
  });
});

function renderFsWordList(){
  const box = document.getElementById('kjFsWordList');
  box.innerHTML = '';
  const words = (fsCurrentKanji && fsCurrentKanji.study_words) || [];
  if(words.length === 0){
    box.innerHTML = '<div class="kj-fs-empty">この漢字には学習用の言葉が見つかりませんでした。</div>';
    return;
  }
  words.forEach(w => {
    const chip = document.createElement('div');
    chip.className = 'kj-fs-word-chip' + (fsSelectedWord === w ? ' selected' : '');
    const cardLabel = fsMode === 'writing' ? w.reading : w.word;
    chip.innerHTML = `${cardLabel}<span class="tag">${w.type === 'kun' ? '訓読み' : '熟語'}</span>`;
    chip.addEventListener('click', () => {
      fsSelectedWord = w;
      fsRevealed = false;
      renderFsWordList();
      renderFsStage();
    });
    box.appendChild(chip);
  });
}

function renderFsStage(){
  const back = document.getElementById('kjFsBack');
  const front = document.getElementById('kjFsFront');
  const meaning = document.getElementById('kjFsWordMeaning');
  const stage = document.getElementById('kjFsStage2');

  if(!fsSelectedWord){
    front.textContent = '言葉を選んでください';
    front.style.fontSize = '48px';
    back.textContent = '';
    meaning.textContent = '';
    stage.onclick = null;
    return;
  }

  const w = fsSelectedWord;
  meaning.textContent = w.meaning_en;

  if(fsMode === 'reading'){
    // kanji word always shown big; reading revealed on click, above, at ~1/4 size
    front.textContent = w.word;
    front.style.fontSize = 'min(18vw, 22vh, 200px)';
    back.style.fontSize = 'min(4.5vw, 5.5vh, 50px)';
    back.textContent = fsRevealed ? w.reading : '';
  } else {
    // writing mode: reading always shown; kanji revealed on click, above, prominently
    front.textContent = w.reading;
    front.style.fontSize = 'min(11vw, 13vh, 110px)';
    back.style.fontSize = 'min(18vw, 22vh, 200px)';
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
    setHwStatus('認識モデルを読み込み中…（初回のみ、数MB〜数十MB通信します）', true);
    const [model, labels] = await Promise.all([
      tf.loadGraphModel('./model/model.json'),
      fetch('./model/labels.json').then(r => r.json())
    ]);
    dakanjiModel = model;
    DAKANJI_LABELS = labels;
    setHwStatus('モデルの読み込み完了。書いて「認識する」を押してください。', false);
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

/* ---- generic draw pad factory (reused by the standalone handwriting tool and the jukugo tool) ---- */
function createDrawPad(canvas, wrapEl){
  const ratio = window.devicePixelRatio || 1;
  const rect = wrapEl.getBoundingClientRect();
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  const ctx = canvas.getContext('2d');
  ctx.scale(ratio, ratio);
  ctx.strokeStyle = '#211C15'; ctx.lineWidth = 4; ctx.lineCap='round'; ctx.lineJoin='round';

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
    clear: () => { ctx.clearRect(0,0,canvas.width, canvas.height); strokes = []; current = null; }
  };
}

/* ---- handwriting pad UI (single-kanji lookup) ---- */
const hwToggle = document.getElementById('kjHwToggle');
const hwPanel = document.getElementById('kjHwPanel');
let hwModelPreloadStarted = false;
let hwPad = null;
hwToggle.addEventListener('click', () => {
  hwPanel.classList.toggle('show');
  if(hwPanel.classList.contains('show')){
    hwPad = createDrawPad(document.getElementById('kjHwCanvas'), document.querySelector('.kj-hw-canvas-wrap'));
    if(!hwModelPreloadStarted){
      hwModelPreloadStarted = true;
      loadDaKanjiModel().catch(err => {
        console.error(err);
        setHwStatus('モデルの読み込みに失敗しました（通信環境をご確認ください）。', false);
      });
    }
  }
});

document.getElementById('kjHwClear').onclick = () => {
  if(hwPad) hwPad.clear();
  setHwStatus('', false);
  document.getElementById('kjHwResults').innerHTML = '';
};

document.getElementById('kjHwRecognize').onclick = async () => {
  const strokes = hwPad ? hwPad.getStrokes() : [];
  if(strokes.length === 0){
    setHwStatus('まず枠の中に書いてください。', false);
    return;
  }
  setHwStatus('認識しています…', true);
  document.getElementById('kjHwRecognize').disabled = true;
  try{
    const results = await recognizeWithModel(strokes);
    setHwStatus('候補を表示しました（左ほど自信度が高い）', false);
    const box = document.getElementById('kjHwResults');
    box.innerHTML = '';
    results.forEach((r, i) => {
      const match = KANJI_DATA.find(k => k.kanji === r.char);
      const el = document.createElement('div');
      el.className = 'kj-hw-cand' + (i===0 ? ' best' : '') + (match ? '' : ' notfound');
      el.innerHTML = match
        ? `<div class="g">${buildStaticGlyph(match)}</div><div class="score">${(r.prob*100).toFixed(0)}%</div>`
        : `<div class="g">${r.char}</div><div class="score">${(r.prob*100).toFixed(0)}%</div>`;
      if(match){
        el.addEventListener('click', () => openModal(match));
      }
      box.appendChild(el);
    });
    if(!results.some(r => KANJI_DATA.find(k => k.kanji === r.char))){
      const note = document.createElement('div');
      note.className = 'kj-hw-note';
      note.style.flexBasis = '100%';
      note.textContent = '認識モデル自体はこの文字を含む6500字以上を識別できますが、常用漢字' + KANJI_DATA.length + '字の範囲外（人名や旧字体など）の可能性があります。';
      box.appendChild(note);
    }
  } catch(err){
    console.error(err);
    setHwStatus('認識中にエラーが発生しました。', false);
  } finally {
    document.getElementById('kjHwRecognize').disabled = false;
  }
};

/* ================= Jukugo (compound word) lookup tool ================= */
let COMPOUNDS_INDEX = null;
let compoundsIndexLoading = null;
async function loadCompoundsIndex(){
  if(COMPOUNDS_INDEX) return COMPOUNDS_INDEX;
  if(compoundsIndexLoading) return compoundsIndexLoading;
  compoundsIndexLoading = fetch('./data/compounds-index.json').then(r => r.json()).then(data => {
    COMPOUNDS_INDEX = data;
    return data;
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
  resultBox.innerHTML = '<div class="notfound-msg">調べています…</div>';

  const index = await loadCompoundsIndex().catch(() => null);
  if(!index){
    resultBox.innerHTML = '<div class="notfound-msg">熟語データの読み込みに失敗しました。通信環境をご確認のうえ、もう一度お試しください。</div>';
    return;
  }

  const entries = index[word];
  if(entries && entries.length){
    resultBox.innerHTML = `
      <div class="word">${jukugoWordHtml(word)}</div>
      ${entries.map(e => `<div class="reading">${e.reading}</div><div class="gloss">${e.meaning_en}</div>`).join('')}
      <button class="kj-btn ghost" id="kjJukugoAgain" style="margin-top:8px;height:34px;padding:0 12px;font-size:12px;">別の熟語を調べる</button>
    `;
  } else {
    resultBox.innerHTML = `
      <div class="notfound-msg">「${word}」は現在のデータベースには見つかりませんでした。下のボタンでコピーして、他の辞書で調べることができます。</div>
      <div class="notfound-word">${word}</div>
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button class="kj-btn" id="kjJukugoCopy">⧉ この熟語をコピー</button>
        <button class="kj-btn ghost" id="kjJukugoAgain">別の熟語を調べる</button>
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
  document.querySelectorAll('#kjJukugoCountBox .kj-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.n) === n));
  document.getElementById('kjJukugoResultBox').style.display = 'none';
  document.getElementById('kjJukugoBuild').style.display = 'block';
  renderJukugoProgress();
  jukugoState.pad = createDrawPad(document.getElementById('kjJukugoCanvas'), document.querySelector('#kjJukugoBuild .kj-jk-canvas-wrap'));
  document.getElementById('kjJukugoResults').innerHTML = '';
  setJukugoStatus('1文字目を書いてください。', false);
  loadDaKanjiModel().catch(()=>{});
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
    setJukugoStatus((jukugoState.chars.length+1) + '文字目を書いてください。', false);
  }
}

function jukugoReset(){
  jukugoState.totalChars = null;
  jukugoState.chars = [];
  jukugoState.pad = null;
  document.querySelectorAll('#kjJukugoCountBox .kj-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('kjJukugoBuild').style.display = 'none';
  document.getElementById('kjJukugoResultBox').style.display = 'none';
  document.getElementById('kjJukugoResultBox').innerHTML = '';
  document.getElementById('kjJukugoInput').value = '';
}

const jukugoToggle = document.getElementById('kjJukugoToggle');
const jukugoPanel = document.getElementById('kjJukugoPanel');
jukugoToggle.addEventListener('click', () => {
  jukugoPanel.classList.toggle('show');
  if(jukugoPanel.classList.contains('show')){
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
    setJukugoStatus('まず枠の中に書いてください。', false);
    return;
  }
  setJukugoStatus('認識しています…', true);
  document.getElementById('kjJukugoRecognize').disabled = true;
  try{
    const results = await recognizeWithModel(strokes);
    setJukugoStatus('候補を表示しました（左ほど自信度が高い）', false);
    const box = document.getElementById('kjJukugoResults');
    box.innerHTML = '';
    results.forEach((r, i) => {
      const match = KANJI_DATA.find(k => k.kanji === r.char);
      const el = document.createElement('div');
      el.className = 'kj-hw-cand' + (i===0 ? ' best' : '') + (match ? '' : ' notfound');
      el.innerHTML = match
        ? `<div class="g">${buildStaticGlyph(match)}</div><div class="score">${(r.prob*100).toFixed(0)}%</div>`
        : `<div class="g">${r.char}</div><div class="score">${(r.prob*100).toFixed(0)}%</div>`;
      if(match){
        el.addEventListener('click', () => jukugoPickChar(match.kanji));
      }
      box.appendChild(el);
    });
  } catch(err){
    console.error(err);
    setJukugoStatus('認識中にエラーが発生しました。', false);
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
  const grid = document.getElementById('kjGrid');
  grid.innerHTML = `<div class="kj-empty">辞書データを読み込み中…</div>`;
  try{
    const res = await fetch('./data/kanji-data.json');
    KANJI_DATA = await res.json();
  } catch(err){
    console.error(err);
    grid.innerHTML = `<div class="kj-empty">辞書データの読み込みに失敗しました。data/kanji-data.json が index.html と同じ階層構造で置かれているかご確認ください。</div>`;
    return;
  }
  state.filtered = KANJI_DATA.slice();
  kanjiMap = new Map(KANJI_DATA.map(k => [k.kanji, k]));
  loadFavorites();
  updateFavToggleLabel();
  renderStrokeChips();
  renderRadicalChips();
  renderJlptChips();
  renderGradeChips();
  renderGrid();
  renderCount();
}
boot();
