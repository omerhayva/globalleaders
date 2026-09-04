// Core domain logic: voting, ranking, trending, stats, activity.
const crypto = require('crypto');
const db = require('./db');
const sse = require('./services/sse');
const fraud = require('./services/fraud');
const { recomputeRanks, dayStr } = require('./seed');

const getSetting = k => (db.prepare('SELECT value FROM site_settings WHERE key=?').get(k) || {}).value;
const setSetting = (k, v) => db.prepare('INSERT OR REPLACE INTO site_settings (key,value) VALUES (?,?)').run(k, String(v));

const FLAG = cc => String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0)));

// ---------- sessions ----------
function getOrCreateVoteSession(sessionId, ip, ua) {
  const day = dayStr();
  const id = sessionId + ':' + day;
  let vs = db.prepare('SELECT * FROM vote_sessions WHERE id=?').get(id);
  if (!vs) {
    db.prepare(`INSERT INTO vote_sessions (id,session_id,day,ip,ua_hash) VALUES (?,?,?,?,?)`)
      .run(id, sessionId, day, fraud.hash(ip), fraud.hash(ua || ''));
    vs = db.prepare('SELECT * FROM vote_sessions WHERE id=?').get(id);
  }
  return vs;
}
function remainingVotes(vs) {
  const free = parseInt(getSetting('free_votes_per_day') || '1', 10);
  return Math.max(0, free - vs.free_used)
    + Math.max(0, vs.bonus_earned - vs.bonus_used)
    + Math.max(0, (vs.purchased || 0) - (vs.purchased_used || 0));
}

