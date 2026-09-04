// Public JSON API
const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const core = require('./core');
const sse = require('./services/sse');
const fraud = require('./services/fraud');
const payments = require('./services/payments');
const currency = require('./services/currency');

const router = express.Router();
const { rateLimit } = require('./services/ratelimit');
const { cleanText, cleanLong, sanitizeUrl, cleanX, safeInitials } = require('./services/sanitize');
const uploads = require('./services/uploads');

const ip = req => req.ip || req.socket.remoteAddress || '';
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{16,128}$/;

const getUser = (sessionId) => db.prepare(`SELECT u.* FROM users u JOIN vote_sessions vs ON vs.user_id=u.id WHERE vs.session_id=? ORDER BY vs.created_at DESC LIMIT 1`).get(sessionId);
const pubUser = (u) => ({ id: u.id, name: u.display_name, provider: u.provider, x_handle: u.x_handle || null, color: u.avatar_color || '#f5b524', initials: safeInitials(u.display_name) });

router.get('/session', (req, res) => { const vs = core.getOrCreateVoteSession(req.sessionId, ip(req), req.headers['user-agent']); res.json({ remaining: core.remainingVotes(vs), free_used: vs.free_used, bonus_earned: vs.bonus_earned, bonus_used: vs.bonus_used, purchased: vs.purchased || 0, purchased_used: vs.purchased_used || 0, freePerDay: parseInt(core.getSetting('free_votes_per_day') || '1', 10), demoMode: core.getSetting('demo_mode') === '1' }); });
router.get('/my-votes', (req, res) => { const user = getUser(req.sessionId); if (!user) return res.json(core.myVotes(req.sessionId)); const sids = db.prepare('SELECT DISTINCT session_id FROM vote_sessions WHERE user_id=?').all(user.id).map(r => r.session_id); if (!sids.includes(req.sessionId)) sids.push(req.sessionId); const merged = new Map(); for (const sid of sids) for (const v of core.myVotes(sid)) { const m = merged.get(v.slug); if (m) { m.n += v.n; if (v.last > m.last) m.last = v.last; } else merged.set(v.slug, { ...v }); } res.json([...merged.values()].sort((a, b) => String(b.last).localeCompare(String(a.last))).slice(0, 50)); });

router.post('/auth/login', rateLimit({ windowMs: 10 * 60_000, max: 10, name: 'auth-login' }), (req, res) => {
  const b = req.body || {}; const demoMode = core.getSetting('demo_mode') === '1'; const name = cleanText(b.name, 60); const email = String(b.email || '').trim().toLowerCase().slice(0, 120) || null; const provider = ['local', 'x', 'google', 'facebook'].includes(b.provider) ? b.provider : 'local'; const xh = cleanX(b.x_handle);
  if (name.length < 2) return res.status(400).json({ error: 'name_required' }); if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'invalid_email' }); if (!demoMode && provider !== 'local') return res.status(503).json({ error: 'oauth_not_configured', message: 'Social sign-in needs a real OAuth provider before launch.' });
  let user = email ? db.prepare('SELECT * FROM users WHERE email=?').get(email) : null; if (!user && provider === 'x' && xh) user = db.prepare('SELECT * FROM users WHERE provider=? AND x_handle=?').get('x', xh);
  if (user) { if (!demoMode) return res.status(409).json({ error: 'email_taken', message: 'This email is already registered. Sign-in verification is not available yet.' }); db.prepare('UPDATE users SET x_handle=COALESCE(?,x_handle) WHERE id=?').run(xh, user.id); user = db.prepare('SELECT * FROM users WHERE id=?').get(user.id); }
  else { const colors = ['#f5b524', '#38bdf8', '#a78bfa', '#fb7185', '#34d399', '#f97316']; const color = colors[Math.floor(Math.random() * colors.length)]; const info = db.prepare('INSERT INTO users (email,display_name,provider,x_handle,avatar_color) VALUES (?,?,?,?,?)').run(email, name, provider, xh, color); user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid); }
  db.prepare('UPDATE vote_sessions SET user_id=? WHERE session_id=?').run(user.id, req.sessionId); db.prepare(`INSERT INTO vote_sessions (id,session_id,day,user_id) VALUES (?,?,date('now'),?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id`).run(req.sessionId + ':' + new Date().toISOString().slice(0, 10), req.sessionId, user.id); res.json({ ok: true, user: pubUser(user), demoSocial: provider !== 'local', demoAuth: demoMode });
});
router.get('/auth/me', (req, res) => { const u = getUser(req.sessionId); res.json(u ? { user: pubUser(u) } : {}); });
router.post('/auth/logout', (req, res) => { db.prepare('UPDATE vote_sessions SET user_id=NULL WHERE session_id=?').run(req.sessionId); res.json({ ok: true }); });
router.get('/featured-anthem', (req, res) => res.json(core.featuredAnthem() || {}));

