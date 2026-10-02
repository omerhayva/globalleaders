// Ziyaretçi kimliği — "sayfayı yenileyince yeniden oy verme" sorununu çözer.
//
// İki kavram var:
//   1) CİHAZ İMZASI (deviceSignature): oy limitlerinin dayandığı anahtar.
//      Sırasıyla şu kaynaklardan biri kullanılır:
//        • X-GL-Device başlığı  → tarayıcının ürettiği parmak izi (IP değişse,
//          çerez silinse bile aynı kalır; "mobil veriyi kapat/aç" hilesini bitirir)
//        • gl_device çerezi     → 2 yıl ömürlü rastgele cihaz kimliği
//        • IP + User-Agent      → son çare (JS kapalıysa)
//   2) OY HESABI (voteKey): oy bakiyesinin tutulduğu anahtar.
//        • Giriş yapılmışsa  → user-<id>  (satın alınan oylar cihaz değiştirse
//          de hesabı takip eder)
//        • Misafirse         → dev-<imza> (aynı cihaz, aynı bakiye)
const db = require('../db');
const { hash } = require('./fraud');

const DEVICE_COOKIE = 'gl_device';
const FINGERPRINT_RE = /^[A-Za-z0-9_-]{8,200}$/;
const DEVICE_COOKIE_RE = /^[a-f0-9]{32}$/;

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return req.ip || xff || (req.socket && req.socket.remoteAddress) || '0.0.0.0';
}

// /24 (IPv4) ya da ilk 64 bit (IPv6): tek IP döndüren saldırganlara karşı üst sınır.
function subnetOf(ip) {
  const s = String(ip || '');
  if (s.includes(':')) return s.split(':').slice(0, 4).join(':');
  const parts = s.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') + '.0/24' : s;
}

function deviceSignature(req) {
  const fp = String(req.headers['x-gl-device'] || '');
  if (FINGERPRINT_RE.test(fp)) return { sig: hash('fp:' + fp), source: 'fingerprint' };
  const ck = req.cookies && req.cookies[DEVICE_COOKIE];
  if (DEVICE_COOKIE_RE.test(String(ck || ''))) return { sig: hash('ck:' + ck), source: 'cookie' };
  return { sig: hash('ipua:' + clientIp(req) + '|' + String(req.headers['user-agent'] || '')), source: 'ip_ua' };
}

// Giriş yapmış kullanıcıyı oturumundan bulur (auth-api ile aynı kural).
function userForSession(sessionId) {
  return db.prepare(`SELECT u.* FROM users u JOIN vote_sessions vs ON vs.user_id=u.id
                     WHERE vs.session_id=? ORDER BY vs.created_at DESC LIMIT 1`).get(sessionId);
}

// İstek başına kimlik: oy bakiyesi ve oy kaydı bu anahtarla tutulur.
function resolveIdentity(req) {
  const device = deviceSignature(req);
  const cookieSession = req.sessionId || null;
  const user = cookieSession ? userForSession(cookieSession) : null;
  const voteKey = user ? `user-${user.id}` : `dev-${device.sig}`;
  return { device, user, voteKey, cookieSession, ip: clientIp(req), subnet: subnetOf(clientIp(req)) };
}

// Eski çerez oturumunda kalan satın alınmış bakiye yeni kimliğe aktarılır.
// (Kullanıcı giriş yaptığında ya da cihaz imzası devreye girdiğinde bir kez çalışır;
// tutarlar taşındıktan sonra kaynak satır sıfırlanır, böylece iki kez sayılmaz.)
function migrateBalance(fromSessionId, toSessionId) {
  if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) return 0;
  // Kullanılmış haklar da devralınır (MAX ile): kimlik değiştirmek bedava/ bonus
  // kotayı SIFIRLAMAZ, sadece satın alınmış bakiye eklenir.
  try {
    const day = new Date().toISOString().slice(0, 10);
    const src = db.prepare('SELECT * FROM vote_sessions WHERE session_id=? AND day=?').get(fromSessionId, day);
    if (src) {
      const dstId = `${toSessionId}:${day}`;
      const dst = db.prepare('SELECT * FROM vote_sessions WHERE id=?').get(dstId);
      if (dst) {
        // Sadece gerçekten artırılacak bir hak varsa yaz (her istekte boşa yazma yapma).
        const up = (v, d) => Math.max(v || 0, d || 0);
        if (up(src.free_used, dst.free_used) !== (dst.free_used || 0)
          || up(src.bonus_used, dst.bonus_used) !== (dst.bonus_used || 0)
          || up(src.bonus_earned, dst.bonus_earned) !== (dst.bonus_earned || 0)) {
          db.prepare(`UPDATE vote_sessions SET free_used=MAX(free_used,?), bonus_used=MAX(bonus_used,?),
                      bonus_earned=MAX(bonus_earned,?) WHERE id=?`)
            .run(src.free_used || 0, src.bonus_used || 0, src.bonus_earned || 0, dstId);
        }
      } else {
        db.prepare(`INSERT OR IGNORE INTO vote_sessions (id,session_id,day,free_used,bonus_used,bonus_earned)
                    VALUES (?,?,?,?,?,?)`).run(dstId, toSessionId, day, src.free_used || 0, src.bonus_used || 0, src.bonus_earned || 0);
      }
    }
  } catch { /* tablo henüz yoksa: yerel kurulumun ilk anı */ }
  const rows = db.prepare('SELECT * FROM vote_sessions WHERE session_id=? AND purchased > purchased_used').all(fromSessionId);
  let moved = 0;
  for (const row of rows) {
    const remaining = Math.max(0, (row.purchased || 0) - (row.purchased_used || 0));
    if (!remaining) continue;
    const targetId = `${toSessionId}:${row.day}`;
    const existing = db.prepare('SELECT * FROM vote_sessions WHERE id=?').get(targetId);
    if (existing) db.prepare('UPDATE vote_sessions SET purchased=purchased+? WHERE id=?').run(remaining, targetId);
    else db.prepare('INSERT INTO vote_sessions (id,session_id,day,purchased) VALUES (?,?,?,?)').run(targetId, toSessionId, row.day, remaining);
    db.prepare('UPDATE vote_sessions SET purchased=0, purchased_used=0 WHERE id=?').run(row.id);
    moved += remaining;
  }
  return moved;
}

module.exports = { resolveIdentity, deviceSignature, migrateBalance, subnetOf, userForSession, DEVICE_COOKIE, clientIp };
