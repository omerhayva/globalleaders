// Fetch national anthem audio from Wikimedia Commons via each anthem's Wikipedia article
// media list. These are typically public-domain instrumental recordings (e.g. US Navy Band).
// Stores direct Commons URLs in countries.anthem_audio.
const db = require('../server/db');
const HEADERS = { 'User-Agent': 'GlobalLeadersLive/1.0 (demo project)' };

async function fetchJson(url) {
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (r.status === 429 || r.status === 503) { await new Promise(s => setTimeout(s, 2000 * (a + 1))); continue; }
      if (!r.ok) return null;
      return await r.json();
    } catch { await new Promise(s => setTimeout(s, 1500)); }
  }
  return null;
}

async function commonsUrl(fileTitle) {
  const j = await fetchJson('https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url&titles=' + encodeURIComponent(fileTitle));
  if (!j) return null;
  const pages = j.query && j.query.pages;
  if (!pages) return null;
  const p = Object.values(pages)[0];
  return p && p.imageinfo && p.imageinfo[0] ? p.imageinfo[0].url : null;
}

async function anthemAudio(articleTitle) {
  const j = await fetchJson('https://en.wikipedia.org/api/rest_v1/page/media-list/' + encodeURIComponent(articleTitle) + '?redirect=true');
  if (!j) return null;
  const audio = (j.items || []).filter(i => i.type === 'audio' && /\.(ogg|oga|mp3|wav|flac|opus)$/i.test(i.title || ''));
  if (!audio.length) return null;
  audio.sort((a, b) => {
    const score = t => (/instrumental|band|navy|army|official/i.test(t) ? 0 : 1);
    return score(a.title) - score(b.title);
  });
  return await commonsUrl(audio[0].title);
}

(async () => {
  const countries = db.prepare('SELECT code, name, anthem_title FROM countries WHERE anthem_audio IS NULL').all();
  const upd = db.prepare('UPDATE countries SET anthem_audio=? WHERE code=?');
  let ok = 0;
  for (const c of countries) { await new Promise(s=>setTimeout(s,900));
    const title = c.anthem_title && c.anthem_title !== 'National Anthem' ? c.anthem_title : `National anthem of ${c.name}`;
    const url = await anthemAudio(title);
    if (url) { upd.run(url, c.code); ok++; process.stdout.write('.'); }
    else process.stdout.write('x');
  }
  console.log(`\nAnthem audio found for ${ok}/${countries.length} countries (Wikimedia Commons).`);
})();
