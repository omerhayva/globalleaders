const express = require('express');
const path = require('path');
const crypto = require('crypto');
const cookieParser = require('cookie-parser');

const db = require('./db');
const seed = require('./seed');
const core = require('./core');
const render = require('./render');
const api = require('./api');
const admin = require('./admin');
const { rateLimit } = require('./services/ratelimit');

if (db.prepare('SELECT COUNT(*) c FROM leaders').get().c === 0) {
  console.log('Seeding database (leaders, countries)…');
  seed.seedAll({ withDemoVotes: false });
  console.log('Seeded', db.prepare('SELECT COUNT(*) c FROM leaders').get().c, 'leaders.');
}

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  if (!process.env.GL_ADMIN_SECRET || process.env.GL_ADMIN_SECRET.length < 32) throw new Error('GL_ADMIN_SECRET must be set to a random value of at least 32 characters in production.');
  if (!process.env.GL_ADMIN_PASSWORD || process.env.GL_ADMIN_PASSWORD.length < 12) throw new Error('GL_ADMIN_PASSWORD must be set to a strong password of at least 12 characters in production.');
  if (!process.env.GL_FRAUD_SALT || process.env.GL_FRAUD_SALT.length < 32) throw new Error('GL_FRAUD_SALT must be set to a random value of at least 32 characters in production.');
  if (!process.env.PUBLIC_BASE_URL || !/^https:\/\//i.test(process.env.PUBLIC_BASE_URL)) throw new Error('PUBLIC_BASE_URL must be an HTTPS URL in production.');
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://flagcdn.com; media-src 'self'; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  let origin = null;
  if (typeof req.headers.origin === 'string' && req.headers.origin) origin = req.headers.origin;
  else if (typeof req.headers.referer === 'string' && req.headers.referer) { try { origin = new URL(req.headers.referer).origin; } catch { origin = null; } }
  if (!origin) return next();
  try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'forbidden_origin' }); }
  catch { return res.status(403).json({ error: 'forbidden_origin' }); }
  next();
});

app.use('/api', rateLimit({ windowMs: 60_000, max: 240, name: 'api-all' }));

app.use((req, res, next) => {
  const hdr = String(req.headers['x-gl-session'] || '');
  let sid = /^[a-f0-9]{32}$/.test(hdr) ? hdr : req.cookies.gl_session;
  if (!sid || !/^[a-f0-9]{32}$/.test(sid)) sid = crypto.randomBytes(16).toString('hex');
  if (req.cookies.gl_session !== sid) res.cookie('gl_session', sid, { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 365 * 86400000, path: '/' });
  res.setHeader('X-GL-Session', sid);
  req.sessionId = sid;
  next();
});

app.use(express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h', index: false }));
app.use('/api', api);
app.use('/api/admin', admin);

app.get('/og/leader/:slug.svg', (req, res) => { const svg = render.ogCard(req.params.slug); if (!svg) return res.status(404).end(); res.type('image/svg+xml').set('Cache-Control', 'public, max-age=120').send(svg); });
app.get('/portrait/:slug.svg', (req, res) => { const svg = render.portraitSvg(req.params.slug); if (!svg) return res.status(404).end(); res.type('image/svg+xml').set('Cache-Control', 'public, max-age=86400').send(svg); });

app.get('/fragment/leaders', (req, res) => {
  const category = String(req.query.category || 'all').slice(0, 40);
  const safeOffset = Math.max(0, Math.min(100000, Number.parseInt(req.query.offset, 10) || 0));
  const country = req.query.country ? String(req.query.country).toUpperCase() : null;
  if (country && !/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: 'invalid_country' });
  const lb = core.leaderboard({ limit: 24, offset: safeOffset, category, country });
  const names = Object.fromEntries(db.prepare('SELECT code,name FROM countries').all().map(c => [c.code, c.name]));
  lb.rows.forEach(r => r.countryName = names[r.country_code]);
  res.json({ html: lb.rows.map(render.leaderCard).join(''), hasMore: (safeOffset + 24) < lb.total });
});

const send = (res, html) => html ? res.type('html').send(html) : res.status(404).type('html').send(notFound());
app.get('/', (req, res) => send(res, render.homePage()));
app.get('/leaders', (req, res) => { const category = String(req.query.category || 'all').slice(0, 40); const cat = db.prepare('SELECT name FROM categories WHERE id=?').get(category); send(res, render.leadersPage({ category, title: cat ? cat.name : 'All Leaders' })); });
app.get('/history', (req, res) => send(res, render.leadersPage({ category: 'historical', title: 'Historical Leaders', nav: 'HISTORY', pathUrl: '/history' })));
app.get('/leader/:slug', (req, res) => send(res, render.leaderPage(req.params.slug)));
app.get('/countries', (req, res) => send(res, render.countriesPage()));
app.get('/country/:code', (req, res) => send(res, render.countryPage(req.params.code)));
app.get('/country/:code/anthem', (req, res) => send(res, render.anthemPage(req.params.code)));
app.get('/trending', (req, res) => send(res, render.trendingPage()));
app.get('/about', (req, res) => send(res, render.aboutPage()));
app.get('/legal', (req, res) => send(res, render.legalPage()));
app.get('/vote/:slug', (req, res) => { const ref = String(req.query.ref || '').slice(0, 24); res.redirect(302, `/leader/${encodeURIComponent(req.params.slug)}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`); });
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));

app.get('/sitemap.xml', (req, res) => {
  const base = String(process.env.PUBLIC_BASE_URL || 'https://globalleaders.live').replace(/\/$/, '');
  const urls = ['/', '/leaders', '/countries', '/trending', '/history', '/about', '/legal', ...db.prepare('SELECT slug FROM leaders WHERE visible=1').all().map(l => `/leader/${l.slug}`), ...db.prepare('SELECT code FROM countries').all().flatMap(c => [`/country/${c.code.toLowerCase()}`, `/country/${c.code.toLowerCase()}/anthem`])];
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${base}${u}</loc></url>`).join('')}</urlset>`);
});

function notFound() { return render.layout({ title: 'Not found — Global Leaders Live', description: 'Page not found', path: '/404', body: `<section class="page-head center" style="padding:6rem 1rem"><h1>404</h1><p class="muted">This leader hasn't made it onto the ranking… yet.</p><p><a class="btn btn-vote" href="/">BACK TO THE LIVE RANKING</a></p></section>` }); }
app.use((req, res) => res.status(404).type('html').send(notFound()));
app.use((err, req, res, next) => { console.error(err); if (res.headersSent) return next(err); res.status(500).json({ error: 'internal_error' }); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`GLOBAL LEADERS LIVE running on 0.0.0.0:${PORT}`));
