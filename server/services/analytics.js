// Kendi sunucumuzda çalışan, gizliliğe saygılı ziyaretçi ölçümü.
//
// Neden dış servis (Google Analytics vb.) yok?
//   • Sayfadaki CSP (script-src 'self') bozulmasın, üçüncü tarafa veri gitmesin.
//   • KVKK/GDPR: ham IP ve tarayıcı saklanmaz; yalnızca sunucunun kendi
//     tuzuyla üretilmiş cihaz imzası (visitor_hash) tutulur. Bu imza geri
//     döndürülemez ve reklam amaçlı hiçbir yere gönderilmez.
//
// Toplanan tek şey sayfa görüntülemeleridir. Oy, paylaşım, üyelik ve ödeme
// sayıları zaten kendi tablolarında duruyor; KPI'lar onlarla birleştirilir.
const db = require('../db');
const { dayStr } = require('../seed');
const identity = require('./identity');

let ready = false;
function ensureSchema() {
  if (ready) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS page_views (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day TEXT NOT NULL,
      path TEXT NOT NULL,
      visitor_hash TEXT NOT NULL,
      session_id TEXT,
      source TEXT,
      ref_host TEXT,
      country TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_pv_day_visitor ON page_views(day, visitor_hash);
    CREATE INDEX IF NOT EXISTS idx_pv_visitor_day ON page_views(visitor_hash, day);
    CREATE INDEX IF NOT EXISTS idx_pv_path_day ON page_views(path, day);
    CREATE INDEX IF NOT EXISTS idx_pv_created ON page_views(created_at);
  `);
  ready = true;
}

// ---- yazma: küçük bir kuyruk, toplu INSERT (istek yolunu yavaşlatmasın) ----
const queue = [];
let flushTimer = null;

function flush() {
  flushTimer = null;
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  try {
    ensureSchema();
    const ins = db.prepare(`INSERT INTO page_views (day,path,visitor_hash,session_id,source,ref_host,country) VALUES (?,?,?,?,?,?,?)`);
    const tx = db.transaction(rows => { for (const r of rows) ins.run(r.day, r.path, r.visitorHash, r.sessionId, r.source, r.refHost, r.country); });
    tx(batch);
  } catch (e) {
    // Ölçüm asla siteyi düşürmesin.
    console.error('analytics_flush_failed', e && e.message);
  }
}

const SEARCH_HOSTS = /(^|\.)(google|bing|yandex|duckduckgo|yahoo|baidu|ecosia|brave)\./i;
const SOCIAL_HOSTS = /(^|\.)(t\.co|x\.com|twitter\.com|facebook\.com|instagram\.com|wa\.me|whatsapp\.com|telegram\.(org|me)|t\.me|reddit\.com|linkedin\.com|tiktok\.com|youtube\.com|youtu\.be|pinterest\.[a-z.]+|vk\.com|discord\.(gg|com))$/i;

function classifySource(refUrl, ownHost) {
  const raw = String(refUrl || '').trim();
  if (!raw) return { source: 'direct', refHost: null };
  let host = '';
  try { host = new URL(raw).hostname.toLowerCase(); } catch { return { source: 'direct', refHost: null }; }
  // req.headers.host port içerir ("site.com:3000"), karşılaştırırken ayır.
  const own = String(ownHost || '').split(':')[0].toLowerCase();
  if (own && host === own) return { source: 'internal', refHost: host };
  if (SEARCH_HOSTS.test(host)) return { source: 'search', refHost: host };
  if (SOCIAL_HOSTS.test(host)) return { source: 'social', refHost: host };
  return { source: 'referral', refHost: host };
}

// Accept-Language başlığından kaba ülke tahmini (IP saklamadan). Örn. "tr-TR" → TR.
function countryHint(req) {
  const al = String(req.headers['accept-language'] || '');
  const m = al.match(/(?:^|,)\s*[a-zA-Z]{2,3}-([A-Za-z]{2})\b/);
  if (m) return m[1].toUpperCase();
  const c = String(req.headers['cf-ipcountry'] || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
}

// Sayfa görüntülemesi kaydı. Statik dosyalar, API çağrıları, /admin ve bot
// trafiği buraya girmez (çağıran taraf süzer).
function recordView(req, path) {
  try {
    const id = identity.resolveIdentity(req);
    const { source, refHost } = classifySource(req.headers.referer || req.headers.referrer, req.headers.host);
    queue.push({
      day: dayStr(),
      path: String(path || '/').slice(0, 180),
      visitorHash: id.device.sig,
      sessionId: id.cookieSession || null,
      source, refHost, country: countryHint(req)
    });
    if (queue.length >= 40) flush();
    else if (!flushTimer) flushTimer = setTimeout(flush, 4000).unref?.() || setTimeout(flush, 4000);
    if (flushTimer && typeof flushTimer.unref === 'function') flushTimer.unref();
  } catch { /* ölçüm kritik değil */ }
}

// ---- okuma: KPI'lar ----
const cache = new Map();
const CACHE_MS = 30_000;

function q(sql, ...args) { try { return db.prepare(sql).get(...args); } catch { return {}; } }
function all(sql, ...args) { try { return db.prepare(sql).all(...args); } catch { return []; } }

function kpis({ days = 30 } = {}) {
  ensureSchema();
  flush();
  days = Math.max(1, Math.min(180, Number(days) || 30));
  const key = `kpi:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const today = dayStr();
  const since = dayStr(days - 1);

  const visitors = (d) => (q(`SELECT COUNT(DISTINCT visitor_hash) c FROM page_views WHERE day=?`, d).c) || 0;
  const visitorsToday = visitors(today);
  const visitorsYesterday = visitors(dayStr(1));
  const mau = (q(`SELECT COUNT(DISTINCT visitor_hash) c FROM page_views WHERE day>=?`, dayStr(29)).c) || 0;
  const wau = (q(`SELECT COUNT(DISTINCT visitor_hash) c FROM page_views WHERE day>=?`, dayStr(6)).c) || 0;
  const viewsRange = (q(`SELECT COUNT(*) c FROM page_views WHERE day>=?`, since).c) || 0;
  const visitorsRange = (q(`SELECT COUNT(DISTINCT visitor_hash) c FROM page_views WHERE day>=?`, since).c) || 0;

  // Bugün gelenlerden ilk kez bugün gelenler = yeni ziyaretçi
  const newToday = (q(`SELECT COUNT(*) c FROM (
      SELECT visitor_hash, MIN(day) first_day FROM page_views GROUP BY visitor_hash
    ) WHERE first_day=?`, today).c) || 0;
  const returningToday = Math.max(0, visitorsToday - newToday);

  // Günlük seri
  const series = all(`SELECT day, COUNT(*) views, COUNT(DISTINCT visitor_hash) visitors FROM page_views
                      WHERE day>=? GROUP BY day ORDER BY day`, since);

  // Huni: ziyaretçi → oy veren → üye → ödeme yapan (hepsi kendi tablolarından)
  const votersRange = (q(`SELECT COUNT(DISTINCT COALESCE(session_id, id)) c FROM votes WHERE created_at >= datetime('now', ?)`, `-${days} days`).c) || 0;
  const signups = (q(`SELECT COUNT(*) c FROM users WHERE created_at >= datetime('now', ?)`, `-${days} days`).c) || 0;
  const buyers = (q(`SELECT COUNT(*) c FROM payments WHERE status IN ('paid','succeeded') AND created_at >= datetime('now', ?)`, `-${days} days`).c) || 0;
  const revenue = (q(`SELECT COALESCE(SUM(amount_usd),0) s FROM payments WHERE status IN ('paid','succeeded') AND created_at >= datetime('now', ?)`, `-${days} days`).s) || 0;

  // Viral katsayı: paylaşım → gelen ziyaretçi
  const sharesRange = (q(`SELECT COUNT(*) c FROM shares WHERE created_at >= datetime('now', ?)`, `-${days} days`).c) || 0;
  const shareVisitors = (q(`SELECT COUNT(DISTINCT visitor_hash) c FROM page_views
                            WHERE day>=? AND source IN ('social','referral')`, since).c) || 0;
  const kFactor = sharesRange ? Number((shareVisitors / sharesRange).toFixed(2)) : 0;

  // Tutundurma: 7-14 gün önce ilk kez gelenlerin ne kadarı sonradan döndü?
  function retention(gapDays) {
    const from = dayStr(gapDays + 7), to = dayStr(gapDays);
    const cohort = (q(`SELECT COUNT(*) c FROM (SELECT visitor_hash, MIN(day) first_day FROM page_views GROUP BY visitor_hash)
                       WHERE first_day BETWEEN ? AND ?`, from, to).c) || 0;
    if (!cohort) return 0;
    const returned = (q(`SELECT COUNT(DISTINCT p.visitor_hash) c FROM page_views p
                         JOIN (SELECT visitor_hash, MIN(day) first_day FROM page_views GROUP BY visitor_hash) f
                           ON f.visitor_hash = p.visitor_hash
                         WHERE f.first_day BETWEEN ? AND ? AND p.day > f.first_day`, from, to).c) || 0;
    return Number((returned / cohort * 100).toFixed(1));
  }

  const topPages = all(`SELECT path, COUNT(*) views, COUNT(DISTINCT visitor_hash) visitors
                        FROM page_views WHERE day>=? GROUP BY path ORDER BY views DESC LIMIT 12`, since);
  const sources = all(`SELECT COALESCE(source,'direct') source, COUNT(*) views, COUNT(DISTINCT visitor_hash) visitors
                       FROM page_views WHERE day>=? GROUP BY source ORDER BY views DESC`, since);
  const countries = all(`SELECT country, COUNT(DISTINCT visitor_hash) visitors FROM page_views
                         WHERE day>=? AND country IS NOT NULL GROUP BY country ORDER BY visitors DESC LIMIT 12`, since);
  const devices = all(`SELECT CASE WHEN instr(path,'?')>0 THEN substr(path,1,instr(path,'?')-1) ELSE path END p,
                              COUNT(DISTINCT visitor_hash) v FROM page_views WHERE day>=? GROUP BY p ORDER BY v DESC LIMIT 5`, since);

  const value = {
    days, today,
    visitors: { today: visitorsToday, yesterday: visitorsYesterday, week: wau, month: mau, range: visitorsRange },
    views: { today: (q(`SELECT COUNT(*) c FROM page_views WHERE day=?`, today).c) || 0, range: viewsRange },
    newVsReturning: { new: newToday, returning: returningToday, returnRate: visitorsToday ? Number((returningToday / visitorsToday * 100).toFixed(1)) : 0 },
    engagement: {
      viewsPerVisitor: visitorsRange ? Number((viewsRange / visitorsRange).toFixed(2)) : 0,
      votesPerVisitor: visitorsRange ? Number((votersRange / visitorsRange).toFixed(3)) : 0
    },
    funnel: { visitors: visitorsRange, voters: votersRange, signups, buyers },
    revenue: {
      total: Number(revenue.toFixed(2)),
      perVisitor: visitorsRange ? Number((revenue / visitorsRange).toFixed(4)) : 0,
      perBuyer: buyers ? Number((revenue / buyers).toFixed(2)) : 0,
      conversionBuyerPct: visitorsRange ? Number((buyers / visitorsRange * 100).toFixed(3)) : 0
    },
    viral: { shares: sharesRange, visitorsFromShares: shareVisitors, kFactor },
    retention: { day7: retention(0), day14: retention(7) },
    series, topPages, sources, countries,
    generatedAt: new Date().toISOString()
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

// Yeni olay yazıldığında önbelleği tazele (test ve panel tutarlılığı için).
function invalidate() { cache.clear(); }

// Bot trafiğini ayıkla (ölçümü şişirmesin).
const BOT_RE = /bot|crawl|spider|slurp|bingpreview|facebookexternalhit|whatsapp|telegrambot|headless|python-requests|curl|wget|monitor|uptime/i;
const isBot = req => BOT_RE.test(String(req.headers['user-agent'] || ''));

module.exports = { recordView, kpis, invalidate, isBot, ensureSchema, classifySource, countryHint };
