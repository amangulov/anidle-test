// Анидл — угадай аниме по комментариям с Shikimori
'use strict';

const MAX_TRIES = 6;
const KINDS = { tv: 'ТВ-сериал', movie: 'Фильм', ova: 'OVA', ona: 'ONA' };
const $ = (id) => document.getElementById(id);

const state = {
  pool: [],
  mode: 'daily',          // 'daily' | 'endless'
  anime: null,
  comments: [],
  guesses: [],            // id-шники сделанных догадок ('skip' для пропуска)
  done: false,
  win: false,
  endlessStreak: 0,
};

// ---------- дата и выбор загадки дня ----------

function mskDateStr() {
  const msk = new Date(Date.now() + 3 * 3600 * 1000); // UTC+3
  return msk.toISOString().slice(0, 10);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const DAILY_TOP = 150;
const LEVELS = [[0, 150], [150, 350], [350, Infinity]];
let level = 0; 

function dailyAnime() {
  const top = state.pool.slice(0, DAILY_TOP);
  return top[hash('anidle:' + mskDateStr()) % top.length];
}

// ---------- хранилище ----------

const store = {
  get(key, def) {
    try { return JSON.parse(localStorage.getItem(key)) ?? def; } catch { return def; }
  },
  set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* приватный режим */ }
  },
};

function loadStats() {
  return store.get('anidle.stats', { played: 0, wins: 0, streak: 0, maxStreak: 0, lastWin: null });
}

function saveDailyProgress() {
  store.set('anidle.day.' + mskDateStr(), {
    guesses: state.guesses, done: state.done, win: state.win,
  });
}

function finishStats(win) {
  const s = loadStats();
  s.played++;
  if (win) {
    s.wins++;
    const yesterday = new Date(Date.now() + 3 * 3600 * 1000 - 86400000).toISOString().slice(0, 10);
    s.streak = s.lastWin === yesterday ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
    s.lastWin = mskDateStr();
  } else {
    s.streak = 0;
  }
  store.set('anidle.stats', s);
}

// ---------- загрузка данных ----------

async function loadJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(path + ': ' + res.status);
  return res.json();
}

async function startRound(anime, restored) {
  state.anime = anime;
  state.comments = await loadJson(`data/comments/${anime.id}.json`);
  if (!restored) { state.guesses = []; state.done = false; state.win = false; }
  render();
}

// ---------- отрисовка ----------

function revealedCount() {
  return Math.min(state.guesses.length + 1, state.comments.length);
}

function render() {
  const a = state.anime;
  const n = state.guesses.length;

  // статус
  const statusEl = $('status');
  if (state.mode === 'daily') {
    statusEl.innerHTML = state.done
      ? `Загадка дня <b>${mskDateStr()}</b> завершена. Возвращайтесь завтра!`
      : `Загадка дня <b>${mskDateStr()}</b> · попытка <b>${Math.min(n + 1, MAX_TRIES)}/${MAX_TRIES}</b>`;
  } else {
    statusEl.innerHTML = `Бесконечный режим · серия побед: <b>${state.endlessStreak}</b>`;
  }

  // подсказки открываются с ошибками
  const hints = [
    { after: 1, label: 'Год', value: a.y },
    { after: 2, label: 'Формат', value: KINDS[a.k] + (a.e ? `, ${a.e} эп.` : '') },
    { after: 3, label: 'Жанры', value: (a.g || []).join(', ') },
    { after: 4, label: 'Студия', value: a.s },
    { after: 5, label: 'Оценка', value: a.sc },
  ].filter((h) => h.value);
  $('hints').innerHTML = hints.map((h) =>
    n >= h.after || state.done
      ? `<span class="chip open">${h.label}: <b>${h.value}</b></span>`
      : `<span class="chip">${h.label}: 🔒</span>`
  ).join('');

  // комментарии
  const count = state.done ? state.comments.length : revealedCount();
  $('comments').innerHTML = state.comments.slice(0, count).map((c, i) => `
    <article class="comment">
      <div class="who">комментарий ${i + 1} · Shikimori</div>
      <div class="body">${escapeHtml(c)}</div>
    </article>`).join('');

  // лепестки-попытки
  $('attempts').innerHTML = Array.from({ length: MAX_TRIES }, (_, i) => {
    const cls = state.win && i === state.guesses.length - 1 ? 'win' : i < n ? 'used' : '';
    return `<div class="petal ${cls}"></div>`;
  }).join('');
  
  // история попыток
  $('history').innerHTML = state.guesses.map((g) => {
    if (g === 'skip') return `<span class="try">— пропуск</span>`;
    const a = state.pool.find((x) => x.id === g);
    return `<span class="try ${g === state.anime.id ? 'hit' : ''}">${escapeHtml(a ? a.r : '?')}</span>`;
  }).join('');

  $('controls').style.display = state.done ? 'none' : '';
  $('result').hidden = !state.done;
  if (state.done) renderResult();
}

