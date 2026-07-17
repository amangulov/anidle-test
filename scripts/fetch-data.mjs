// Сбор данных с Shikimori API: топ аниме + комментарии к ним.
// Запускается в GitHub Actions (Node 20+). Локально: node scripts/fetch-data.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE = 'https://shikimori.one/api';
const UA = 'Anidle daily guessing game (github pages hobby project)';
const POOL_TARGET = 750;          // сколько аниме собрать в пул
const MIN_COMMENTS = 4;           // минимум пригодных комментариев, иначе аниме пропускаем
const MAX_COMMENTS = 10;          // сколько комментариев сохраняем на аниме
const PAUSE_MS = 450;             // Shikimori: не более 5 rps / 90 rpm

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, attempt = 1) {
  await sleep(PAUSE_MS);
  const res = await fetch(BASE + path, { headers: { 'User-Agent': UA } });
  if (res.status === 429 || res.status >= 500) {
    if (attempt > 5) throw new Error(`Shikimori ${res.status} для ${path}`);
    await sleep(3000 * attempt);
    return api(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`Shikimori ${res.status} для ${path}`);
  return res.json();
}

// ---------- очистка и маскировка комментариев ----------

function stripBb(text) {
  let t = text;
  // блочные теги вместе с содержимым — спойлеры, цитаты, ответы
  t = t.replace(/\[spoiler[^\]]*\][\s\S]*?\[\/spoiler\]/gi, ' ');
  t = t.replace(/\[quote[^\]]*\][\s\S]*?\[\/quote\]/gi, ' ');
  t = t.replace(/\[replies[^\]]*\]/gi, ' ');
  t = t.replace(/\[(img|image|video|url)[^\]]*\][\s\S]*?\[\/\1\]/gi, ' ');
  // одиночные теги: [b], [/b], [anime=123], [character=1], смайлы :):
  t = t.replace(/\[[^\]]{1,60}\]/g, ' ');
  t = t.replace(/https?:\/\/\S+/g, ' ');
  t = t.replace(/@\S+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

function maskWord(t, word) {
  if (!word || word.length < 4) return t;
  const stem = word.slice(0, Math.max(4, word.length - 2)).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return t.replace(new RegExp(`[«"']?${stem}[\\p{L}\\p{N}-]*[»"']?`, 'giu'), '▮▮▮');
}

function maskTitles(text, anime) {
  let t = text;
  const phrases = [anime.russian, anime.name, anime.english, ...(anime.synonyms || [])]
    .filter(Boolean).flat().filter((s) => typeof s === 'string');
  // сначала целые фразы, потом отдельные значимые слова
  for (const p of phrases) {
    const esc = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    t = t.replace(new RegExp(esc, 'gi'), '▮▮▮');
  }
  for (const p of phrases) for (const w of p.split(/[\s:,.!?()\-—]+/)) t = maskWord(t, w);
  return t.replace(/(▮▮▮[\s,.-]*)+/g, '▮▮▮ ');
}

function goodComment(t) {
  if (t.length < 90 || t.length > 600) return false;
  const letters = (t.match(/\p{L}/gu) || []).length;
  const cyr = (t.match(/[а-яё]/gi) || []).length;
  return letters > 40 && cyr / letters >= 0.6;
}

// ---------- основной сбор ----------

async function collectPool() {
  const pool = [];
  for (let page = 1; pool.length < POOL_TARGET && page <= 20; page++) {
    const list = await api(`/animes?order=popularity&limit=50&page=${page}&score=7&censored=true`);
    if (!Array.isArray(list) || list.length === 0) break;
    for (const a of list) {
      if (!a.russian) continue;
      if (!['tv', 'movie'].includes(a.kind)) continue;
      pool.push(a);
    }
    console.log(`страница ${page}: в пуле ${pool.length}`);
  }
  return pool.slice(0, POOL_TARGET);
}

async function main() {
  await mkdir('data/comments', { recursive: true });
  const pool = await collectPool();
  const out = [];

  for (const [i, brief] of pool.entries()) {
    try {
      if (existsSync(`data/comments/${brief.id}.json`)) {
        const cached = await api(`/animes/${brief.id}`);
        out.push({ id: cached.id, r: cached.russian, n: cached.name,
          y: cached.aired_on ? Number(cached.aired_on.slice(0, 4)) : null,
          k: cached.kind, e: cached.episodes || cached.episodes_aired || null,
          g: (cached.genres || []).map((g) => g.russian).filter(Boolean).slice(0, 4),
          s: (cached.studios || [])[0]?.name || null, sc: cached.score,
          img: cached.image?.original ? `https://shikimori.one${cached.image.original}` : null,
          url: cached.url ? `https://shikimori.one${cached.url}` : null });
        console.log(`= [${i + 1}/${pool.length}] ${cached.russian} (уже собрано)`);
        continue;
      }
      const a = await api(`/animes/${brief.id}`);
      const topics = await api(`/animes/${a.id}/topics?limit=10`);
      const topic = (Array.isArray(topics) ? topics : []).find(
        (t) => t.type === 'Topics::EntryTopics::AnimeTopic'
      ) || (Array.isArray(topics) ? topics[0] : null);
      if (!topic) { console.log(`- ${a.russian}: нет топика`); continue; }

      const comments = [];
      for (let page = 1; comments.length < MAX_COMMENTS && page <= 3; page++) {
        const raw = await api(
          `/comments?commentable_id=${topic.id}&commentable_type=Topic&limit=30&page=${page}&desc=1`
        );
        if (!Array.isArray(raw) || raw.length === 0) break;
        for (const c of raw) {
          if (!c.body) continue;
          const cleaned = maskTitles(stripBb(c.body), a);
          if (goodComment(cleaned)) comments.push(cleaned);
          if (comments.length >= MAX_COMMENTS) break;
        }
      }
      if (comments.length < MIN_COMMENTS) {
        console.log(`- ${a.russian}: мало комментариев (${comments.length})`);
        continue;
      }

      out.push({
        id: a.id,
        r: a.russian,
        n: a.name,
        y: a.aired_on ? Number(a.aired_on.slice(0, 4)) : null,
        k: a.kind,
        e: a.episodes || a.episodes_aired || null,
        g: (a.genres || []).map((g) => g.russian).filter(Boolean).slice(0, 4),
        s: (a.studios || [])[0]?.name || null,
        sc: a.score,
        img: a.image?.original ? `https://shikimori.one${a.image.original}` : null,
        url: a.url ? `https://shikimori.one${a.url}` : null,
      });
      await writeFile(`data/comments/${a.id}.json`, JSON.stringify(comments), 'utf8');
      console.log(`+ [${i + 1}/${pool.length}] ${a.russian} (${comments.length} комм.)`);
    } catch (e) {
      console.log(`! ${brief.russian || brief.id}: ${e.message}`);
    }
  }

  if (out.length < 30) throw new Error(`Слишком мало аниме собрано: ${out.length}`);
  await writeFile('data/animes.json', JSON.stringify(out), 'utf8');
  await writeFile('data/meta.json', JSON.stringify({
    generated: new Date().toISOString(), count: out.length,
  }), 'utf8');
  console.log(`Готово: ${out.length} аниме.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
