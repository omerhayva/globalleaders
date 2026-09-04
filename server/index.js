const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const db = require('./db');
const seed = require('./seed');
const core = require('./core');
const render = require('./render');
const sse = require('./services/sse');
const api = require('./api');
const admin = require('./admin');
const { rateLimit } = require('./services/ratelimit');

// first-run seeding
if (db.prepare('SELECT COUNT(*) c FROM leaders').get().c === 0) {
  console.log('Seeding database (leaders, countries, demo votes)…');
  seed.seedAll();
  console.log('Seeded', db.prepare('SELECT COUNT(*) c FROM leaders').get().c, 'leaders.');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind https preview proxy
app.use(express.json({ limit: '16mb' }));
app.use(cookieParser());

// ---------- güvenlik başlıkları ----------
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data:; media-src 'self'; font-src 'self'; connect-src 'self'; " +
    "object-src 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

// ---------- CSRF / Origin koruması ----------
// Cookie SameSite=None olduğu için tarayıcılar çapraz site isteklerinde cookie
// gönderir. Mutating isteklerde Origin/Referer varsa host ile eşleşmelidir;
// yoksa (curl, native istemci) geçiş serbesttir. Tarayıcılar çapraz origin
// POST'larda her zaman Origin gönderir → CSRF kapanır.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  let origin = null;
  if (typeof req.headers.origin === 'string' && req.headers.origin) origin = req.headers.origin;
  else if (typeof req.headers.referer === 'string' && req.headers.referer) {
    try { origin = new URL(req.headers.referer).origin; } catch { origin = null; }
  }
  if (!origin) return next();
  try {
    if (new URL(origin).host !== req.headers.host) {
      return res.status(403).json({ error: 'forbidden_origin' });
    }
  } catch { return res.status(403).json({ error: 'forbidden_origin' }); }
  next();
});

// ---------- genel API hız limiti (flood koruması) ----------
app.use('/api', rateLimit({ windowMs: 60_000, max: 240, name: 'api-all' }));

// anonymous voting session — triple persistence:
// 1) SameSite=None Secure cookie (survives iframe/proxy contexts),
// 2) X-GL-Session header echo (client mirrors it into localStorage),
// 3) header fallback when the browser drops cookies entirely.
app.use((req, res, next) => {
  const hdr = String(req.headers['x-gl-session'] || '');
  let sid = /^[a-f0-9]{32}$/.test(hdr) ? hdr : req.cookies.gl_session;
  if (!sid || !/^[a-f0-9]{32}$/.test(sid)) {
    sid = crypto.randomBytes(16).toString('hex');
  }
  if (req.cookies.gl_session !== sid) {
    res.cookie('gl_session', sid, { httpOnly: true, sameSite: 'none', secure: true, maxAge: 365 * 86400000 });
  }
  res.setHeader('X-GL-Session', sid);
  req.sessionId = sid;
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: false }));

// ---------- APIs ----------
app.use('/api', api);
app.use('/api/admin', admin);

// ---------- dynamic assets ----------
app.get('/og/leader/:slug.svg', (req, res) => {
  const svg = render.ogCard(req.params.slug);
  if (!svg) return res.status(404).end();
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=120').send(svg);
});
app.get('/portrait/:slug.svg', (req, res) => {
  const svg = render.portraitSvg(req.params.slug);
  if (!svg) return res.status(404).end();
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg);
});

// ---------- HTML fragment for lazy pagination ----------
app.get('/fragment/leaders', (req, res) => {
  const { category = 'all', offset = 0, country } = req.query;
  const lb = core.leaderboard({ limit: 24, offset: +offset || 0, category, country: country || null });
  const names = Object.fromEntries(db.prepare('SELECT code,name FROM countries').all().map(c => [c.code, c.name]));
  lb.rows.forEach(r => r.countryName = names[r.country_code]);
  res.json({ html: lb.rows.map(render.leaderCard).join(''), hasMore: (+offset + 24) < lb.total });
});