// ---------- voting ----------
// Economy: 1 free vote/day. Extra votes ONLY via sharing (+1 bonus) or purchased packs.
// Ayrıca CIHAZ bazlı limit: bedava ve bonus oylar, aynı IP+UA parmak izinden
// günde en fazla ekonomi izin verdiği kadar harcanabilir. Bu, X-GL-Session
// başlığını değiştirerek (oturum rotasyonu) sınırsız bedava oy atmayı engeller.
function castVotes({ sessionId, ip, ua, leaderSlug, count, source = 'web' }) {
  count = Math.max(1, Math.min(10, parseInt(count, 10) || 1));
  const leader = db.prepare(`SELECT * FROM leaders WHERE slug=? AND visible=1`).get(leaderSlug);
  if (!leader) return { error: 'leader_not_found' };

  const day = dayStr();
  const chk = fraud.checkVote({ ip, sessionId, day });
  if (!chk.ok) return { error: chk.reason };

  const vs = getOrCreateVoteSession(sessionId, ip, ua);
  if (vs.suspended) return { error: 'suspended' };
  const remaining = remainingVotes(vs);
  if (remaining <= 0) return { error: 'no_votes_left', remaining: 0 };
  if (count > remaining) count = remaining;

  const free = parseInt(getSetting('free_votes_per_day') || '1', 10);
  const bonusCap = parseInt(getSetting('max_bonus_per_day') || '3', 10);

  // Cihaz parmak izi ve bugüne ait harcama sayıları (free/bonus), TÜM oturumlar
  // üzerinden. Satın alınan oylar cihaz limitine tabi değildir.
  const deviceHash = fraud.hash(String(ip) + '|' + String(ua || ''));
  const deviceFreeUsed = db.prepare(
    `SELECT COUNT(*) c FROM votes WHERE device_hash=? AND type='free' AND created_at >= ?`
  ).get(deviceHash, day).c;
  const deviceBonusUsed = db.prepare(
    `SELECT COUNT(*) c FROM votes WHERE device_hash=? AND type='bonus' AND created_at >= ?`
  ).get(deviceHash, day).c;

  let freeToUse = Math.min(count,
    Math.max(0, free - vs.free_used),          // oturum hakkı
    Math.max(0, free - deviceFreeUsed));       // cihaz hakkı (rotasyon koruması)
  let bonusToUse = Math.min(count - freeToUse,
    Math.max(0, vs.bonus_earned - vs.bonus_used),
    Math.max(0, bonusCap - deviceBonusUsed));  // bonus da cihaz başına sınırlı
  let purchasedToUse = Math.min(count - freeToUse - bonusToUse,
    Math.max(0, (vs.purchased || 0) - (vs.purchased_used || 0)));
  const spendable = freeToUse + bonusToUse + purchasedToUse;
  if (spendable <= 0) return { error: 'device_limit', remaining: 0 };
  if (spendable < count) count = spendable;

  const oldRank = leader.rank;
  const tx = db.transaction(() => {
    const ins = db.prepare(`INSERT INTO votes (leader_id,session_id,type,source,country,ip_hash,device_hash) VALUES (?,?,?,?,?,?,?)`);
    for (let i = 0; i < freeToUse; i++) ins.run(leader.id, sessionId, 'free', source, leader.country_code, chk.ipHash, deviceHash);
    for (let i = 0; i < bonusToUse; i++) ins.run(leader.id, sessionId, 'bonus', source, leader.country_code, chk.ipHash, deviceHash);
    for (let i = 0; i < purchasedToUse; i++) ins.run(leader.id, sessionId, 'purchased', source, leader.country_code, chk.ipHash, deviceHash);
    db.prepare('UPDATE vote_sessions SET free_used=free_used+?, bonus_used=bonus_used+?, purchased_used=purchased_used+? WHERE id=?')
      .run(freeToUse, bonusToUse, purchasedToUse, vs.id);
    db.prepare('UPDATE leaders SET total_votes=total_votes+? WHERE id=?').run(count, leader.id);
    db.prepare('UPDATE countries SET total_votes=total_votes+? WHERE code=?').run(count, leader.country_code);
    db.prepare(`INSERT INTO leader_daily_stats (leader_id,day,votes,shares) VALUES (?,?,?,0)
                ON CONFLICT(leader_id,day) DO UPDATE SET votes=votes+excluded.votes`).run(leader.id, day, count);
  });
  tx();
  fraud.recordVote(chk.ipHash, day, count);

  const changes = recomputeRanks();
  const updated = db.prepare('SELECT rank,total_votes FROM leaders WHERE id=?').get(leader.id);
  logRankHistoryToday(leader.id, updated.rank, updated.total_votes);

  pushActivity('vote', `${FLAG(leader.country_code)} Someone voted for ${leader.name} (+${count})`, leader.country_code, leader.id);
  sse.broadcast('vote_created', { leaderId: leader.id, slug: leader.slug, count });
  sse.broadcast('leader_vote_count_updated', { slug: leader.slug, totalVotes: updated.total_votes, rank: updated.rank });
  if (changes.length) {
    sse.broadcast('leader_rank_changed', { changes });
    changes.filter(c => c.from && c.to < c.from).slice(0, 2).forEach(c => {
      const l = db.prepare('SELECT name,country_code FROM leaders WHERE id=?').get(c.id);
      if (l) pushActivity('rank', `${FLAG(l.country_code)} ${l.name} moved to #${c.to} ↑`, l.country_code, c.id);
    });
  }

  const vs2 = db.prepare('SELECT * FROM vote_sessions WHERE id=?').get(vs.id);
  return {
    ok: true, leader: leader.slug, count,
    oldRank, newRank: updated.rank, totalVotes: updated.total_votes,
    remaining: remainingVotes(vs2),
    free_used: vs2.free_used, bonus_earned: vs2.bonus_earned, bonus_used: vs2.bonus_used,
    purchased: vs2.purchased || 0, purchased_used: vs2.purchased_used || 0
  };
}

// votes cast by this visitor (all time) — powers "welcome back" + my-votes panel
function myVotes(sessionId) {
  return db.prepare(`SELECT l.slug, l.name, l.country_code, l.rank, COUNT(*) n, MAX(v.created_at) last
    FROM votes v JOIN leaders l ON l.id=v.leader_id
    WHERE v.session_id=? GROUP BY v.leader_id ORDER BY last DESC LIMIT 50`).all(sessionId)
    .map(r => ({ ...r, flag: FLAG(r.country_code) }));
}

// latest sponsored anthem (for homepage feature)
function featuredAnthem() {
  const p = db.prepare(`SELECT a.country_code, a.sponsor, a.sponsor_x, a.created_at,
      c.name, c.anthem_title, c.anthem_audio
    FROM anthem_purchases a JOIN countries c ON c.code=a.country_code
    ORDER BY a.id DESC LIMIT 1`).get();
  if (!p) return null;
  // only feature if still the current owner
  const cur = db.prepare('SELECT sponsor FROM anthem_slots WHERE country_code=?').get(p.country_code);
  if (!cur || cur.sponsor !== p.sponsor) return null;
  return { ...p, flag: FLAG(p.country_code) };
}

