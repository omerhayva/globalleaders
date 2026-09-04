// Admin API — cookie-auth (HMAC token). Production secrets come only from environment.
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
const { fulfillPayment, rejectPayment } = require('./services/payment-fulfillment');

const router = express.Router();
const SECRET = process.env.GL_ADMIN_SECRET;
const ADMIN_PASSWORD = process.env.GL_ADMIN_PASSWORD;
const TOKEN_TTL_MS = 12 * 3600 * 1000;

const sign = v => crypto.createHmac('sha256', SECRET || 'missing-admin-secret').update(v).digest('hex');
const makeToken = () => { const t = 'adm.' + Date.now(); return t + '.' + sign(t); };
const validToken = tok => {
  if (!SECRET || !tok || typeof tok !== 'string') return false;
  const i = tok.lastIndexOf('.');
  if (i <= 0) return false;
  const base = tok.slice(0, i), sig = tok.slice(i + 1);
  const expected = sign(base);
  if (sig.length !== expected.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const ts = parseInt(base.split('.')[1], 10);
  return Number.isFinite(ts) && Date.now() - ts >= 0 && Date.now() - ts < TOKEN_TTL_MS;
};
const passwordOk = pw => {
  if (!ADMIN_PASSWORD) return false;
  const a = crypto.createHash('sha256').update(String(pw)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
};

router.post('/login', rateLimit({ windowMs: 10 * 60_000, max: 5, name: 'admin-login', message: 'Too many attempts. Try again in a few minutes.' }), (req, res) => {
  if (!SECRET || !ADMIN_PASSWORD) return res.status(503).json({ error: 'admin_credentials_not_configured' });
  const pw = String((req.body || {}).password || '');
  if (!passwordOk(pw)) return res.status(401).json({ error: 'wrong_password' });
  res.cookie('gl_admin', makeToken(), { httpOnly: true, sameSite: 'lax', secure: req.secure, maxAge: TOKEN_TTL_MS });
  res.json({ ok: true });
});
router.post('/logout', (req, res) => { res.clearCookie('gl_admin'); res.json({ ok: true }); });
router.get('/me', (req, res) => res.json({ admin: validToken(req.cookies.gl_admin) }));

router.use((req, res, next) => validToken(req.cookies.gl_admin) ? next() : res.status(401).json({ error: 'unauthorized' }));

// ---- dashboard / analytics ----
router.get('/dashboard', (req, res) => {
  const day = seed.dayStr();
  const revenue = period => db.prepare(`SELECT COALESCE(SUM(amount_usd),0) s FROM payments WHERE status='succeeded' AND created_at >= datetime('now', ?)`).get(period).s;
  res.json({
    stats: core.globalStats(), sseClients: sse.count(),
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
    topViral: db.prepare(`SELECT l.name, l.slug, COUNT(s.id) shares, COALESCE(SUM(s.clicks),0) clicks FROM shares s JOIN leaders l ON l.id=s.leader_id GROUP BY l.id ORDER BY shares DESC LIMIT 8`).all()
  });
});

// ---- leaders CRUD ----
router.get('/leaders', (req, res) => { const q = `%${String(req.query.q || '').slice(0, 100)}%`; res.json(db.prepare(`SELECT * FROM leaders WHERE name LIKE ? ORDER BY total_votes DESC LIMIT 300`).all(q)); });
router.post('/leaders', (req, res) => {
  const b = req.body || {}; const name = cleanText(b.name, 80); const cc = String(b.country_code || '').trim().toUpperCase();
  if (name.length < 2 || !/^[A-Z]{2}$/.test(cc)) return res.status(400).json({ error: 'valid name and country_code required' });
  const countryName = new Intl.DisplayNames(['en'], { type: 'region' }).of(cc); if (!countryName) return res.status(400).json({ error: 'invalid_country' });
  db.prepare(`INSERT OR IGNORE INTO countries (code,name,anthem_title) VALUES (?,?, 'National Anthem')`).run(cc, countryName);
  const slug = seed.slugify(name); if (db.prepare('SELECT 1 FROM leaders WHERE slug=?').get(slug)) return res.status(409).json({ error: 'slug_exists' });
  const status = ['current','historical'].includes(b.status) ? b.status : 'historical'; const categories = Array.isArray(b.categories) ? b.categories.slice(0, 12).map(x => cleanText(x, 40)) : [];
  db.prepare(`INSERT INTO leaders (slug,name,country_code,status,categories,era,years,title,bio,visible,featured,verified) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, name, cc, status, JSON.stringify(categories), cleanText(b.era, 60), cleanText(b.years, 40), cleanText(b.title, 100), cleanText(b.bio, 1200), b.visible ? 1 : 0, b.featured ? 1 : 0, b.verified ? 1 : 0);
  seed.recomputeRanks(); res.json({ ok: true, slug });
});
router.put('/leaders/:id', (req, res) => {
  const b = req.body || {}; const fields = ['name','country_code','status','era','years','title','bio','visible','featured','verified','sort_order','portrait']; const sets = [], args = [];
  if (b.name !== undefined) { const v = cleanText(b.name, 80); if (v.length < 2) return res.status(400).json({ error: 'invalid_name' }); sets.push('name=?'); args.push(v); }
  if (b.country_code !== undefined) { const v = String(b.country_code).toUpperCase(); if (!/^[A-Z]{2}$/.test(v)) return res.status(400).json({ error: 'invalid_country' }); sets.push('country_code=?'); args.push(v); }
  for (const f of fields.filter(x => !['name','country_code'].includes(x))) if (b[f] !== undefined) { sets.push(`${f}=?`); args.push(['visible','featured','verified'].includes(f) ? (b[f] ? 1 : 0) : cleanText(b[f], f === 'bio' ? 1200 : 200)); }
  if (b.categories !== undefined) { if (!Array.isArray(b.categories)) return res.status(400).json({ error: 'invalid_categories' }); sets.push('categories=?'); args.push(JSON.stringify(b.categories.slice(0,12).map(x => cleanText(x,40)))); }
  if (!sets.length) return res.json({ ok: true }); args.push(req.params.id); db.prepare(`UPDATE leaders SET ${sets.join(',')} WHERE id=?`).run(...args); seed.recomputeRanks(); res.json({ ok: true });
});
router.delete('/leaders/:id', (req, res) => { const info = db.prepare(`UPDATE leaders SET visible=0, featured=0, status='archived' WHERE id=?`).run(req.params.id); seed.recomputeRanks(); res.json({ ok: info.changes > 0, archived: info.changes > 0 }); });
router.post('/leaders/:id/portrait', (req, res) => { const saved = uploads.saveImage((req.body || {}).data, 'portrait-' + req.params.id); if (saved.error) return res.status(400).json(saved); db.prepare('UPDATE leaders SET portrait=? WHERE id=?').run(saved.path, req.params.id); res.json({ ok: true, path: saved.path }); });

// ---- countries ----
router.get('/countries', (req, res) => res.json(db.prepare('SELECT * FROM countries ORDER BY name').all()));
router.put('/countries/:code', (req, res) => { const b = req.body || {}; const code = String(req.params.code || '').toUpperCase(); if (!/^[A-Z]{2}$/.test(code)) return res.status(400).json({ error: 'invalid_country' }); db.prepare('UPDATE countries SET name=COALESCE(?,name), anthem_title=COALESCE(?,anthem_title), status=COALESCE(?,status) WHERE code=?').run(b.name === undefined ? null : cleanText(b.name, 100), b.anthem_title === undefined ? null : cleanText(b.anthem_title, 160), b.status === undefined ? null : cleanText(b.status, 30), code); res.json({ ok: true }); });
router.post('/countries/:code/anthem-audio', (req, res) => { const code = String(req.params.code || '').toUpperCase(); if (!/^[A-Z]{2}$/.test(code)) return res.status(400).json({ error: 'invalid_country' }); const saved = uploads.saveAudio((req.body || {}).data, 'anthem-' + code.toLowerCase()); if (saved.error) return res.status(400).json(saved); db.prepare('UPDATE countries SET anthem_audio=? WHERE code=?').run(saved.path, code); res.json({ ok: true, path: saved.path }); });

// ---- votes / users / fraud / moderation ----
router.get('/votes', (req, res) => res.json(db.prepare(`SELECT v.id, l.name leader, v.type, v.source, v.country, v.created_at FROM votes v JOIN leaders l ON l.id=v.leader_id ORDER BY v.id DESC LIMIT 100`).all()));
router.get('/fraud', (req, res) => res.json(db.prepare('SELECT * FROM fraud_events ORDER BY id DESC LIMIT 200').all()));
router.get('/sessions', (req, res) => res.json(db.prepare('SELECT id,day,free_used,bonus_earned,bonus_used,suspended FROM vote_sessions ORDER BY created_at DESC LIMIT 100').all()));
router.post('/sessions/:id/suspend', (req, res) => { db.prepare('UPDATE vote_sessions SET suspended=? WHERE id=?').run(req.body.suspended ? 1 : 0, req.params.id); res.json({ ok: true }); });

// ---- ads ----
router.get('/ads', (req, res) => res.json({ slots: db.prepare('SELECT * FROM advertising_slots').all(), ads: db.prepare('SELECT * FROM advertisements ORDER BY id DESC LIMIT 50').all(), purchases: db.prepare('SELECT * FROM ad_purchases ORDER BY id DESC LIMIT 50').all() }));
router.post('/ads', (req, res) => {
  const b = req.body || {}; if (!b.slot_id) return res.status(400).json({ error: 'slot_id required' }); let img = b.image || null;
  if (img && String(img).startsWith('data:')) { const saved = uploads.saveImage(img, 'ad-' + Date.now()); if (saved.error) return res.status(400).json({ error: 'bad_image', message: saved.error }); img = saved.path; }
  db.prepare(`UPDATE advertisements SET status='replaced' WHERE slot_id=? AND status='active'`).run(b.slot_id); db.prepare(`INSERT INTO advertisements (slot_id,advertiser,image,text,cta,url,starts_at,ends_at,status) VALUES (?,?,?,?,?,?,COALESCE(?,datetime('now')),?, 'active')`).run(b.slot_id, cleanText(b.advertiser, 60) || 'Admin', img, cleanText(b.text, 120) || '', cleanText(b.cta, 30) || '', sanitizeUrl(b.url), b.starts_at || null, b.ends_at || null); sse.broadcast('ad_purchased', { slotId: b.slot_id, advertiser: cleanText(b.advertiser, 60) || 'Admin' }); res.json({ ok: true });
});
router.post('/ads/:id/remove', (req, res) => { db.prepare(`UPDATE advertisements SET status='removed' WHERE id=?`).run(req.params.id); res.json({ ok: true }); });
router.post('/ads/image', (req, res) => { const saved = uploads.saveImage((req.body || {}).data, 'ad-' + Date.now()); saved.error ? res.status(400).json(saved) : res.json(saved); });

// ---- anthems / purchases / payments ----
router.get('/anthems', (req, res) => res.json({ slots: db.prepare(`SELECT a.*, c.name FROM anthem_slots a JOIN countries c ON c.code=a.country_code ORDER BY a.purchased_at DESC`).all(), purchases: db.prepare('SELECT * FROM anthem_purchases ORDER BY id DESC LIMIT 50').all() }));
router.post('/anthems/:code/clear', (req, res) => { const code = String(req.params.code || '').toUpperCase(); if (!/^[A-Z]{2}$/.test(code)) return res.status(400).json({ error: 'invalid_country' }); db.prepare('DELETE FROM anthem_slots WHERE country_code=?').run(code); db.prepare('INSERT INTO anthem_history (country_code,sponsor,event) VALUES (?,?,?)').run(code, 'admin', 'cleared'); res.json({ ok: true }); });
router.get('/payments', (req, res) => res.json(db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 100').all()));
router.post('/payments/:id/verify', rateLimit({ windowMs: 60_000, max: 30, name: 'payment-verify' }), (req, res) => {
  const id = Number.parseInt(req.params.id, 10); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_payment_id' });
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(id); if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  if (payment.provider !== 'cold_wallet') return res.status(400).json({ error: 'only_cold_wallet_can_be_verified' });
  if (payment.status === 'succeeded' && payment.fulfilled_at) return res.json({ ok: true, idempotent: true, payment });
  if (payment.status !== 'pending_verification') return res.status(409).json({ error: 'payment_not_pending', status: payment.status });
  const amount = Number((req.body || {}).amount);
  const result = fulfillPayment(id, 'admin', amount);
  if (result.error) return res.status(result.error === 'amount_mismatch' ? 422 : 409).json(result);
  sse.broadcast('payment_verified', { paymentId: id, kind: result.kind });
  res.json(result);
});
router.post('/payments/:id/reject', rateLimit({ windowMs: 60_000, max: 30, name: 'payment-reject' }), (req, res) => {
  const id = Number.parseInt(req.params.id, 10); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_payment_id' });
  const result = rejectPayment(id, 'admin', (req.body || {}).reason); if (result.error) return res.status(409).json(result); res.json(result);
});

// ---- share analytics ----
router.get('/share-analytics', (req, res) => res.json({ byPlatform: db.prepare('SELECT platform, COUNT(*) c, SUM(clicks) clicks FROM shares GROUP BY platform ORDER BY c DESC').all(), recent: db.prepare(`SELECT s.id, l.name leader, s.platform, s.clicks, s.created_at FROM shares s JOIN leaders l ON l.id=s.leader_id ORDER BY s.created_at DESC LIMIT 50`).all() }));

// ---- settings ----
const ALLOWED_SETTINGS = new Set(['demo_mode','free_votes_per_day','max_bonus_per_day','site_name','maintenance_mode']);
router.get('/settings', (req, res) => res.json(Object.fromEntries(db.prepare('SELECT key,value FROM site_settings').all().filter(r => ALLOWED_SETTINGS.has(r.key)).map(r => [r.key, r.value]))));
router.post('/settings', (req, res) => {
  const body = req.body || {}; const unknown = Object.keys(body).filter(k => !ALLOWED_SETTINGS.has(k)); if (unknown.length) return res.status(400).json({ error: 'setting_not_allowed', keys: unknown });
  for (const [k, v] of Object.entries(body)) {
    if (k === 'free_votes_per_day' || k === 'max_bonus_per_day') { const n = Number.parseInt(v, 10); if (!Number.isInteger(n) || n < 0 || n > 100) return res.status(400).json({ error: 'invalid_setting', key: k }); core.setSetting(k, n); }
    else if (k === 'demo_mode' || k === 'maintenance_mode') core.setSetting(k, v === true || v === 1 || v === '1' ? '1' : '0');
    else core.setSetting(k, cleanText(v, 100));
  }
  res.json({ ok: true });
});

module.exports = router;
