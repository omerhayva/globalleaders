const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', 'var');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'globalleaders.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE, display_name TEXT, provider TEXT DEFAULT 'guest',
  is_admin INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS countries (
  code TEXT PRIMARY KEY, name TEXT NOT NULL,
  anthem_title TEXT, anthem_audio TEXT, status TEXT DEFAULT 'active',
  total_votes INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS leaders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, country_code TEXT NOT NULL REFERENCES countries(code),
  status TEXT NOT NULL DEFAULT 'historical',
  categories TEXT NOT NULL DEFAULT '[]',
  era TEXT, years TEXT, title TEXT, bio TEXT,
  portrait TEXT,
  visible INTEGER DEFAULT 1, featured INTEGER DEFAULT 0, verified INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  total_votes INTEGER DEFAULT 0, rank INTEGER, prev_rank INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vote_sessions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL, day TEXT NOT NULL,
  ip TEXT, ua_hash TEXT,
  free_used INTEGER DEFAULT 0, bonus_earned INTEGER DEFAULT 0, bonus_used INTEGER DEFAULT 0,
  suspended INTEGER DEFAULT 0, last_share_at INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  leader_id INTEGER NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  session_id TEXT, user_id INTEGER,
  type TEXT DEFAULT 'free',
  source TEXT DEFAULT 'web', country TEXT, ip_hash TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_votes_leader ON votes(leader_id, created_at);
CREATE INDEX IF NOT EXISTS idx_votes_time ON votes(created_at);
CREATE TABLE IF NOT EXISTS bonus_votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT, reason TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS referrals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, share_id TEXT, visitor_session TEXT, visitor_ip_hash TEXT,
  leader_id INTEGER, converted INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS shares (
  id TEXT PRIMARY KEY, session_id TEXT, leader_id INTEGER, platform TEXT,
  clicks INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS leader_rank_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, leader_id INTEGER, day TEXT, rank INTEGER, votes INTEGER,
  UNIQUE(leader_id, day)
);
CREATE TABLE IF NOT EXISTS leader_daily_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, leader_id INTEGER, day TEXT, votes INTEGER DEFAULT 0, shares INTEGER DEFAULT 0,
  UNIQUE(leader_id, day)
);
CREATE TABLE IF NOT EXISTS leader_weekly_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT, leader_id INTEGER, week TEXT, votes INTEGER DEFAULT 0,
  UNIQUE(leader_id, week)
);
CREATE TABLE IF NOT EXISTS advertising_slots (
  id TEXT PRIMARY KEY,
  label TEXT, price_usd REAL DEFAULT 5.0, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS advertisements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id TEXT REFERENCES advertising_slots(id),
  advertiser TEXT, image TEXT, text TEXT, cta TEXT, url TEXT,
  starts_at TEXT, ends_at TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS ad_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slot_id TEXT, ad_id INTEGER, payment_id INTEGER,
  advertiser TEXT, amount_usd REAL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS anthem_slots (
  country_code TEXT PRIMARY KEY REFERENCES countries(code),
  sponsor TEXT, sponsor_session TEXT, price_usd REAL DEFAULT 5.0,
  purchased_at TEXT
);
CREATE TABLE IF NOT EXISTS anthem_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT, sponsor TEXT, payment_id INTEGER,
  amount_usd REAL, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS anthem_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country_code TEXT, sponsor TEXT, event TEXT, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT, intent_id TEXT UNIQUE, kind TEXT,
  reference TEXT, amount_usd REAL, currency TEXT DEFAULT 'USD',
  status TEXT DEFAULT 'pending',
  demo INTEGER DEFAULT 1, session_id TEXT, meta TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, message TEXT, country TEXT, leader_id INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS fraud_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, session_id TEXT, ip_hash TEXT, detail TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY, value TEXT
);
CREATE TABLE IF NOT EXISTS vote_idempotency (
  session_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (session_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_vote_idempotency_created ON vote_idempotency(created_at);
`);

const addCol = (table, colDef) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  } catch (err) {
    if (!/duplicate column name/i.test(String(err && err.message))) throw err;
  }
};
addCol('vote_sessions', 'purchased INTEGER DEFAULT 0');
addCol('vote_sessions', 'purchased_used INTEGER DEFAULT 0');
addCol('anthem_slots', 'sponsor_x TEXT');
addCol('anthem_purchases', 'sponsor_x TEXT');
addCol('advertisements', 'x_handle TEXT');
addCol('leaders', 'community INTEGER DEFAULT 0');
addCol('leaders', 'suggested_by TEXT');
addCol('vote_sessions', 'user_id INTEGER');
addCol('users', 'x_handle TEXT');
addCol('users', 'avatar_color TEXT');
addCol('votes', 'device_hash TEXT');
db.exec(`CREATE INDEX IF NOT EXISTS idx_votes_device ON votes(device_hash, type, created_at)`);

module.exports = db;