function logRankHistoryToday(leaderId, rank, votes) {
  db.prepare(`INSERT INTO leader_rank_history (leader_id,day,rank,votes) VALUES (?,?,?,?)
              ON CONFLICT(leader_id,day) DO UPDATE SET rank=excluded.rank, votes=excluded.votes`)
    .run(leaderId, dayStr(), rank, votes);
}

// ---------- share / bonus ----------
function registerShare({ sessionId, ip, leaderSlug, platform }) {
  const leader = db.prepare('SELECT * FROM leaders WHERE slug=?').get(leaderSlug);
  if (!leader) return { error: 'leader_not_found' };
  const vs = getOrCreateVoteSession(sessionId, ip, '');
  const shareId = crypto.randomBytes(6).toString('hex');
  db.prepare('INSERT INTO shares (id,session_id,leader_id,platform) VALUES (?,?,?,?)')
    .run(shareId, sessionId, leader.id, platform || 'link');
  db.prepare(`INSERT INTO leader_daily_stats (leader_id,day,votes,shares) VALUES (?,?,0,1)
              ON CONFLICT(leader_id,day) DO UPDATE SET shares=shares+1`).run(leader.id, dayStr());

  // bonus rules: max N/day, 30s cooldown between share bonuses
  const maxBonus = parseInt(getSetting('max_bonus_per_day') || '3', 10);
  let bonusAwarded = false;
  const now = Date.now();
  if (vs.bonus_earned < maxBonus && now - (vs.last_share_at || 0) > 30000) {
    db.prepare('UPDATE vote_sessions SET bonus_earned=bonus_earned+1, last_share_at=? WHERE id=?').run(now, vs.id);
    db.prepare('INSERT INTO bonus_votes (session_id,reason) VALUES (?,?)').run(sessionId, 'share:' + (platform || 'link'));
    bonusAwarded = true;
  } else if (vs.bonus_earned >= maxBonus) {
    fraud.logFraud('bonus_cap_reached', sessionId, fraud.hash(ip), platform);
  }
  const vs2 = db.prepare('SELECT * FROM vote_sessions WHERE id=?').get(vs.id);
  pushActivity('share', `${FLAG(leader.country_code)} ${leader.name} was shared on ${platform || 'social'}`, leader.country_code, leader.id);
  return {
    ok: true, shareId, bonusAwarded,
    shareUrl: `/vote/${leader.slug}?ref=${shareId}`,
    remaining: remainingVotes(vs2), bonus_earned: vs2.bonus_earned
  };
}

// ---------- queries ----------
const leaderCols = `id,slug,name,country_code,status,categories,era,years,title,bio,portrait,featured,verified,community,total_votes,rank,prev_rank`;

