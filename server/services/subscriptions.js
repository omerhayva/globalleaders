// Supporter aboneliği (aylık destekçi üyeliği).
//
// Ne kazandırır?
//   • Günlük bedava oy hakkı artar (varsayılan 1 → 5)
//   • Reklamlar gizlenir
//   • Profilde/destekçi rozeti gösterilir
//
// Neden hesaba bağlı? Abonelik tekrarlayan bir ödeme; cihaz değişince kaybolması
// müşteri kaybı olur. Bu yüzden satın alma için giriş yapılması gerekir.
//
// Ödeme: Stripe abonelik modu (kart). Kripto tekrarlayan ödemeyi desteklemediği
// için bu kalemde kullanılmaz. Stripe yapılandırılmadıysa admin panelinden elle
// aktifleştirilebilir (ör. havale/nakit ile ödeyen destekçiler).
const db = require('../db');

const PRICE_USD = () => Number(process.env.SUPPORTER_PRICE_USD || 4.99);
const BONUS_FREE_VOTES = () => Math.max(0, Number(process.env.SUPPORTER_BONUS_VOTES || 4));
const AD_FREE = () => process.env.SUPPORTER_AD_FREE !== '0';
const PLAN = 'supporter-monthly';

let ready = false;
function ensureSchema() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      identity_key TEXT,
      provider TEXT,
      status TEXT DEFAULT 'active',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      price_usd REAL,
      interval TEXT DEFAULT 'month',
      current_period_end TEXT,
      canceled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
    CREATE INDEX IF NOT EXISTS idx_subs_identity ON subscriptions(identity_key);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subs_stripe ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
  `);
  ready = true;
}

const inFuture = iso => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t > Date.now();
};

// Kullanıcı ya da cihaz kimliği için aktif abonelik var mı?
function findActive({ userId = null, identityKey = null } = {}) {
  ensureSchema();
  const rows = db.prepare(`SELECT * FROM subscriptions
                           WHERE (user_id IS NOT NULL AND user_id IS ?)
                              OR (identity_key IS NOT NULL AND identity_key IS ?)
                           ORDER BY id DESC`).all(userId, identityKey);
  return rows.find(r => (r.status === 'active' || r.status === 'past_due') && (!r.current_period_end || inFuture(r.current_period_end))) || null;
}

// Oy hakkı hesabı için: oturum kimliğinden (cihaz kimliği ya da user-<id>) abonelik arar.
function forSession(sessionId) {
  if (!sessionId) return null;
  ensureSchema();
  const sid = String(sessionId);
  const userMatch = /^user-(\d+)$/.exec(sid);
  const userId = userMatch ? Number(userMatch[1]) : null;
  if (!userId) {
    const vs = db.prepare('SELECT user_id FROM vote_sessions WHERE session_id=? AND user_id IS NOT NULL ORDER BY created_at DESC LIMIT 1').get(sid);
    if (vs && vs.user_id) return findActive({ userId: vs.user_id, identityKey: sid });
  }
  return findActive({ userId, identityKey: sid });
}

const isSupporter = opts => !!forSession(typeof opts === 'string' ? opts : (opts && opts.sessionId));

function bonusFreeVotes(sessionId) { return isSupporter(sessionId) ? BONUS_FREE_VOTES() : 0; }

function activate({ userId = null, identityKey = null, provider = 'manual', stripeSubscriptionId = null, stripeCustomerId = null, priceUsd = PRICE_USD(), interval = 'month', days = 31 } = {}) {
  ensureSchema();
  const periodEnd = new Date(Date.now() + days * 86400000).toISOString();
  const now = new Date().toISOString();
  const existing = stripeSubscriptionId
    ? db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(stripeSubscriptionId)
    : (userId ? db.prepare(`SELECT * FROM subscriptions WHERE user_id=? ORDER BY id DESC LIMIT 1`).get(userId) : null);
  if (existing) {
    db.prepare(`UPDATE subscriptions SET status='active', current_period_end=?, canceled_at=NULL, updated_at=?,
                stripe_customer_id=COALESCE(?, stripe_customer_id), identity_key=COALESCE(?, identity_key),
                user_id=COALESCE(?, user_id), price_usd=COALESCE(?, price_usd) WHERE id=?`)
      .run(periodEnd, now, stripeCustomerId, identityKey, userId, priceUsd, existing.id);
    return db.prepare('SELECT * FROM subscriptions WHERE id=?').get(existing.id);
  }
  const info = db.prepare(`INSERT INTO subscriptions (user_id,identity_key,provider,status,stripe_customer_id,stripe_subscription_id,price_usd,interval,current_period_end)
                           VALUES (?,?,?,'active',?,?,?,?,?)`)
    .run(userId, identityKey, provider, stripeCustomerId, stripeSubscriptionId, priceUsd, interval, periodEnd);
  return db.prepare('SELECT * FROM subscriptions WHERE id=?').get(info.lastInsertRowid);
}

function setStatus({ stripeSubscriptionId = null, id = null, status, periodEnd = null }) {
  ensureSchema();
  const now = new Date().toISOString();
  const row = id
    ? db.prepare('SELECT * FROM subscriptions WHERE id=?').get(id)
    : db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id=?').get(stripeSubscriptionId);
  if (!row) return null;
  db.prepare('UPDATE subscriptions SET status=?, current_period_end=COALESCE(?, current_period_end), canceled_at=?, updated_at=? WHERE id=?')
    .run(status, periodEnd, status === 'canceled' ? now : row.canceled_at, now, row.id);
  return db.prepare('SELECT * FROM subscriptions WHERE id=?').get(row.id);
}

const revoke = ({ id }) => setStatus({ id, status: 'canceled' });

function list({ limit = 200 } = {}) {
  ensureSchema();
  return db.prepare(`SELECT s.*, COALESCE(u.username, u.email) AS member
                     FROM subscriptions s LEFT JOIN users u ON u.id = s.user_id
                     ORDER BY s.id DESC LIMIT ?`).all(Math.max(1, Math.min(1000, Number(limit) || 200)));
}

function status(sessionId) {
  const row = forSession(sessionId);
  return {
    active: !!row,
    plan: PLAN,
    priceUsd: PRICE_USD(),
    interval: 'month',
    bonusFreeVotes: row ? BONUS_FREE_VOTES() : 0,
    adFree: !!row && AD_FREE(),
    currentPeriodEnd: row ? row.current_period_end : null,
    provider: row ? row.provider : null
  };
}

function stats() {
  ensureSchema();
  const active = db.prepare(`SELECT COUNT(*) c FROM subscriptions WHERE status IN ('active','past_due')`).get().c || 0;
  const canceled = db.prepare(`SELECT COUNT(*) c FROM subscriptions WHERE status='canceled'`).get().c || 0;
  const mrr = db.prepare(`SELECT COALESCE(SUM(price_usd),0) s FROM subscriptions WHERE status IN ('active','past_due')`).get().s || 0;
  return { active, canceled, mrr: Number(Number(mrr).toFixed(2)), priceUsd: PRICE_USD(), bonusFreeVotes: BONUS_FREE_VOTES(), adFree: AD_FREE(), plan: PLAN };
}

module.exports = { ensureSchema, isSupporter, forSession, bonusFreeVotes, activate, setStatus, revoke, list, status, stats, PRICE_USD, BONUS_FREE_VOTES, AD_FREE, PLAN };
