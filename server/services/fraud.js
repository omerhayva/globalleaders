// Anti-abuse / fraud service. Server-side enforcement — the frontend limits are cosmetic.
const crypto = require('crypto');
const db = require('../db');

const SALT = 'gl-live-salt-v1';
const hash = s => crypto.createHash('sha256').update(SALT + String(s)).digest('hex').slice(0, 24);

// in-memory throttles (per-process; back with Redis when scaling out)
const lastVoteAt = new Map();      // ipHash -> ts
const ipDayCounts = new Map();     // ipHash+day -> count
const suspendedIps = new Map();    // ipHash -> untilTs

function logFraud(kind, sessionId, ipHash, detail) {
  db.prepare('INSERT INTO fraud_events (kind,session_id,ip_hash,detail) VALUES (?,?,?,?)')
    .run(kind, sessionId || null, ipHash || null, detail || null);
}

const VOTE_COOLDOWN_MS = 1200;     // min gap between vote requests per IP
const IP_DAILY_CAP = 80;           // votes/day/IP across all sessions
const SUSPEND_MS = 15 * 60 * 1000;

function checkVote({ ip, sessionId, day }) {
  const ipHash = hash(ip);
  const now = Date.now();

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

  // abnormal velocity: >25 vote requests within any rolling 2 minutes -> captcha flag
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
  lastVoteAt.set(ipHash, Date.now());
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
