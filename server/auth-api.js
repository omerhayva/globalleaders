const express = require('express');
const crypto = require('crypto');
const db = require('./db');
const core = require('./core');
const { rateLimit } = require('./services/ratelimit');
const { cleanText, safeInitials } = require('./services/sanitize');
const auth = require('./services/auth');

const router = express.Router();
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const verifyMinutes = 60 * 24;
const resetMinutes = 30;

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.display_name, email: u.email, provider: 'local', email_verified: !!u.email_verified_at, x_handle: u.x_handle || null, color: u.avatar_color || '#f5b524', initials: safeInitials(u.display_name || u.username) };
}

function sessionUser(sessionId) {
  return db.prepare(`SELECT u.* FROM users u JOIN vote_sessions vs ON vs.user_id=u.id WHERE vs.session_id=? ORDER BY vs.created_at DESC LIMIT 1`).get(sessionId);
}

function attachSession(user, sessionId) {
  db.prepare('UPDATE vote_sessions SET user_id=? WHERE session_id=?').run(user.id, sessionId);
  db.prepare(`INSERT INTO vote_sessions (id,session_id,day,user_id) VALUES (?,?,date('now'),?) ON CONFLICT(id) DO UPDATE SET user_id=excluded.user_id`).run(`${sessionId}:${new Date().toISOString().slice(0,10)}`, sessionId, user.id);
}

async function sendMail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.AUTH_FROM_EMAIL;
  if (!key || !from) throw new Error('email_delivery_not_configured');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject, html })
  });
  if (!r.ok) throw new Error('email_delivery_failed');
}

function baseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
}

function safeTokenUrl(path, token) {
  return `${baseUrl()}${path}?token=${encodeURIComponent(token)}`;
}

router.post('/register', rateLimit({ windowMs: 10 * 60_000, max: 5, name: 'auth-register' }), async (req, res) => {
  const b = req.body || {};
  const username = auth.normalizeUsername(b.username);
  const email = auth.normalizeEmail(b.email);
  const password = typeof b.password === 'string' ? b.password : '';
  const name = cleanText(b.name || username, 60) || username;
  if (!auth.validUsername(username)) return res.status(400).json({ error: 'invalid_username', message: 'Username must be 3–32 characters using letters, numbers, or underscore.' });
  if (!EMAIL_RE.test(email) || email.length > 160) return res.status(400).json({ error: 'invalid_email' });
  if (!auth.validPassword(password)) return res.status(400).json({ error: 'invalid_password', message: 'Password must be 8–128 characters.' });
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) return res.status(409).json({ error: 'username_taken' });
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'email_taken' });
  const verifyToken = auth.newToken();
  const passwordHash = auth.hashPassword(password);
  const colors = ['#f5b524', '#38bdf8', '#a78bfa', '#fb7185', '#34d399', '#f97316'];
  const color = colors[crypto.randomInt(colors.length)];
  const info = db.prepare(`INSERT INTO users (email,username,password_hash,display_name,provider,email_verify_token_hash,email_verify_expires_at,avatar_color) VALUES (?,?,?,?,?,?,?,?)`).run(email, username, passwordHash, name, 'local', auth.tokenHash(verifyToken), auth.expiry(verifyMinutes), color);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(info.lastInsertRowid);
  try {
    await sendMail({ to: email, subject: 'Verify your Global Leaders Live account', html: `<p>Welcome, ${cleanText(name, 60)}.</p><p>Verify your email to activate your account:</p><p><a href="${safeTokenUrl('/verify-email', verifyToken)}">Verify email</a></p><p>This link expires in 24 hours.</p>` });
  } catch (e) {
    db.prepare('DELETE FROM users WHERE id=?').run(user.id);
    if (e.message === 'email_delivery_not_configured') return res.status(503).json({ error: 'email_delivery_not_configured', message: 'Email delivery is not configured on the server yet.' });
    return res.status(503).json({ error: 'email_delivery_failed' });
  }
  attachSession(user, req.sessionId);
  res.status(201).json({ ok: true, pendingVerification: true, user: publicUser(user), message: 'Account created. Check your email to verify your address.' });
});

router.post('/login', rateLimit({ windowMs: 10 * 60_000, max: 10, name: 'auth-login-real' }), (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.username || req.body?.email || '').trim().toLowerCase().slice(0, 160);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const user = db.prepare('SELECT * FROM users WHERE username=? OR email=?').get(identifier, identifier);
  const generic = () => res.status(401).json({ error: 'invalid_credentials', message: 'Username/email or password is incorrect.' });
  if (!user || !user.password_hash) return generic();
  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) return res.status(429).json({ error: 'account_locked', message: 'Too many failed attempts. Try again later.' });
  if (!auth.verifyPassword(password, user.password_hash)) {
    const failures = (user.failed_login_count || 0) + 1;
    const locked = failures >= 8 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
    db.prepare('UPDATE users SET failed_login_count=?, locked_until=? WHERE id=?').run(failures, locked, user.id);
    return generic();
  }
  db.prepare('UPDATE users SET failed_login_count=0, locked_until=NULL WHERE id=?').run(user.id);
  attachSession(user, req.sessionId);
  res.json({ ok: true, user: publicUser(user), needsEmailVerification: !user.email_verified_at });
});