// ---------- pages (SSR) ----------
const send = (res, html) => html ? res.type('html').send(html) : res.status(404).type('html').send(notFound());
app.get('/', (req, res) => send(res, render.homePage()));
app.get('/leaders', (req, res) => {
  const category = String(req.query.category || 'all');
  const cat = db.prepare('SELECT name FROM categories WHERE id=?').get(category);
  send(res, render.leadersPage({ category, title: cat ? cat.name : 'All Leaders' }));
});
app.get('/history', (req, res) => send(res, render.leadersPage({ category: 'historical', title: 'Historical Leaders', nav: 'HISTORY', pathUrl: '/history' })));
app.get('/leader/:slug', (req, res) => send(res, render.leaderPage(req.params.slug)));
app.get('/countries', (req, res) => send(res, render.countriesPage()));
app.get('/country/:code', (req, res) => send(res, render.countryPage(req.params.code)));
app.get('/country/:code/anthem', (req, res) => send(res, render.anthemPage(req.params.code)));
app.get('/trending', (req, res) => send(res, render.trendingPage()));
app.get('/about', (req, res) => send(res, render.aboutPage()));
app.get('/legal', (req, res) => send(res, render.legalPage()));

// share/referral landing: /vote/{slug}?ref={shareId}
app.get('/vote/:slug', (req, res) => {
  const ref = String(req.query.ref || '').slice(0, 24);
  res.redirect(302, `/leader/${encodeURIComponent(req.params.slug)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`);
});

app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

app.get('/sitemap.xml', (req, res) => {
  const base = 'https://globalleaders.live';
  const urls = ['/', '/leaders', '/countries', '/trending', '/history', '/about', '/legal',
    ...db.prepare('SELECT slug FROM leaders WHERE visible=1').all().map(l => `/leader/${l.slug}`),
    ...db.prepare('SELECT code FROM countries').all().flatMap(c => [`/country/${c.code.toLowerCase()}`, `/country/${c.code.toLowerCase()}/anthem`])];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>`);
});

function notFound() {
  return render.layout({
    title: 'Not found — Global Leaders Live', description: 'Page not found', path: '/404',
    body: `<section class="page-head center" style="padding:6rem 1rem"><h1>404</h1>
      <p class="muted">This leader hasn't made it onto the ranking… yet.</p>
      <p><a class="btn btn-vote" href="/">BACK TO THE LIVE RANKING</a></p></section>`
  });
}
app.use((req, res) => res.status(404).type('html').send(notFound()));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
});

// ---------- demo live simulator (marked demo, admin-toggleable) ----------
function simulatorTick() {
  try {
    if (core.getSetting('simulator_enabled') !== '1') return;
    const leaders = db.prepare('SELECT id, slug, name, country_code, total_votes, rank FROM leaders WHERE visible=1 ORDER BY total_votes DESC LIMIT 60').all();
    if (!leaders.length) return;
    // bias toward the top but let anyone move
    const idx = Math.min(leaders.length - 1, Math.floor(Math.pow(Math.random(), 1.7) * leaders.length));
    const l = leaders[idx];
    const n = 1 + Math.floor(Math.random() * 3); // gentle pace: matches realistic pre-launch numbers
    db.prepare(`INSERT INTO votes (leader_id,session_id,type,source,country) VALUES (?,?, 'demo','simulator',?)`).run(l.id, 'sim', l.country_code);
    db.prepare('UPDATE leaders SET total_votes=total_votes+? WHERE id=?').run(n, l.id);
    db.prepare('UPDATE countries SET total_votes=total_votes+? WHERE code=?').run(n, l.country_code);
    db.prepare(`INSERT INTO leader_daily_stats (leader_id,day,votes,shares) VALUES (?,?,?,0)
      ON CONFLICT(leader_id,day) DO UPDATE SET votes=votes+excluded.votes`).run(l.id, seed.dayStr(), n);
    const changes = seed.recomputeRanks();
    const upd = db.prepare('SELECT rank,total_votes FROM leaders WHERE id=?').get(l.id);
    core.logRankHistoryToday(l.id, upd.rank, upd.total_votes);
    sse.broadcast('vote_created', { leaderId: l.id, slug: l.slug, count: n });
    sse.broadcast('leader_vote_count_updated', { slug: l.slug, totalVotes: upd.total_votes, rank: upd.rank });
    if (changes.length) sse.broadcast('leader_rank_changed', { changes });
    const msgs = [
      `${core.FLAG(l.country_code)} Someone voted for ${l.name}`,
      `${core.FLAG(l.country_code)} ${l.name} gained ${n} votes`,
      `${core.FLAG(l.country_code)} ${l.name} is trending`
    ];
    core.pushActivity('vote', msgs[Math.floor(Math.random() * msgs.length)], l.country_code, l.id);
  } catch (e) { console.error('simulator', e.message); }
}
setInterval(simulatorTick, 9000 + Math.random() * 5000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`GLOBAL LEADERS LIVE running on 0.0.0.0:${PORT}`));