router.post('/suggest-leader', rateLimit({ windowMs: 60 * 60_000, max: 3, name: 'suggest' }), async (req, res) => {
  const b = req.body || {}; const name = cleanText(b.name, 60); const cc = String(b.country_code || '').trim().toUpperCase(); if (name.length < 2) return res.status(400).json({ error: 'name_required' }); if (!/^[A-Z]{2}$/.test(cc)) return res.status(400).json({ error: 'country_required' });
  let countryName; try { countryName = new Intl.DisplayNames(['en'], { type: 'region' }).of(cc); } catch { } if (!countryName || countryName === cc) return res.status(400).json({ error: 'invalid_country' }); const today = new Date().toISOString().slice(0, 10); if (db.prepare(`SELECT 1 FROM leaders WHERE suggested_by=? AND date(created_at)=?`).get(req.sessionId, today)) return res.status(429).json({ error: 'daily_limit', message: 'You can add 1 leader per day.' });
  const { slugify, recomputeRanks } = require('./seed'); const slug = slugify(name); if (db.prepare('SELECT 1 FROM leaders WHERE slug=?').get(slug)) return res.status(409).json({ error: 'already_exists' }); db.prepare(`INSERT OR IGNORE INTO countries (code,name,anthem_title) VALUES (?,?, 'National Anthem')`).run(cc, countryName); db.prepare(`INSERT INTO leaders (slug,name,country_code,status,categories,era,years,title,bio,visible,verified,community,suggested_by) VALUES (?,?,?,?,?,?,?,?,?,0,0,1,?)`).run(slug, name, cc, b.status === 'current' ? 'current' : 'historical', JSON.stringify(['political']), '', cleanText(b.years, 30), cleanText(b.title, 80), cleanLong(b.bio, 300), req.sessionId); recomputeRanks(); core.pushActivity('leader', `🆕 ${core.FLAG(cc)} ${name} was submitted by the community for review`, cc, null); res.status(202).json({ ok: true, slug, status: 'pending_review' });
});

router.get('/stream', sse.handler);
router.get('/leaderboard', (req, res) => { const limitRaw = Number.parseInt(req.query.limit, 10); const offsetRaw = Number.parseInt(req.query.offset, 10); const limit = Math.max(1, Math.min(50, Number.isFinite(limitRaw) ? limitRaw : 10)); const offset = Math.max(0, Math.min(100000, Number.isFinite(offsetRaw) ? offsetRaw : 0)); const category = req.query.category ? String(req.query.category).slice(0, 40) : null; const country = req.query.country ? String(req.query.country).toUpperCase() : null; if (country && !/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: 'invalid_country' }); res.json(core.leaderboard({ limit, offset, category, country })); });
router.get('/leader/:slug', (req, res) => { const l = core.leaderProfile(req.params.slug); l ? res.json(l) : res.status(404).json({ error: 'not_found' }); });
router.get('/countries', (req, res) => res.json(core.countriesMapData())); router.get('/country/:code', (req, res) => { const c = core.countryInfo(req.params.code); c ? res.json(c) : res.status(404).json({ error: 'not_found' }); }); router.get('/stats', (req, res) => res.json(core.globalStats())); router.get('/trending', (req, res) => res.json(core.trending())); router.get('/activity', (req, res) => res.json(core.recentActivity(25))); router.get('/currency', (req, res) => { const ccy = req.query.ccy || currency.guessCurrency(req.headers['accept-language']); res.json({ base: 'USD', display: currency.display(5, ccy), currency: ccy, rates: currency.rates }); });

