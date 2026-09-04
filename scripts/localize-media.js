// Download all remote (Wikimedia) portraits + anthem audio to local /public so they are
// served from our own domain — no external dependency, works even where Wikimedia is blocked.
const db = require('../server/db');
const fs = require('fs');
const path = require('path');

const PORTRAITS = path.join(__dirname, '..', 'public', 'portraits');
const ANTHEMS = path.join(__dirname, '..', 'public', 'anthems');
fs.mkdirSync(PORTRAITS, { recursive: true });
fs.mkdirSync(ANTHEMS, { recursive: true });

const HEADERS = { 'User-Agent': 'GlobalLeadersLive/1.0 (demo project)' };
const extOf = (url, fallback) => {
  const m = /\.(jpe?g|png|gif|webp|oga|ogg|mp3|wav|opus|flac)(\?|$)/i.exec(url);
  return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : fallback;
};

async function download(url, dest, maxBytes) {
  // Wikimedia only serves whitelisted thumb widths to non-browser clients: use 960px.
  const clean = url.split('?')[0];
  const candidates = [];
  if (/\/thumb\//.test(clean) && /\/\d+px-[^/]+$/.test(clean)) {
    candidates.push(clean.replace(/\/\d+px-([^/]+)$/, '/960px-$1'));
    candidates.push(clean.replace(/\/\d+px-([^/]+)$/, '/500px-$1'));
    candidates.push(clean.replace(/\/thumb(\/[^/]+\/[^/]+\/[^/]+)\/\d+px-[^/]+$/, '$1')); // original file
  } else {
    candidates.push(clean);
  }
  for (const u of candidates) {
    for (let a = 0; a < 3; a++) {
      try {
        const r = await fetch(u, { headers: HEADERS });
        if (r.status === 429 || r.status === 503) { await new Promise(s => setTimeout(s, 2500 * (a + 1))); continue; }
        if (!r.ok) break; // try next candidate
        const buf = Buffer.from(await r.arrayBuffer());
        if (maxBytes && buf.length > maxBytes) break;
        fs.writeFileSync(dest, buf);
        return { size: buf.length };
      } catch { await new Promise(s => setTimeout(s, 1500)); }
    }
  }
  return null;
}

(async () => {
  // ---- portraits ----
  const leaders = db.prepare(`SELECT id, slug, portrait FROM leaders WHERE portrait LIKE 'http%'`).all();
  console.log(`Portraits to localize: ${leaders.length}`);
  let pOk = 0, pBytes = 0;
  for (const l of leaders) {
    const ext = extOf(l.portrait, 'jpg');
    const file = `${l.slug}.${ext}`;
    const dest = path.join(PORTRAITS, file);
    if (!fs.existsSync(dest)) {
      const r = await download(l.portrait, dest, 4 * 1024 * 1024);
      if (!r) { process.stdout.write('x'); continue; }
      pBytes += r.size;
      await new Promise(s => setTimeout(s, 200));
    }
    db.prepare('UPDATE leaders SET portrait=? WHERE id=?').run('/portraits/' + file, l.id);
    pOk++; process.stdout.write('.');
  }
  console.log(`\nPortraits localized: ${pOk}/${leaders.length} (${(pBytes / 1048576).toFixed(1)} MB)`);

  // ---- anthem audio (cap 6MB per file, ~70MB total budget) ----
  const countries = db.prepare(`SELECT code, anthem_audio FROM countries WHERE anthem_audio LIKE 'http%'`).all();
  console.log(`Anthems to localize: ${countries.length}`);
  let aOk = 0, aBytes = 0;
  for (const c of countries) {
    if (aBytes > 70 * 1024 * 1024) { console.log('\nAudio budget reached, keeping remaining remote.'); break; }
    const clean = c.anthem_audio.split('?')[0];
    // Wikimedia transcoded MP3: better browser support (Safari can't play .oga) and served reliably
    const m = /\/commons\/(\w)\/(\w\w)\/([^/]+)$/.exec(clean);
    const mp3Url = m ? `https://upload.wikimedia.org/wikipedia/commons/transcoded/${m[1]}/${m[2]}/${m[3]}/${m[3]}.mp3` : clean;
    const file = `${c.code.toLowerCase()}.mp3`;
    const dest = path.join(ANTHEMS, file);
    if (!fs.existsSync(dest)) {
      const r = await download(mp3Url, dest, 8 * 1024 * 1024) || await download(clean, path.join(ANTHEMS, `${c.code.toLowerCase()}.oga`), 8 * 1024 * 1024);
      if (!r) { process.stdout.write('x'); continue; }
      aBytes += r.size;
      await new Promise(s => setTimeout(s, 400));
    }
    const finalFile = fs.existsSync(dest) ? file : `${c.code.toLowerCase()}.oga`;
    db.prepare('UPDATE countries SET anthem_audio=? WHERE code=?').run('/anthems/' + finalFile, c.code);
    aOk++; process.stdout.write('.');
  }
  console.log(`\nAnthems localized: ${aOk}/${countries.length} (${(aBytes / 1048576).toFixed(1)} MB)`);
})();