router.get('/me', (req, res) => { const u = sessionUser(req.sessionId); res.json(u ? { user: publicUser(u) } : {}); });
router.post('/logout', (req, res) => { db.prepare('UPDATE vote_sessions SET user_id=NULL WHERE session_id=?').run(req.sessionId); res.json({ ok: true }); });

router.get('/verify-email', rateLimit({ windowMs: 10 * 60_000, max: 20, name: 'auth-verify' }), (req, res) => {
  const token = String(req.query.token || '').slice(0, 128);
  const users = db.prepare('SELECT * FROM users WHERE email_verify_token_hash IS NOT NULL').all();
  const user = users.find(u => auth.tokenMatchesExpiry(token, u.email_verify_token_hash, u.email_verify_expires_at));
  if (!user) return res.status(400).type('html').send('<h1>Invalid or expired verification link</h1><p>Please request a new verification email.</p>');
  db.prepare('UPDATE users SET email_verified_at=datetime(\'now\'), email_verify_token_hash=NULL, email_verify_expires_at=NULL WHERE id=?').run(user.id);
  res.type('html').send('<h1>Email verified</h1><p>Your Global Leaders Live account is verified. You can return to the site and sign in.</p>');
});

router.post('/resend-verification', rateLimit({ windowMs: 60 * 60_000, max: 3, name: 'auth-resend' }), async (req, res) => {
  const email = auth.normalizeEmail(req.body?.email);
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!user || user.email_verified_at) return res.json({ ok: true, message: 'If the account exists and needs verification, an email has been sent.' });
  const token = auth.newToken();
  db.prepare('UPDATE users SET email_verify_token_hash=?, email_verify_expires_at=? WHERE id=?').run(auth.tokenHash(token), auth.expiry(verifyMinutes), user.id);
  try { await sendMail({ to: email, subject: 'Verify your Global Leaders Live account', html: `<p><a href="${safeTokenUrl('/verify-email', token)}">Verify your email</a></p><p>This link expires in 24 hours.</p>` }); }
  catch (e) { return res.status(503).json({ error: e.message === 'email_delivery_not_configured' ? 'email_delivery_not_configured' : 'email_delivery_failed' }); }
  res.json({ ok: true, message: 'If the account exists and needs verification, an email has been sent.' });
});

router.post('/forgot-password', rateLimit({ windowMs: 60 * 60_000, max: 3, name: 'auth-forgot' }), async (req, res) => {
  const email = auth.normalizeEmail(req.body?.email);
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (user) {
    const token = auth.newToken();
    db.prepare('UPDATE users SET password_reset_token_hash=?, password_reset_expires_at=? WHERE id=?').run(auth.tokenHash(token), auth.expiry(resetMinutes), user.id);
    try { await sendMail({ to: email, subject: 'Reset your Global Leaders Live password', html: `<p>Reset your password:</p><p><a href="${safeTokenUrl('/reset-password', token)}">Reset password</a></p><p>This link expires in 30 minutes.</p>` }); }
    catch (e) { return res.status(503).json({ error: e.message === 'email_delivery_not_configured' ? 'email_delivery_not_configured' : 'email_delivery_failed' }); }
  }
  res.json({ ok: true, message: 'If an account exists for that email, password reset instructions have been sent.' });
});

router.post('/reset-password', rateLimit({ windowMs: 60 * 60_000, max: 5, name: 'auth-reset' }), (req, res) => {
  const token = String(req.body?.token || '').slice(0, 128);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!auth.validPassword(password)) return res.status(400).json({ error: 'invalid_password', message: 'Password must be 8–128 characters.' });
  const users = db.prepare('SELECT * FROM users WHERE password_reset_token_hash IS NOT NULL').all();
  const user = users.find(u => auth.tokenMatchesExpiry(token, u.password_reset_token_hash, u.password_reset_expires_at));
  if (!user) return res.status(400).json({ error: 'invalid_or_expired_token' });
  db.prepare('UPDATE users SET password_hash=?, password_reset_token_hash=NULL, password_reset_expires_at=NULL, failed_login_count=0, locked_until=NULL WHERE id=?').run(auth.hashPassword(password), user.id);
  attachSession(user, req.sessionId);
  res.json({ ok: true, user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(user.id)) });
});

module.exports = router;