router.post('/vote', rateLimit({ windowMs: 60_000, max: 30, name: 'vote-endpoint' }), (req, res) => {
  const key = String(req.get('Idempotency-Key') || ''); if (!IDEMPOTENCY_RE.test(key)) return res.status(400).json({ error: 'idempotency_key_required' }); const body = req.body || {}; const slug = String(body.slug || ''); const count = Math.max(1, Math.min(10, Number.parseInt(body.count, 10) || 1)); const requestHash = crypto.createHash('sha256').update(JSON.stringify({ slug, count })).digest('hex'); const existing = db.prepare('SELECT request_hash,response_json FROM vote_idempotency WHERE session_id=? AND idempotency_key=?').get(req.sessionId, key);
  if (existing) { if (existing.request_hash !== requestHash) return res.status(409).json({ error: 'idempotency_key_reused' }); try { return res.json(JSON.parse(existing.response_json)); } catch { return res.status(500).json({ error: 'idempotency_corrupt' }); } }
  const result = core.castVotes({ sessionId: req.sessionId, ip: ip(req), ua: req.headers['user-agent'], leaderSlug: slug, count }); if (result.error) { const codes = { no_votes_left: 429, too_fast: 429, daily_cap: 429, device_limit: 429, suspended: 403, captcha_required: 403, leader_not_found: 404 }; return res.status(codes[result.error] || 400).json(result); } db.prepare('INSERT INTO vote_idempotency (session_id,idempotency_key,request_hash,response_json) VALUES (?,?,?,?)').run(req.sessionId, key, requestHash, JSON.stringify(result)); db.prepare("DELETE FROM vote_idempotency WHERE created_at < datetime('now','-2 days')").run(); res.json(result);
});

router.post('/share', rateLimit({ windowMs: 60_000, max: 10, name: 'share-endpoint' }), (req, res) => { const { slug, platform } = req.body || {}; const result = core.registerShare({ sessionId: req.sessionId, ip: ip(req), leaderSlug: String(slug || ''), platform }); if (result.error) return res.status(400).json(result); res.json(result); });
router.post('/referral', rateLimit({ windowMs: 60 * 60_000, max: 20, name: 'referral-endpoint' }), (req, res) => { const { shareId, slug } = req.body || {}; if (!shareId) return res.json({ ok: false }); const chk = fraud.checkReferral({ shareId: String(shareId).slice(0, 24), visitorIp: ip(req), ownerSession: req.sessionId }); if (!chk.ok) return res.json({ ok: false, reason: chk.reason }); const leader = db.prepare('SELECT id FROM leaders WHERE slug=?').get(String(slug || '')); db.prepare('INSERT INTO referrals (share_id,visitor_session,visitor_ip_hash,leader_id) VALUES (?,?,?,?)').run(String(shareId).slice(0, 24), req.sessionId, chk.ipHash, leader ? leader.id : null); db.prepare('UPDATE shares SET clicks=clicks+1 WHERE id=?').run(String(shareId).slice(0, 24)); res.json({ ok: true }); });