function leaderboard({ limit = 10, offset = 0, category = null, country = null } = {}) {
  let where = 'visible=1'; const args = [];
  if (country) { where += ' AND country_code=?'; args.push(country); }
  if (category && category !== 'all') {
    if (category === 'current' || category === 'historical') { where += ' AND status=?'; args.push(category); }
    else { where += ` AND categories LIKE ?`; args.push(`%"${category}"%`); }
  }
  const rows = db.prepare(`SELECT ${leaderCols} FROM leaders WHERE ${where} ORDER BY total_votes DESC, id ASC LIMIT ? OFFSET ?`)
    .all(...args, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) c FROM leaders WHERE ${where}`).get(...args).c;
  const globalTotal = db.prepare('SELECT COALESCE(SUM(total_votes),1) s FROM leaders WHERE visible=1').get().s;
  return { total, rows: rows.map(r => decorate(r, globalTotal)) };
}

const stmtCountryName = db.prepare('SELECT name FROM countries WHERE code=?');
function decorate(r, globalTotal) {
  const spark = db.prepare('SELECT votes FROM leader_daily_stats WHERE leader_id=? ORDER BY day DESC LIMIT 7').all(r.id)
    .map(x => x.votes).reverse();
  return {
    ...r, categories: JSON.parse(r.categories || '[]'),
    flag: FLAG(r.country_code),
    countryName: (stmtCountryName.get(r.country_code) || {}).name, // API ve SSR aynı ülke adını versin
    pct: globalTotal ? +(100 * r.total_votes / globalTotal).toFixed(2) : 0,
    movement: (r.prev_rank && r.rank) ? r.prev_rank - r.rank : 0,
    spark
  };
}

function leaderProfile(slug) {
  const r = db.prepare(`SELECT ${leaderCols} FROM leaders WHERE slug=? AND visible=1`).get(slug);
  if (!r) return null;
  const globalTotal = db.prepare('SELECT COALESCE(SUM(total_votes),1) s FROM leaders WHERE visible=1').get().s;
  const l = decorate(r, globalTotal);
  const today = dayStr();
  l.votesToday = (db.prepare('SELECT votes FROM leader_daily_stats WHERE leader_id=? AND day=?').get(r.id, today) || {}).votes || 0;
  l.votes7d = db.prepare(`SELECT COALESCE(SUM(votes),0) s FROM leader_daily_stats WHERE leader_id=? AND day>=?`).get(r.id, dayStr(6)).s;
  l.votes30d = db.prepare(`SELECT COALESCE(SUM(votes),0) s FROM leader_daily_stats WHERE leader_id=? AND day>=?`).get(r.id, dayStr(29)).s;
  l.rankHistory = db.prepare('SELECT day,rank,votes FROM leader_rank_history WHERE leader_id=? ORDER BY day').all(r.id);
  l.dailyVotes = db.prepare('SELECT day,votes FROM leader_daily_stats WHERE leader_id=? ORDER BY day DESC LIMIT 30').all(r.id).reverse();
  l.countryName = (db.prepare('SELECT name FROM countries WHERE code=?').get(r.country_code) || {}).name;
  const cinfo = db.prepare('SELECT anthem_title, anthem_audio FROM countries WHERE code=?').get(r.country_code) || {};
  l.anthemTitle = cinfo.anthem_title; l.anthemAudio = cinfo.anthem_audio;
  l.countryRank = db.prepare(`SELECT COUNT(*)+1 c FROM leaders WHERE country_code=? AND visible=1 AND total_votes > ?`)
    .get(r.country_code, r.total_votes).c;
  l.related = db.prepare(`SELECT slug,name,country_code,rank,total_votes FROM leaders
    WHERE visible=1 AND id != ? AND (country_code=? OR categories LIKE ?) ORDER BY total_votes DESC LIMIT 6`)
    .all(r.id, r.country_code, `%"${JSON.parse(r.categories || '[]')[0] || 'x'}"%`)
    .map(x => ({ ...x, flag: FLAG(x.country_code) }));
  return l;
}

function countryInfo(code) {
  const c = db.prepare('SELECT * FROM countries WHERE code=?').get(code.toUpperCase());
  if (!c) return null;
  const lb = leaderboard({ limit: 50, country: c.code });
  const anthem = db.prepare('SELECT * FROM anthem_slots WHERE country_code=?').get(c.code) || null;
  const anthemHistory = db.prepare('SELECT sponsor,amount_usd,created_at FROM anthem_purchases WHERE country_code=? ORDER BY id DESC LIMIT 10').all(c.code);
  const countryRankRow = db.prepare('SELECT COUNT(*)+1 r FROM countries WHERE total_votes > ?').get(c.total_votes);
  const trend = db.prepare(`SELECT s.day, SUM(s.votes) v FROM leader_daily_stats s JOIN leaders l ON l.id=s.leader_id
    WHERE l.country_code=? GROUP BY s.day ORDER BY s.day DESC LIMIT 14`).all(c.code).reverse();
  return { ...c, flag: FLAG(c.code), leaders: lb.rows, anthem, anthemHistory, globalRank: countryRankRow.r, trend };
}

function globalStats() {
  const today = dayStr();
  return {
    totalVotes: db.prepare('SELECT COALESCE(SUM(total_votes),0) s FROM leaders').get().s,
    leaders: db.prepare('SELECT COUNT(*) c FROM leaders WHERE visible=1').get().c,
    countries: db.prepare('SELECT COUNT(*) c FROM countries').get().c,
    votesToday: db.prepare('SELECT COALESCE(SUM(votes),0) s FROM leader_daily_stats WHERE day=?').get(today).s,
    sharesToday: db.prepare('SELECT COALESCE(SUM(shares),0) s FROM leader_daily_stats WHERE day=?').get(today).s
  };
}

function trending() {
  const globalTotal = db.prepare('SELECT COALESCE(SUM(total_votes),1) s FROM leaders WHERE visible=1').get().s;
  const dec = rows => rows.map(r => decorate(r, globalTotal));
  const base = `SELECT ${leaderCols} FROM leaders WHERE visible=1`;
  const risers = db.prepare(`SELECT l.*, (h1.rank - l.rank) AS delta FROM leaders l
      JOIN leader_rank_history h1 ON h1.leader_id=l.id AND h1.day=?
      WHERE l.visible=1 AND (h1.rank - l.rank) > 0 ORDER BY delta DESC LIMIT 8`).all(dayStr(7));
  const fallers = db.prepare(`SELECT l.*, (h1.rank - l.rank) AS delta FROM leaders l
      JOIN leader_rank_history h1 ON h1.leader_id=l.id AND h1.day=?
      WHERE l.visible=1 AND (h1.rank - l.rank) < 0 ORDER BY delta ASC LIMIT 8`).all(dayStr(7));
  const todayTop = db.prepare(`SELECT l.*, s.votes AS today FROM leaders l
      JOIN leader_daily_stats s ON s.leader_id=l.id AND s.day=? WHERE l.visible=1 ORDER BY s.votes DESC LIMIT 8`).all(dayStr());
  const weekTop = db.prepare(`SELECT l.*, SUM(s.votes) AS week FROM leaders l
      JOIN leader_daily_stats s ON s.leader_id=l.id AND s.day>=? WHERE l.visible=1 GROUP BY l.id ORDER BY week DESC LIMIT 8`).all(dayStr(6));
  const mostShared = db.prepare(`SELECT l.*, SUM(s.shares) AS shares FROM leaders l
      JOIN leader_daily_stats s ON s.leader_id=l.id AND s.day>=? WHERE l.visible=1 GROUP BY l.id ORDER BY shares DESC LIMIT 8`).all(dayStr(6));
  const activeCountries = db.prepare(`SELECT c.code, c.name, SUM(s.votes) v FROM countries c
      JOIN leaders l ON l.country_code=c.code JOIN leader_daily_stats s ON s.leader_id=l.id AND s.day>=?
      GROUP BY c.code ORDER BY v DESC LIMIT 8`).all(dayStr(6)).map(c => ({ ...c, flag: FLAG(c.code) }));
  const attach = (rows, key) => dec(rows).map((r, i) => ({ ...r, extra: rows[i][key] }));
  return {
    risers: attach(risers, 'delta'), fallers: attach(fallers, 'delta'),
    today: attach(todayTop, 'today'), week: attach(weekTop, 'week'),
    shared: attach(mostShared, 'shares'), activeCountries,
    viral: attach(mostShared.slice(0, 4), 'shares')
  };
}

function countriesMapData() {
  const max = db.prepare('SELECT MAX(total_votes) m FROM countries').get().m || 1;
  return db.prepare(`SELECT c.code, c.name, c.total_votes,
      (SELECT name FROM leaders l WHERE l.country_code=c.code AND l.visible=1 ORDER BY total_votes DESC LIMIT 1) top_leader,
      (SELECT slug FROM leaders l WHERE l.country_code=c.code AND l.visible=1 ORDER BY total_votes DESC LIMIT 1) top_slug,
      (SELECT rank FROM leaders l WHERE l.country_code=c.code AND l.visible=1 ORDER BY total_votes DESC LIMIT 1) top_rank
    FROM countries c ORDER BY c.total_votes DESC`).all()
    .map((c, i) => ({ ...c, flag: FLAG(c.code), intensity: +(c.total_votes / max).toFixed(3), globalRank: i + 1 }));
}

function pushActivity(type, message, country, leaderId) {
  db.prepare('INSERT INTO activity_events (type,message,country,leader_id) VALUES (?,?,?,?)').run(type, message, country, leaderId || null);
  sse.broadcast('activity_created', { type, message, country, at: Date.now() });
}
const recentActivity = (n = 20) => db.prepare('SELECT type,message,country,created_at FROM activity_events ORDER BY id DESC LIMIT ?').all(n);

module.exports = {
  getSetting, setSetting, FLAG, getOrCreateVoteSession, remainingVotes, castVotes,
  registerShare, leaderboard, leaderProfile, countryInfo, globalStats, trending,
  countriesMapData, pushActivity, recentActivity, decorate, logRankHistoryToday,
  myVotes, featuredAnthem
};