function renderResult() {
  const a = state.anime;
  const tries = state.guesses.length;
  $('result-poster').src = a.img || '';
  $('result-poster').style.display = a.img ? '' : 'none';
  $('result-title').textContent = a.r;
  $('result-sub').textContent = [KINDS[a.k], a.y, a.s].filter(Boolean).join(' · ');
  const t = $('result-text');
  t.className = 'result-text ' + (state.win ? 'win' : 'lose');
  t.textContent = state.win
    ? `Угадано с ${tries}-й попытки!`
    : 'Не угадано. Это было оно ↑';
  $('result-link').href = a.url || 'https://shikimori.one';
  $('share').style.display = state.mode === 'daily' ? '' : 'none';
  $('next').hidden = state.mode !== 'endless';

  if (state.mode === 'daily') {
    const s = loadStats();
    $('stats').innerHTML = `
      <div><b>${s.played}</b>сыграно</div>
      <div><b>${s.played ? Math.round(100 * s.wins / s.played) : 0}%</b>побед</div>
      <div><b>${s.streak}</b>серия</div>
      <div><b>${s.maxStreak}</b>рекорд</div>`;
  } else {
    $('stats').innerHTML = `<div><b>${state.endlessStreak}</b>серия побед</div>
      <div><b>${store.get('anidle.endlessBest', 0)}</b>рекорд</div>`;
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------- ход игры ----------

function makeGuess(id) {
  if (state.done) return;
  state.guesses.push(id);

  if (id === state.anime.id) {
    state.done = true; state.win = true;
  } else if (state.guesses.length >= MAX_TRIES) {
    state.done = true; state.win = false;
  }

  if (state.mode === 'daily') {
    if (state.done) finishStats(state.win);
    saveDailyProgress();
  } else if (state.done) {
    state.endlessStreak = state.win ? state.endlessStreak + 1 : 0;
    const best = store.get('anidle.endlessBest', 0);
    if (state.endlessStreak > best) store.set('anidle.endlessBest', state.endlessStreak);
  }

  $('guess').value = '';
  hideSuggest();
 render();
  const last = document.querySelector('.comment:last-child');
  if (last) last.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---------- автодополнение ----------

let selIndex = -1;
let suggestions = [];

function norm(s) { return (s || '').toLowerCase().replace(/ё/g, 'е'); }

function showSuggest(query) {
  const q = norm(query.trim());
  const box = $('suggest');
  if (q.length < 2) { hideSuggest(); return; }
  suggestions = state.pool
    .filter((a) => norm(a.r).includes(q) || norm(a.n).includes(q))
    .slice(0, 8);
  if (!suggestions.length) { hideSuggest(); return; }
  selIndex = -1;
  box.innerHTML = suggestions.map((a, i) =>
    `<li role="option" data-i="${i}">${escapeHtml(a.r)}<span class="en">${escapeHtml(a.n)}</span></li>`
  ).join('');
  box.hidden = false;
}

function hideSuggest() { $('suggest').hidden = true; suggestions = []; selIndex = -1; }

function bindInput() {
  const input = $('guess');
  const box = $('suggest');

  input.addEventListener('input', () => showSuggest(input.value));

  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      selIndex = (selIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      [...box.children].forEach((li, i) => li.classList.toggle('sel', i === selIndex));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = suggestions[selIndex >= 0 ? selIndex : 0];
      if (pick) makeGuess(pick.id);
    } else if (e.key === 'Escape') {
      hideSuggest();
    }
  });

  box.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (li) makeGuess(suggestions[Number(li.dataset.i)].id);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.guess-box')) hideSuggest();
  });
}

// ---------- шаринг ----------

function shareResult() {
  const rows = state.guesses
    .map((g, i) => (g === state.anime.id ? '🌸' : '🥀'))
    .join('');
  const score = state.win ? `${state.guesses.length}/${MAX_TRIES}` : `X/${MAX_TRIES}`;
  const text = `Анидл ${mskDateStr()} — ${score}\n${rows}\n${location.href}`;
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard.writeText(text).then(() => {
      $('share').textContent = 'Скопировано!';
      setTimeout(() => { $('share').textContent = 'Поделиться результатом'; }, 1500);
    });
  }
}

// ---------- режимы и запуск ----------

function randomAnime() {
  const [from, to] = LEVELS[level];
  const slice = state.pool.slice(from, to);
  let a;
  do { a = slice[Math.floor(Math.random() * slice.length)]; }
  while (state.anime && a.id === state.anime.id && slice.length > 1);
  return a;
}

async function switchMode(mode) {
  $('levels').hidden = mode !== 'endless';
  state.mode = mode;
  $('tab-daily').classList.toggle('active', mode === 'daily');
  $('tab-endless').classList.toggle('active', mode === 'endless');
  $('tab-daily').setAttribute('aria-selected', mode === 'daily');
  $('tab-endless').setAttribute('aria-selected', mode === 'endless');

  if (mode === 'daily') {
    const saved = store.get('anidle.day.' + mskDateStr(), null);
    if (saved) Object.assign(state, { guesses: saved.guesses, done: saved.done, win: saved.win });
    await startRound(dailyAnime(), Boolean(saved));
  } else {
    await startRound(randomAnime(), false);
  }
}

async function init() {
  try {
    state.pool = await loadJson('data/animes.json');
  } catch {
    $('status').textContent = 'Данные ещё не собраны. Запустите workflow «Обновить данные с Shikimori» в GitHub Actions.';
    return;
  }

  bindInput();
  $('skip').addEventListener('click', () => makeGuess('skip'));
  $('share').addEventListener('click', shareResult);
  $('next').addEventListener('click', () => startRound(randomAnime(), false));
  $('tab-daily').addEventListener('click', () => switchMode('daily'));
  $('tab-endless').addEventListener('click', () => switchMode('endless'));

  await switchMode('daily');
  $('levels').addEventListener('click', (e) => {
    const btn = e.target.closest('.level');
    if (!btn) return;
    level = Number(btn.dataset.l);
    document.querySelectorAll('.level').forEach((b) => b.classList.toggle('active', b === btn));
    state.endlessStreak = 0;
    startRound(randomAnime(), false);
  });
}

init();