const VOTE_PACKS = { 'votes-10': { votes: 10, usd: 1.0 }, 'votes-60': { votes: 60, usd: 5.0 } };
const mockPaymentsLive = () => core.getSetting('demo_mode') !== '1' && payments.active === 'mock';
router.post('/purchase/intent', rateLimit({ windowMs: 10 * 60_000, max: 10, name: 'purchase-intent' }), (req, res) => {
  if (mockPaymentsLive()) return res.status(503).json({ error: 'payment_provider_not_configured', message: 'Real payments are not configured yet.' });
  const { kind, reference, advertiser } = req.body || {}; if (!['ad', 'anthem', 'votes'].includes(kind)) return res.status(400).json({ error: 'bad_kind' });
  if (kind === 'ad' && !db.prepare('SELECT 1 FROM advertising_slots WHERE id=? AND active=1').get(reference)) return res.status(404).json({ error: 'slot_not_found' }); if (kind === 'anthem' && !db.prepare('SELECT 1 FROM countries WHERE code=?').get(String(reference || '').toUpperCase())) return res.status(404).json({ error: 'country_not_found' }); if (kind === 'votes' && !VOTE_PACKS[reference]) return res.status(400).json({ error: 'pack_not_found' });
  const amountUsd = kind === 'votes' ? VOTE_PACKS[reference].usd : 5; const ccy = currency.guessCurrency(req.headers['accept-language']); let intent;
  try { intent = payments.createIntent({ sessionId: req.sessionId, kind, reference, advertiser: cleanText(advertiser, 60), amountUsd }); } catch (e) { if (e && e.message === 'crypto_wallet_not_configured') return res.status(503).json({ error: 'crypto_wallet_not_configured', message: 'Crypto checkout is not configured yet.' }); throw e; }
  const termsMap = { ad: { item: `Advertising slot: ${reference}`, duration: 'Slot ownership follows the published slot terms.', receives: 'Sponsored placement on Global Leaders Live.' }, anthem: { item: `National anthem sponsorship: ${reference}`, duration: 'Ownership lasts until another buyer takes over the same slot.', receives: 'Sponsored-by credit on the country and anthem pages.' }, votes: { item: `Vote pack: ${VOTE_PACKS[reference] ? VOTE_PACKS[reference].votes : ''} votes`, duration: 'Votes are credited to your session instantly and never expire.', receives: `${VOTE_PACKS[reference] ? VOTE_PACKS[reference].votes : ''} extra votes.` } };
  res.json({ ...intent, amountUsd, priceDisplay: currency.display(amountUsd, ccy), terms: { ...termsMap[kind], price: `$${amountUsd.toFixed(2)} USD`, refunds: 'Refunds follow the applicable Payment Terms.' }, demoMode: false });
});

