// Admin API — cookie-auth (HMAC token). Default password stored in site_settings.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');
const core = require('./core');
const seed = require('./seed');
const sse = require('./services/sse');
const { rateLimit } = require('./services/ratelimit');
const uploads = require('./services/uploads');
const { sanitizeUrl, cleanText } = require('./services/sanitize');

const router = express.Router();
// Gizli anahtar: process başına rastgele (veya GL_ADMIN_SECRET env).
// Sabit kodlanmış anahtar token'ların süre boyunca geçerli kalmasını sağlıyordu.
const SECRET = process.env.GL_ADMIN_SECRET || crypto.randomBytes(32).toString('hex');
const TOKEN_TTL_MS = 12 * 3600 * 1000;
const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const makeToken = () => { const t = 'adm.' + Date.now(); return t + '.' + sign(t); };
const validToken = tok => {
  if (!tok || typeof tok !== 'string') return false;
  const i = tok.lastIndexOf('.');
  if (i <= 0) return false;
  const base = tok.slice(0, i), sig = tok.slice(i + 1);
  const expected = sign(base);
  // sürekli uzunlukta karşılaştırma + süre kontrolü (çalınan token artık süresiz değil)
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const ts = parseInt(base.split('.')[1], 10);
  return Number.isFinite(ts) && Date.now() - ts < TOKEN_TTL_MS;
};
// Parola karşılaştırması: hash üzerinden timing-safe (yan kanal sızıntısı yok).
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const passwordOk = (pw) => {
  const stored = String(core.getSetting('admin_password') || 'leaders2026');
  const a = Buffer.from(sha256(pw), 'hex'), b = Buffer.from(sha256(stored), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

router.post('/login', rateLimit({ windowMs: 10 * 60_000, max: 5, name: 'admin-login', message: 'Too many attempts. Try again in a few minutes.' }), (req, res) => {
  const pw = String((req.body || {}).password || '');
  if (!passwordOk(pw)) {
    return res.status(401).json({ error: 'wrong_password' });
  }
  res.cookie('gl_admin', makeToken(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: TOKEN_TTL_MS });
  res.json({ ok: true });
});
router.post('/logout', (req, res) => { res.clearCookie('gl_admin'); res.json({ ok: true }); });
router.get('/me', (req, res) => res.json({ admin: validToken(req.cookies.gl_admin) }));

router.use((req, res, next) => validToken(req.cookies.gl_admin) ? next() : res.status(401).json({ error: 'unauthorized' }));

// ---- dashboard / analytics ----
router.get('/dashboard', (req, res) => {
  const day = seed.dayStr();
  const revenue = period => db.prepare(
    `SELECT COALESCE(SUM(amount_usd),0) s FROM payments WHERE status='succeeded' AND created_at >= datetime('now', ?)`).get(period).s;
  res.json({
    stats: core.globalStats(),
    demoMode: core.getSetting('demo_mode') === '1',
    simulator: core.getSetting('simulator_enabled') === '1',
    sseClients: sse.count(),
    votesPerHour: db.prepare(`SELECT COUNT(*) c FROM votes WHERE created_at >= datetime('now','-1 hour')`).get().c,
    votesByCountry: db.prepare(`SELECT country, COUNT(*) c FROM votes WHERE created_at >= datetime('now','-7 day') GROUP BY country ORDER BY c DESC LIMIT 12`).all(),
    sessions: db.prepare('SELECT COUNT(DISTINCT session_id) c FROM vote_sessions').get().c,
    sessionsToday: db.prepare('SELECT COUNT(*) c FROM vote_sessions WHERE day=?').get(day).c,
    shares: db.prepare('SELECT COUNT(*) c FROM shares').get().c,
    referralClicks: db.prepare('SELECT COUNT(*) c FROM referrals').get().c,
    referralConversions: db.prepare('SELECT COUNT(*) c FROM referrals WHERE converted=1').get().c,
    fraudCount: db.prepare('SELECT COUNT(*) c FROM fraud_events').get().c,
    revenue: {
      total: revenue('-100 years'), today: revenue('-1 day'), week: revenue('-7 day'), month: revenue('-30 day'),
      ads: db.prepare(`SELECT COALESCE(SUM(amount_usd),0) s FROM ad_purchases`).get().s,
      anthems: db.prepare(`SELECT COALESCE(SUM(amount_usd),0) s FROM anthem_purchases`).get().s,
      votes: 0,
      topCountries: db.prepare(`SELECT country_code cc, COALESCE(SUM(amount_usd),0) s FROM anthem_purchases GROUP BY country_code ORDER BY s DESC LIMIT 5`).all()
    },
    topViral: db.prepare(`SELECT l.name, l.slug, COUNT(s.id) shares, COALESCE(SUM(s.clicks),0) clicks
      FROM shares s JOIN leaders l ON l.id=s.leader_id GROUP BY l.id ORDER BY shares DESC LIMIT 8`).all()
  });
});

// ---- leaders CRUD ----
router.get('/leaders', (req, res) => {
  const q = `%${String(req.query.q || '')}%`;
  res.json(db.prepare(`SELECT * FROM leaders WHERE name LIKE ? ORDER BY total_votes DESC LIMIT 300`).all(q));
});
router.post('/leaders', (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.country_code) return res.status(400).json({ error: 'name and country_code required' });
  const cc = String(b.country_code).toUpperCase();
  db.prepare(`INSERT OR IGNORE INTO countries (code,name,anthem_title) VALUES (?,?, 'National Anthem')`)
    .run(cc, new Intl.DisplayNames(['en'], { type: 'region' }).of(cc) || cc);
  const slug = b.slug || seed.slugify(b.name);
  db.prepare(`INSERT INTO leaders (slug,name,country_code,status,categories,era,years,title,bio,visible,featured,verified)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(slug, b.name, cc, b.status || 'historical', JSON.stringify(b.categories || []),
      b.era || '', b.years || '', b.title || '', b.bio || '', b.visible ?? 1, b.featured ?? 0, b.verified ?? 1);
  seed.recomputeRanks();
  res.json({ ok: true, slug });
});
router.put('/leaders/:id', (req, res) => {
  const b = req.body || {};
  const fields = ['name','country_code','status','era','years','title','bio','visible','featured','verified','sort_order','portrait'];
  const sets = [], args = [];
  fields.forEach(f => { if (b[f] !== undefined) { sets.push(`${f}=?`); args.push(b[f]); } });
  if (b.categories !== undefined) { sets.push('categories=?'); args.push(JSON.stringify(b.categories)); }
  if (!sets.length) return res.json({ ok: true });
  args.push(req.params.id);
  db.prepare(`UPDATE leaders SET ${sets.join(',')} WHERE id=?`).run(...args);
  seed.recomputeRanks();
  res.json({ ok: true });
});
router.delete('/leaders/:id', (req, res) => {
  db.prepare('DELETE FROM leaders WHERE id=?').run(req.params.id);
  seed.recomputeRanks();
  res.json({ ok: true });
});

// portrait upload (base64 JSON, validated)
router.post('/leaders/:id/portrait', (req, res) => {
  const saved = saveImage((req.body || {}).data, 'portrait-' + req.params.id);
  if (saved.error) return res.status(400).json(saved);
  db.prepare('UPDATE leaders SET portrait=? WHERE id=?').run(saved.path, req.params.id);
  res.json({ ok: true, path: saved.path });
});

// ---- countries ----
router.get('/countries', (req, res) => res.json(db.prepare('SELECT * FROM countries ORDER BY name').all()));
router.put('/countries/:code', (req, res) => {
  const b = req.body || {};
  db.prepare('UPDATE countries SET name=COALESCE(?,name), anthem_title=COALESCE(?,anthem_title), status=COALESCE(?,status) WHERE code=?')
    .run(b.name ?? null, b.anthem_title ?? null, b.status ?? null, req.params.code.toUpperCase());
  res.json({ ok: true });
});
// legally-cleared anthem audio upload (admin only)
router.post('/countries/:code/anthem-audio', (req, res) => {
  const { data } = req.body || {};
  const saved = saveAudio(data, 'anthem-' + req.params.code.toLowerCase());
  if (saved.error) return res.status(400).json(saved);
  db.prepare('UPDATE countries SET anthem_audio=? WHERE code=?').run(saved.path, req.params.code.toUpperCase());
  res.json({ ok: true, path: saved.path });
});

// ---- votes / users / fraud / moderation ----
router.get('/votes', (req, res) => res.json(db.prepare(
  `SELECT v.id, l.name leader, v.type, v.source, v.country, v.created_at FROM votes v
   JOIN leaders l ON l.id=v.leader_id ORDER BY v.id DESC LIMIT 100`).all()));
router.get('/fraud', (req, res) => res.json(db.prepare('SELECT * FROM fraud_events ORDER BY id DESC LIMIT 200').all()));
router.get('/sessions', (req, res) => res.json(db.prepare('SELECT id,day,free_used,bonus_earned,bonus_used,suspended FROM vote_sessions ORDER BY created_at DESC LIMIT 100').all()));
router.post('/sessions/:id/suspend', (req, res) => {
  db.prepare('UPDATE vote_sessions SET suspended=? WHERE id=?').run(req.body.suspended ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// ---- ads ----
router.get('/ads', (req, res) => res.json({
  slots: db.prepare('SELECT * FROM advertising_slots').all(),
  ads: db.prepare('SELECT * FROM advertisements ORDER BY id DESC LIMIT 50').all(),
  purchases: db.prepare('SELECT * FROM ad_purchases ORDER BY id DESC LIMIT 50').all()
}));
router.post('/ads', (req, res) => {
  const b = req.body || {};
  if (!b.slot_id) return res.status(400).json({ error: 'slot_id required' });
  // Görsel: sunucu tarafında doğrulanıp /uploads'a yazılır (ham data-uri DB'ye girmez).
  let img = b.image || null;
  if (img && String(img).startsWith('data:')) {
    const saved = uploads.saveImage(img, 'ad-' + Date.now());
    if (saved.error) return res.status(400).json({ error: 'bad_image', message: saved.error });
    img = saved.path;
  }
  db.prepare(`UPDATE advertisements SET status='replaced' WHERE slot_id=? AND status='active'`).run(b.slot_id);
  db.prepare(`INSERT INTO advertisements (slot_id,advertiser,image,text,cta,url,starts_at,ends_at,status)
    VALUES (?,?,?,?,?,?,COALESCE(?,datetime('now')),?, 'active')`)
    .run(b.slot_id, cleanText(b.advertiser, 60) || 'Admin', img, cleanText(b.text, 120) || '',
         cleanText(b.cta, 30) || '', sanitizeUrl(b.url), b.starts_at || null, b.ends_at || null);
  sse.broadcast('ad_purchased', { slotId: b.slot_id, advertiser: cleanText(b.advertiser, 60) || 'Admin' });
  res.json({ ok: true });
});
router.post('/ads/:id/remove', (req, res) => {
  db.prepare(`UPDATE advertisements SET status='removed' WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
});
router.post('/ads/image', (req, res) => {
  const saved = saveImage((req.body || {}).data, 'ad-' + Date.now());
  saved.error ? res.status(400).json(saved) : res.json(saved);
});

// ---- anthems / purchases / payments ----
router.get('/anthems', (req, res) => res.json({
  slots: db.prepare(`SELECT a.*, c.name FROM anthem_slots a JOIN countries c ON c.code=a.country_code ORDER BY a.purchased_at DESC`).all(),
  purchases: db.prepare('SELECT * FROM anthem_purchases ORDER BY id DESC LIMIT 50').all()
}));
router.post('/anthems/:code/clear', (req, res) => {
  db.prepare('DELETE FROM anthem_slots WHERE country_code=?').run(req.params.code.toUpperCase());
  db.prepare('INSERT INTO anthem_history (country_code,sponsor,event) VALUES (?,?,?)').run(req.params.code.toUpperCase(), 'admin', 'cleared');
  res.json({ ok: true });
});
router.get('/payments', (req, res) => res.json(db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 100').all()));

// ---- share analytics ----
router.get('/share-analytics', (req, res) => res.json({
  byPlatform: db.prepare('SELECT platform, COUNT(*) c, SUM(clicks) clicks FROM shares GROUP BY platform ORDER BY c DESC').all(),
  recent: db.prepare(`SELECT s.id, l.name leader, s.platform, s.clicks, s.created_at FROM shares s JOIN leaders l ON l.id=s.leader_id ORDER BY s.created_at DESC LIMIT 50`).all()
}));

// ---- settings & demo tools ----
router.get('/settings', (req, res) => res.json(Object.fromEntries(db.prepare('SELECT key,value FROM site_settings').all().map(r => [r.key, r.value]))));
router.post('/settings', (req, res) => {
  Object.entries(req.body || {}).forEach(([k, v]) => core.setSetting(k, v));
  res.json({ ok: true });
});
router.post('/demo/reset', (req, res) => { seed.resetDemoData(); res.json({ ok: true }); });
router.post('/demo/seed-votes', (req, res) => { seed.seedDemoVotes(); res.json({ ok: true }); });
router.post('/demo/clear-votes', (req, res) => { seed.clearDemoVotes(); res.json({ ok: true }); });
router.post('/demo/clear-purchases', (req, res) => {
  ['advertisements','ad_purchases','anthem_purchases','anthem_history','payments'].forEach(t => db.prepare(`DELETE FROM ${t}`).run());
  db.prepare('DELETE FROM anthem_slots').run();
  res.json({ ok: true });
});

// ---- upload validation helpers (paylaşılan: services/uploads.js) ----
const saveImage = uploads.saveImage;
const saveAudio = uploads.saveAudio;

module.exports = router;
