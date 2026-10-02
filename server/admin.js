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
const paymentVerification = require('./services/payment-verification');
const analytics = require('./services/analytics');
const subscriptions = require('./services/subscriptions');

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
    topViral: db.prepare(`SELECT l.name, l.slug, COUNT(s.id) shares, COALESCE(SUM(s.clicks),0) clicks FROM shares s JOIN leaders l ON l.id=s.leader_id GROUP BY l.id ORDER BY shares DESC LIMIT 8`).all(),
    subscriptions: subscriptions.stats()
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
  db.prepare(`INSERT INTO leaders (slug,name,country_code,status,categories,era,years,title,bio,visible,featured,verified,name_search) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(slug, name, cc, status, JSON.stringify(categories), cleanText(b.era, 60), cleanText(b.years, 40), cleanText(b.title, 100), cleanText(b.bio, 1200), b.visible ? 1 : 0, b.featured ? 1 : 0, b.verified ? 1 : 0, require('./services/text-fold').fold(name));
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
// ---- ÜYELER (kayıtlar) ve GİRİŞ KAYITLARI ----
// Panelde "kim üye oldu, ne zaman, kaç oy kullandı" ve "kim giriş yaptı"
// listeleri bu uçlardan beslenir.
function memberRows({ q = '', limit = 500 } = {}) {
  const like = `%${String(q).slice(0, 100)}%`;
  return db.prepare(`
    SELECT u.id, u.email, u.username, u.display_name, u.provider, u.email_verified_at,
           u.created_at, u.failed_login_count, u.locked_until,
           (SELECT COUNT(*) FROM votes v WHERE v.user_id = u.id) votes,
           (SELECT MAX(v.created_at) FROM votes v WHERE v.user_id = u.id) last_vote,
           (SELECT COALESCE(SUM(MAX(vs.purchased - vs.purchased_used, 0)), 0) FROM vote_sessions vs
             WHERE vs.session_id = 'user-' || u.id) votes_left,
           (SELECT MAX(e.created_at) FROM login_events e WHERE e.user_id = u.id AND e.kind = 'login') last_login
    FROM users u
    WHERE u.email LIKE ? OR u.username LIKE ? OR u.display_name LIKE ?
    ORDER BY u.id DESC LIMIT ?`).all(like, like, like, limit);
}
// ---- TRAFİK ÖLÇÜMÜ (kendi sunucumuzda, gizliliğe saygılı) ----
// Sayfa görüntülemeleri; ham IP/tarayıcı saklanmaz, yalnızca tuzlu cihaz imzası.
router.get('/analytics', (req, res) => {
  const days = Math.max(1, Math.min(180, Number(req.query.days) || 30));
  res.json(analytics.kpis({ days }));
});

// ---- SUPPORTER ABONELİĞİ (panel) ----
router.get('/subscriptions', (req, res) => res.json({ stats: subscriptions.stats(), subscriptions: subscriptions.list({ limit: req.query.limit }) }));

// Elle aktifleştirme: havale/nakit ile ödeyen destekçiler ya da test için.
// Kart ödemesi Stripe webhook'u üzerinden zaten otomatik aktifleşir.
router.post('/subscriptions/grant', (req, res) => {
  const b = req.body || {};
  const months = Math.max(1, Math.min(36, Number(b.months) || 1));
  let user = null;
  if (b.userId) user = db.prepare('SELECT * FROM users WHERE id=?').get(b.userId);
  else if (b.identifier) { const key = String(b.identifier).trim().toLowerCase(); user = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(key, key); }
  const identityKey = b.identityKey ? String(b.identityKey).slice(0, 120) : (user ? `user-${user.id}` : null);
  if (!user && !identityKey) return res.status(400).json({ error: 'member_or_identity_required' });
  const sub = subscriptions.activate({ userId: user ? user.id : null, identityKey, provider: 'admin', days: months * 31, priceUsd: subscriptions.PRICE_USD() });
  res.json({ ok: true, subscription: sub, member: user ? (user.username || user.email) : identityKey });
});
router.post('/subscriptions/:id/revoke', (req, res) => {
  const sub = subscriptions.revoke({ id: Number(req.params.id) });
  if (!sub) return res.status(404).json({ error: 'subscription_not_found' });
  res.json({ ok: true, subscription: sub });
});

router.get('/members', (req, res) => {
  const q = String(req.query.q || '');
  const rows = memberRows({ q });
  const stats = {
    total: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    today: db.prepare(`SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now','-1 day')`).get().c,
    verified: db.prepare('SELECT COUNT(*) c FROM users WHERE email_verified_at IS NOT NULL').get().c,
    withVotes: db.prepare('SELECT COUNT(DISTINCT user_id) c FROM votes WHERE user_id IS NOT NULL').get().c,
    buyers: db.prepare(`SELECT COUNT(DISTINCT identity_key) c FROM payments WHERE kind='votes' AND status='paid' AND identity_key LIKE 'user-%'`).get().c
  };
  res.json({ stats, members: rows });
});
// CSV indirme: Excel'de açılabilsin diye BOM + noktalı virgül yerine virgül,
// virgül içeren alanlar tırnaklanır.
router.get('/members.csv', (req, res) => {
  const rows = memberRows({ q: String(req.query.q || ''), limit: 5000 });
  const head = ['id', 'email', 'username', 'display_name', 'provider', 'email_verified', 'created_at', 'votes', 'votes_left', 'last_vote', 'last_login', 'failed_logins'];
  const cell = v => { const t = v == null ? '' : String(v); return /[",\n;]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const lines = [head.join(',')].concat(rows.map(r => [r.id, r.email, r.username, r.display_name, r.provider, r.email_verified_at ? 'yes' : 'no', r.created_at, r.votes, r.votes_left, r.last_vote, r.last_login, r.failed_login_count].map(cell).join(',')));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="globalleaders-uyeler-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('\uFEFF' + lines.join('\n') + '\n');
});
router.get('/logins', (req, res) => {
  const rows = db.prepare(`SELECT e.id, e.kind, e.identifier, e.ip_hash, e.ua_hash, e.created_at,
                                  COALESCE(u.username, u.email) AS user
                           FROM login_events e LEFT JOIN users u ON u.id = e.user_id
                           ORDER BY e.id DESC LIMIT 300`).all();
  const counts = Object.fromEntries(db.prepare(`SELECT kind, COUNT(*) c FROM login_events GROUP BY kind`).all().map(r => [r.kind, r.c]));
  res.json({ events: rows, counts });
});

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
router.get('/payments', (req, res) => {
  const rows = db.prepare('SELECT * FROM payments ORDER BY id DESC LIMIT 100').all();
  const cfg = paymentVerification.walletConfig();
  const out = rows.map(r => {
    const meta = paymentVerification.readMeta(r);
    const last = meta.lastCheck || null;
    return {
      id: r.id, intentId: r.intent_id, provider: r.provider, method: r.provider === 'stripe' ? 'card' : (r.provider === 'cold_wallet' ? 'crypto' : r.provider),
      kind: r.kind, reference: r.reference, amount_usd: r.amount_usd, currency: r.currency, status: r.status, demo: r.demo,
      tx_hash: r.tx_hash, explorerUrl: r.tx_hash && /^[0-9a-fA-F]{64}$/.test(r.tx_hash) ? require('./services/onchain').explorerUrl(cfg.network, r.tx_hash) : null,
      chainStatus: r.status === 'succeeded' ? 'verified'
        : (r.provider === 'stripe' || r.provider === 'mock')
          ? (r.status === 'paid' ? 'paid_webhook' : r.status === 'pending' ? 'webhook_wait' : r.status)
          : (last ? (last.ok ? 'confirmed' : last.reason) : 'not_checked'),
      chainCheckedAt: last ? last.at : null, chainMessage: last ? last.message : null, chainAmountUsd: meta.onchain ? meta.onchain.amountUsd : null,
      verified_by: r.verified_by, verified_at: r.verified_at, fulfilled_at: r.fulfilled_at, created_at: r.created_at, session_id: r.session_id
    };
  });
  res.json({
    payments: out,
    wallet: { address: cfg.address || null, asset: cfg.asset, network: cfg.network, addressValid: require('./services/onchain').isValidTronAddress(cfg.address), autoVerify: process.env.AUTO_ONCHAIN_VERIFY === '1' },
    cardConfigured: !!process.env.STRIPE_SECRET_KEY
  });
});
router.post('/payments/:id/check-chain', rateLimit({ windowMs: 60_000, max: 30, name: 'payment-check-chain' }), async (req, res) => {
  const id = Number.parseInt(req.params.id, 10); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_payment_id' });
  const result = await paymentVerification.checkPaymentOnchain(id, { actor: 'admin_onchain' });
  if (result.reason === 'payment_not_found') return res.status(404).json(result);
  if (result.ok && result.activated) sse.broadcast('payment_verified', { paymentId: id, kind: result.detail && result.detail.kind, via: 'onchain' });
  res.json({ ok: !!result.ok, reason: result.reason || null, message: result.message, activated: !!result.activated, onchain: result.onchain || null, wallet: paymentVerification.walletConfig(), payment: result.payment });
});
router.post('/payments/:id/verify', rateLimit({ windowMs: 60_000, max: 30, name: 'payment-verify' }), (req, res) => {
  const id = Number.parseInt(req.params.id, 10); if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'invalid_payment_id' });
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(id); if (!payment) return res.status(404).json({ error: 'payment_not_found' });
  if (payment.status === 'succeeded' && payment.fulfilled_at) return res.json({ ok: true, idempotent: true, payment });
  const body = req.body || {};
  const note = String(body.note || '').trim().slice(0, 300);

  // --- Kart ödemesi: para sağlayıcı tarafından tahsil edilmiştir. ---
  if (payment.provider === 'stripe' || payment.provider === 'mock') {
    // 'paid' = Stripe imzalı webhook'u ödemeyi doğruladı; aktivasyon güvenli.
    // 'pending' = webhook gelmedi; admin Stripe panelinde gördüyse gerekçesiyle açabilir.
    if (payment.status !== 'paid' && payment.status !== 'pending') return res.status(409).json({ error: 'payment_not_pending', status: payment.status });
    if (payment.status === 'pending' && note.length < 3) return res.status(422).json({ error: 'reason_required', message: 'Card payment has no confirmed webhook yet. Verify it in the Stripe dashboard and write a short reason.' });
    const actor = payment.status === 'paid' ? 'stripe_webhook_confirmed' : 'admin_card_manual:' + note;
    const card = fulfillPayment(id, actor);
    if (card.error) return res.status(409).json(card);
    sse.broadcast('payment_verified', { paymentId: id, kind: card.kind, via: payment.status === 'paid' ? 'stripe' : 'manual' });
    return res.json({ ...card, verifiedOnChain: false, via: payment.status === 'paid' ? 'stripe' : 'manual', note: note || null });
  }

  // --- Kripto: zincir kanıtı ya da gerekçeli elle onay. ---
  if (payment.provider !== 'cold_wallet') return res.status(400).json({ error: 'unsupported_provider' });
  if (payment.status !== 'pending_verification') return res.status(409).json({ error: 'payment_not_pending', status: payment.status });
  const meta = paymentVerification.readMeta(payment);
  const chained = !!(meta.lastCheck && meta.lastCheck.ok);
  // Zincirde doğrulanmamış ödemeyi elle onaylamak mümkün, ancak gerekçe zorunlu:
  // denetim kaydı olmadan kimse "para geldi" diyemez.
  if (!chained && note.length < 3) return res.status(422).json({ error: 'reason_required', message: 'This payment has not been confirmed on-chain. Write a short reason (e.g. "checked in wallet, tx …") to approve manually.' });
  const amount = chained ? meta.onchain.amountUsd : Number(body.amount);
  const result = fulfillPayment(id, chained ? 'admin_onchain' : 'admin_manual:' + note, amount);
  if (result.error) return res.status(result.error === 'amount_mismatch' ? 422 : 409).json(result);
  sse.broadcast('payment_verified', { paymentId: id, kind: result.kind, via: chained ? 'onchain' : 'manual' });
  res.json({ ...result, verifiedOnChain: chained, note: note || null });
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