router.post('/purchase/confirm', rateLimit({ windowMs: 10 * 60_000, max: 15, name: 'purchase-confirm' }), (req, res) => {
  if (mockPaymentsLive()) return res.status(503).json({ error: 'payment_provider_not_configured', message: 'Real payments are not configured yet.' });
  const { intentId, details } = req.body || {}; const pending = db.prepare('SELECT * FROM payments WHERE intent_id=?').get(String(intentId || '')); if (!pending) return res.status(404).json({ error: 'unknown_intent' });
  if (pending.session_id && pending.session_id !== req.sessionId) { fraud.logFraud('intent_takeover', req.sessionId, null, String(intentId || '')); return res.status(403).json({ error: 'wrong_session' }); }
  if (pending.provider !== payments.active) return res.status(400).json({ error: 'provider_mismatch' });
  const conf = payments.confirm(String(intentId || ''), (details && details.payment) || details || {});
  if (conf.status === 'pending_verification') return res.status(202).json({ ok: true, status: 'pending_verification', paymentId: conf.payment.id });
  if (conf.status !== 'succeeded') return res.status(402).json({ error: conf.error || 'payment_failed' });
  const p = conf.payment; if (conf.idempotent) return res.json({ ok: true, idempotent: true });
  if (p.kind === 'ad') {
    const slotId = p.reference; const d = details || {}; const advertiser = cleanText(d.advertiser || 'Anonymous sponsor', 60) || 'Anonymous sponsor'; const xh = cleanX(d.x_handle); let imagePath = null;
    if (d.image) { const saved = uploads.saveImage(d.image, 'ad-' + Date.now()); if (saved.error) return res.status(400).json({ error: 'bad_image', message: saved.error }); imagePath = saved.path; }
    db.prepare(`UPDATE advertisements SET status='replaced' WHERE slot_id=? AND status='active'`).run(slotId); const ad = db.prepare(`INSERT INTO advertisements (slot_id,advertiser,image,text,cta,url,x_handle,starts_at,status) VALUES (?,?,?,?,?,?,?,datetime('now'),'active')`).run(slotId, advertiser, imagePath, cleanText(d.text, 120) || '', cleanText(d.cta, 30) || 'Learn more', sanitizeUrl(d.url), xh); db.prepare('INSERT INTO ad_purchases (slot_id,ad_id,payment_id,advertiser,amount_usd) VALUES (?,?,?,?,5.0)').run(slotId, ad.lastInsertRowid, p.id, advertiser); core.pushActivity('ad', `📢 ${advertiser}${xh ? ' (@' + xh + ')' : ''} took over the ${slotId.replace('-',' ')} ad space`, null, null); sse.broadcast('ad_purchased', { slotId, advertiser }); return res.json({ ok: true, kind: 'ad', slotId, advertiser, shareText: `🚀 ${advertiser} now owns a live advertising position on Global Leaders Live.` });
  }
  if (p.kind === 'anthem') {
    const cc = String(p.reference).toUpperCase(); const sponsor = cleanText((details || {}).sponsor, 60) || 'Anonymous'; const xh = cleanX((details || {}).x_handle); const prev = db.prepare('SELECT sponsor FROM anthem_slots WHERE country_code=?').get(cc);
    db.prepare(`INSERT INTO anthem_slots (country_code,sponsor,sponsor_session,price_usd,purchased_at,sponsor_x) VALUES (?,?,?,5.0,datetime('now'),?) ON CONFLICT(country_code) DO UPDATE SET sponsor=excluded.sponsor,sponsor_session=excluded.sponsor_session,purchased_at=excluded.purchased_at,sponsor_x=excluded.sponsor_x`).run(cc, sponsor, req.sessionId, xh); db.prepare('INSERT INTO anthem_purchases (country_code,sponsor,payment_id,amount_usd,sponsor_x) VALUES (?,?,?,5.0,?)').run(cc, sponsor, p.id, xh); if (prev && prev.sponsor) db.prepare('INSERT INTO anthem_history (country_code,sponsor,event) VALUES (?,?,?)').run(cc, prev.sponsor, 'replaced'); db.prepare('INSERT INTO anthem_history (country_code,sponsor,event) VALUES (?,?,?)').run(cc, sponsor, 'purchased'); const cname = (db.prepare('SELECT name FROM countries WHERE code=?').get(cc) || {}).name || cc; core.pushActivity('anthem', `${core.FLAG(cc)} ${sponsor}${xh ? ' (@' + xh + ')' : ''} took over ${cname}'s national anthem`, cc, null); sse.broadcast('anthem_purchased', { country: cc, sponsor, sponsor_x: xh }); return res.json({ ok: true, kind: 'anthem', country: cc, sponsor, shareText: `${core.FLAG(cc)} I just took over ${cname}'s national anthem slot on Global Leaders Live!` });
  }
  if (p.kind === 'votes') {
    const pack = VOTE_PACKS[p.reference]; if (!pack) return res.status(400).json({ error: 'pack_not_found' }); const vs = core.getOrCreateVoteSession(req.sessionId, ip(req), req.headers['user-agent']); db.prepare('UPDATE vote_sessions SET purchased=purchased+? WHERE id=?').run(pack.votes, vs.id); db.prepare('INSERT INTO bonus_votes (session_id,reason) VALUES (?,?)').run(req.sessionId, 'purchase:' + p.reference); const vs2 = db.prepare('SELECT * FROM vote_sessions WHERE id=?').get(vs.id); return res.json({ ok: true, kind: 'votes', votesAdded: pack.votes, remaining: core.remainingVotes(vs2) });
  }
  res.json({ ok: true });
});

router.post('/webhooks/:provider', express.raw({ type: '*/*' }), (req, res) => { const evt = payments.webhook(req.params.provider, req.body, req.headers); res.json({ received: true, handled: !!evt }); });
router.get('/ads', (req, res) => { const slots = db.prepare('SELECT id,label,price_usd FROM advertising_slots WHERE active=1').all(); const ads = db.prepare(`SELECT slot_id,advertiser,image,text,cta,url,x_handle,created_at FROM advertisements WHERE status='active' AND (ends_at IS NULL OR ends_at > datetime('now')) AND (starts_at IS NULL OR starts_at <= datetime('now'))`).all(); res.json({ slots, ads: Object.fromEntries(ads.map(a => [a.slot_id, a])) }); });
module.exports = router;
