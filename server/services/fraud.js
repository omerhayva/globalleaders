// Anti-abuse / fraud service. Server-side enforcement — frontend limits are cosmetic.
const crypto = require('crypto');
const db = require('../db');

const isProduction = process.env.NODE_ENV === 'production';
const SALT = process.env.GL_FRAUD_SALT;
if (isProduction && (!SALT || SALT.length < 32)) {
  throw new Error('GL_FRAUD_SALT must be set to a random value of at least 32 characters in production');
}
const EFFECTIVE_SALT = SALT || 'local-development-only-fraud-salt';
const hash = s => crypto.createHash('sha256').update(EFFECTIVE_SALT + String(s)).digest('hex').slice(0, 24);

// In-memory throttles are appropriate only for the current single-process SQLite deployment.
const lastVoteAt = new Map();
const ipDayCounts = new Map();
const suspendedIps = new Map();
let lastCleanup = Date.now();

function cleanup(now) {
  if (now - lastCleanup < 10 * 60_000) return;
  lastCleanup = now;
  for (const [k, until] of suspendedIps) if (until <= now) suspendedIps.delete(k);
  for (const [k, ts] of lastVoteAt) if (now - ts > 24 * 3600_000) lastVoteAt.delete(k);
  for (const [k, value] of ipDayCounts) {
    if (k.endsWith(':vel')) {
      const recent = value.filter(t => now - t < 120000);
      if (recent.length) ipDayCounts.set(k, recent); else ipDayCounts.delete(k);
    } else if (now - Date.parse(k.slice(k.length - 10)) > 2 * 86400_000) {
      ipDayCounts.delete(k);
    }
  }
}

function logFraud(kind, sessionId, ipHash, detail) {
  db.prepare('INSERT INTO fraud_events (kind,session_id,ip_hash,detail) VALUES (?,?,?,?)')
    .run(kind, sessionId || null, ipHash || null, detail || null);
}

const VOTE_COOLDOWN_MS = 1200;
const IP_DAILY_CAP = 80;
const SUSPEND_MS = 15 * 60 * 1000;

function checkVote({ ip, sessionId, day }) {
  const now = Date.now();
  cleanup(now);
  const ipHash = hash(ip);
  const until = suspendedIps.get(ipHash);
  if (until && until > now) return { ok: false, reason: 'suspended', ipHash };
  if (until) suspendedIps.delete(ipHash);

  const last = lastVoteAt.get(ipHash) || 0;
  if (now - last < VOTE_COOLDOWN_MS) {
    logFraud('cooldown_violation', sessionId, ipHash, `gap=${now - last}ms`);
    return { ok: false, reason: 'too_fast', ipHash };
  }

  const key = ipHash + day;
  const count = ipDayCounts.get(key) || 0;
  if (count >= IP_DAILY_CAP) {
    suspendedIps.set(ipHash, now + SUSPEND_MS);
    logFraud('ip_daily_cap', sessionId, ipHash, `count=${count}`);
    return { ok: false, reason: 'daily_cap', ipHash };
  }

  const velKey = ipHash + ':vel';
  const arr = (ipDayCounts.get(velKey) || []).filter(t => now - t < 120000);
  arr.push(now);
  ipDayCounts.set(velKey, arr);
  if (arr.length > 25) {
    logFraud('abnormal_velocity', sessionId, ipHash, `reqs2m=${arr.length}`);
    return { ok: false, reason: 'captcha_required', ipHash };
  }
  return { ok: true, ipHash };
}

function recordVote(ipHash, day, n = 1) {
  const now = Date.now();
  lastVoteAt.set(ipHash, now);
  const key = ipHash + day;
  ipDayCounts.set(key, (ipDayCounts.get(key) || 0) + n);
}

function checkReferral({ shareId, visitorIp, ownerSession }) {
  const ipHash = hash(visitorIp);
  const seen = db.prepare('SELECT 1 FROM referrals WHERE share_id=? AND visitor_ip_hash=?').get(shareId, ipHash);
  if (seen) return { ok: false, reason: 'duplicate', ipHash };
  const share = db.prepare('SELECT session_id FROM shares WHERE id=?').get(shareId);
  if (share && share.session_id === ownerSession) {
    logFraud('self_referral', ownerSession, ipHash, shareId);
    return { ok: false, reason: 'self_referral', ipHash };
  }
  return { ok: true, ipHash };
}

module.exports = { hash, checkVote, recordVote, checkReferral, logFraud };
