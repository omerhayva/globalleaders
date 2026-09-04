// Fetch real, high-resolution leader portraits from Wikipedia (freely licensed / PD images
// served by Wikimedia). Stores URLs in leaders.portrait and data/portraits.json.
const db = require('../server/db');
const fs = require('fs');
const path = require('path');

// slug -> exact Wikipedia article title (for names that don't match 1:1)
const OVERRIDES = {
  'salah-ad-din': 'Saladin',
  'cleopatra-vii': 'Cleopatra',
  'ramses-ii': 'Ramesses II',
  'shaka-zulu': 'Shaka',
  'king-faisal': 'Faisal of Saudi Arabia',
  'sheikh-zayed-bin-sultan': 'Zayed bin Sultan Al Nahyan',
  'king-abdullah-ii': 'Abdullah II of Jordan',
  'ashoka-the-great': 'Ashoka',
  'akbar-the-great': 'Akbar',
  'timur': 'Timur',
  'sejong-the-great': 'Sejong the Great',
  'king-bhumibol-adulyadej': 'Bhumibol Adulyadej',
  'queen-elizabeth-ii': 'Elizabeth II',
  'queen-victoria': 'Queen Victoria',
  'king-charles-iii': 'Charles III',
  'napoleon-bonaparte': 'Napoleon',
  'leonidas-i': 'Leonidas I',
  'isabella-i-of-castile': 'Isabella I of Castile',
  'william-of-orange': 'William the Silent',
  'gustavus-adolphus': 'Gustavus Adolphus',
  'michael-collins': 'Michael Collins (Irish leader)',
  'volodymyr-zelensky': 'Volodymyr Zelenskyy',
  'moctezuma-ii': 'Moctezuma II',
  'pedro-ii-of-brazil': 'Pedro II of Brazil',
  'jose-marti': 'José Martí',
  'jose-de-san-martin': 'José de San Martín',
  'mustafa-kemal-ataturk': 'Mustafa Kemal Atatürk',
  'recep-tayyip-erdogan': 'Recep Tayyip Erdoğan',
  'lech-walesa': 'Lech Wałęsa',
  'vaclav-havel': 'Václav Havel',
  'pedro-sanchez': 'Pedro Sánchez',
  'darius-i': 'Darius the Great',
  'emperor-meiji': 'Emperor Meiji',
  'aung-san': 'Aung San',
  'mark-carney': 'Mark Carney',
  'ferdinand-marcos-jr': 'Bongbong Marcos',
  'mohammed-bin-salman': 'Mohammed bin Salman',
  'sitting-bull': 'Sitting Bull',
  'atahualpa': 'Atahualpa',
  'josip-broz-tito': 'Josip Broz Tito',
  'lester-b-pearson': 'Lester B. Pearson',
  'luiz-inacio-lula-da-silva': 'Luiz Inácio Lula da Silva',
  'simon-bolivar': 'Simón Bolívar',
  'benito-juarez': 'Benito Juárez',
  'claudia-sheinbaum': 'Claudia Sheinbaum',
  'friedrich-merz': 'Friedrich Merz',
  'lee-jae-myung': 'Lee Jae-myung',
};

const HEADERS = { 'User-Agent': 'GlobalLeadersLive/1.0 (demo project)' };

// Build a high-res (~800px) thumbnail URL from the summary response.
function pickImage(sum) {
  const orig = sum.originalimage, thumb = sum.thumbnail;
  if (!orig && !thumb) return null;
  if (thumb && /\/thumb\//.test(thumb.source)) {
    const target = Math.min(800, orig ? orig.width : 800);
    return thumb.source.replace(/\/(\d+)px-([^/]+)$/, `/${target}px-$2`);
  }
  if (orig && orig.width <= 1600) return orig.source; // small originals: use directly
  return thumb ? thumb.source : orig.source;
}

async function fetchOne(l) {
  const title = OVERRIDES[l.slug] || l.name;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(title) + '?redirect=true', { headers: HEADERS });
      if (r.status === 429 || r.status === 503) { await new Promise(s => setTimeout(s, 1500 * (attempt + 1))); continue; }
      if (!r.ok) return null;
      const sum = await r.json();
      return pickImage(sum);
    } catch { await new Promise(s => setTimeout(s, 1000)); }
  }
  return null;
}

(async () => {
  const leaders = db.prepare('SELECT id, slug, name FROM leaders WHERE portrait IS NULL').all();
  const results = {}; const misses = [];
  for (const l of leaders) {
    const url = await fetchOne(l);
    if (url) results[l.slug] = url; else misses.push(l.slug);
    process.stdout.write(url ? '.' : 'x');
    await new Promise(s => setTimeout(s, 1200)); // stay under rate limits
  }
  console.log(`\nFound ${Object.keys(results).length}/${leaders.length} portraits. Misses: ${misses.join(', ') || 'none'}`);
  const upd = db.prepare('UPDATE leaders SET portrait=? WHERE slug=?');
  const tx = db.transaction(() => Object.entries(results).forEach(([slug, url]) => upd.run(url, slug)));
  tx();
  const fsPath = path.join(__dirname, '..', 'server', 'data', 'portraits.json');
  const existing = fs.existsSync(fsPath) ? JSON.parse(fs.readFileSync(fsPath, 'utf8')) : {};
  fs.writeFileSync(fsPath, JSON.stringify({ ...existing, ...results }, null, 1));
  console.log('Saved to DB + server/data/portraits.json');
})();
