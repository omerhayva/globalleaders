// Sosyal medya önizleme kartları (og:image).
//
// Neden PNG? WhatsApp, X, Facebook ve Telegram gibi platformlar SVG'yi
// göstermez — paylaşılan bağlantıda görsel çıkmaz. Bu modül, mevcut SVG
// şablonunu sharp ile 1200×630 PNG'ye çevirip `var/og-cache/` altında
// önbelleğe alır. sharp kurulu değilse uç nokta SVG'ye geri düşer
// (server/render.js → ogCard), böylece sistem yine de çalışır.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let sharp = null;
try { sharp = require('sharp'); } catch { sharp = null; }

const CACHE_DIR = path.join(__dirname, '..', '..', 'var', 'og-cache');
const PORTRAIT_DIR = path.join(__dirname, '..', '..', 'public', 'portraits');
const FLAG_DIR = path.join(__dirname, '..', '..', 'public', 'flags', 'w160');
const CACHE_TTL_MS = 30 * 24 * 3600 * 1000;

const available = () => !!sharp;

const xml = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const num = n => Number(n || 0).toLocaleString('en-US');

function ensureCacheDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true }); } catch { }
}

function sweepCache() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(CACHE_DIR)) {
      const full = path.join(CACHE_DIR, f);
      const st = fs.statSync(full);
      if (now - st.mtimeMs > CACHE_TTL_MS) fs.unlinkSync(full);
    }
  } catch { }
}

// Yerel portre dosyasını (varsa) bulur: '/portraits/x.png' → public/portraits/x.png
function localFileFor(publicPath, dir) {
  const p = String(publicPath || '');
  if (!p || !p.startsWith('/')) return null;
  const base = path.basename(p);
  const candidate = path.join(dir, base);
  return fs.existsSync(candidate) ? candidate : null;
}

function backgroundSvg() {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#22305a"/></linearGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0e1730" stop-opacity="1"/><stop offset="0.55" stop-color="#0e1730" stop-opacity="0.55"/><stop offset="1" stop-color="#0e1730" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1080" cy="70" r="260" fill="#38bdf8" opacity="0.05"/>
  <rect x="0" y="0" width="10" height="630" fill="url(#bg)"/>
  <g font-family="DejaVu Sans, Arial, Helvetica" >
    <text x="72" y="76" font-size="27" font-weight="bold" fill="#7dd3fc" letter-spacing="3">GLOBAL LEADERS LIVE</text>
  </g>
</svg>`);
}

function textSvg({ rank, name, meta, hasFlag }) {
  const nameSize = name.length > 22 ? 44 : name.length > 16 ? 52 : 58;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <g font-family="DejaVu Sans, Arial, Helvetica">
    <text x="72" y="250" font-size="130" font-weight="bold" fill="#f5b524">#${xml(rank)}</text>
    <text x="72" y="336" font-size="${nameSize}" font-weight="bold" fill="#ffffff">${xml(name)}</text>
    <text x="${hasFlag ? 128 : 72}" y="388" font-size="31" fill="#94a3b8">${xml(meta)}</text>
    <text x="72" y="478" font-size="38" fill="#e2e8f0">“Do you agree?”</text>
    <text x="72" y="556" font-size="32" font-weight="bold" fill="#f5b524">VOTE NOW →</text>
    <text x="72" y="600" font-size="26" fill="#7dd3fc">globalleaders.live</text>
  </g>
</svg>`);
}

// Lider kartı: solda sıra + isim + oy sayısı, sağda portre ve bayrak.
async function leaderCardPng(leader, { baseDir } = {}) {
  if (!available()) return null;
  ensureCacheDir();
  const key = crypto.createHash('sha1').update([leader.slug, leader.name, leader.rank, leader.total_votes, leader.portrait || ''].join('|')).digest('hex').slice(0, 10);
  const file = path.join(CACHE_DIR, `leader-${leader.slug}-${key}.png`);
  if (fs.existsSync(file)) return { file, contentType: 'image/png', cached: true };

  const composites = [{ input: backgroundSvg(), top: 0, left: 0 }];
  const layers = [];

  const portraitFile = localFileFor(leader.portrait, PORTRAIT_DIR);
  if (portraitFile) {
    try {
      const img = await sharp(portraitFile).resize(470, 630, { fit: 'cover', position: 'north' }).toBuffer();
      composites.push({ input: img, top: 0, left: 730 });
      composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="630"><rect width="200" height="630" fill="url(#fade)"/><defs><linearGradient id="fade" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#0e1730" stop-opacity="1"/><stop offset="1" stop-color="#0e1730" stop-opacity="0"/></linearGradient></defs></svg>`), top: 0, left: 600 });
    } catch { /* bozuk görsel: portsuz devam */ }
  }

  const flagFile = FLAG_DIR && leader.country_code ? path.join(FLAG_DIR, `${String(leader.country_code).toLowerCase()}.png`) : null;
  const hasFlag = !!(flagFile && fs.existsSync(flagFile));
  composites.push({ input: textSvg({ rank: leader.rank, name: leader.name, meta: `${num(leader.total_votes)} votes · ${leader.countryName || leader.country_code}`, hasFlag }), top: 0, left: 0 });

  if (hasFlag) {
    try {
      const flag = await sharp(flagFile).resize(42, 28, { fit: 'cover' }).toBuffer();
      composites.push({ input: flag, top: 366, left: 72 });
    } catch { }
  }

  await sharp({ create: { width: 1200, height: 630, channels: 4, background: '#0b1220' } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(file);

  // Aynı liderin eski kartlarını temizle (isim/oy değişince yeni hash oluşur).
  try {
    for (const f of fs.readdirSync(CACHE_DIR)) {
      if (f.startsWith(`leader-${leader.slug}-`) && f !== path.basename(file)) fs.unlinkSync(path.join(CACHE_DIR, f));
    }
  } catch { }

  return { file, contentType: 'image/png', cached: false };
}

module.exports = { available, leaderCardPng, sweepCache, CACHE_DIR };
