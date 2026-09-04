const crypto = require('crypto');

const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 160);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().slice(0, 32);
}

function validUsername(value) {
  return /^[a-z0-9_]{3,32}$/.test(value);
}

function validPassword(value) {
  return typeof value === 'string' && value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX;
}

function hashPassword(password) {
  if (!validPassword(password)) throw new Error('invalid_password');
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, encoded) {
  try {
    const [scheme, saltHex, hashHex] = String(encoded || '').split('$');
    if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password || ''), salt, expected.length, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

function newToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function expiry(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000).toISOString();
}

function tokenMatchesExpiry(token, hash, expiresAt) {
  if (!token || !hash || !expiresAt) return false;
  if (Date.parse(expiresAt) <= Date.now()) return false;
  const a = Buffer.from(tokenHash(token), 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

module.exports = {
  PASSWORD_MIN,
  PASSWORD_MAX,
  normalizeEmail,
  normalizeUsername,
  validUsername,
  validPassword,
  hashPassword,
  verifyPassword,
  newToken,
  tokenHash,
  expiry,
  tokenMatchesExpiry
};
