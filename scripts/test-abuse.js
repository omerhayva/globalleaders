#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Oy kötüye kullanım testleri (ağsız, geçici veritabanıyla):
//   • Sayfa yenileme / çerez silme / User-Agent değiştirme / IP değiştirme
//     (mobil veri aç-kapa) AYNI cihaza ek bedava oy KAZANDIRMIYOR
//   • Gerçekten başka cihaz oy verebiliyor (yanlış pozitif yok)
//   • Satın alınan oylar gün geçse de, cihaz değişse de duruyor
//   • Giriş yapınca cihazdaki bakiye hesaba geçiyor
//   • Aynı /24 ağdan günde en fazla FREE_VOTES_PER_SUBNET_PER_DAY bedava oy
//
// Çalıştırma: npm run test:abuse
// ---------------------------------------------------------------------------
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const tmpDb = path.join(os.tmpdir(), `gl-abuse-test-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.GL_DB_FILE = tmpDb;
process.env.NODE_ENV = 'test';
process.env.PORT = process.env.GL_ABUSE_PORT || '3401';
process.env.GL_ADMIN_SECRET = 'abuse-test-secret';
process.env.GL_ADMIN_PASSWORD = 'abuse-test-password';
process.env.PUBLIC_BASE_URL = 'https://globalleaders.test';
process.env.FREE_VOTES_PER_SUBNET_PER_DAY = '2'; // sınırı testte görünür kılmak için

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✔ ${name}`); } else { fail++; failures.push(name); console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); } };

require('../server/index.js');

const BASE = `http://127.0.0.1:${process.env.PORT}`;
const day = new Date().toISOString().slice(0, 10);
const FP = (n) => crypto.createHash('sha1').update('fp:' + n).digest('hex'); // 40→32 karakter
const SID = (n) => crypto.createHash('sha1').update('sid:' + n).digest('hex').slice(0, 32); // oturum: 32 hex
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const GAP = 1400; // sunucudaki 1200 ms'lik oy aralığı kuralından büyük olmalı

let keyN = 0;
async function vote({ sid, fp, ua = 'TestBrowser/1.0', ip, cookie }) {
  const headers = { 'Content-Type': 'application/json', 'user-agent': ua, 'Idempotency-Key': `abuse-test-${++keyN}-0123456789` };
  if (sid) headers['x-gl-session'] = sid;
  if (fp) headers['x-gl-device'] = fp;
  if (ip) headers['x-forwarded-for'] = ip;
  if (cookie) headers.cookie = cookie;
  const r = await fetch(`${BASE}/api/vote`, { method: 'POST', headers, body: JSON.stringify({ slug: 'nelson-mandela', count: 1 }) });
  return { status: r.status, body: await r.json().catch(() => null), setCookie: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
}
async function session({ sid, fp, ua = 'TestBrowser/1.0', cookie }) {
  const headers = {};
  if (sid) headers['x-gl-session'] = sid;
  if (fp) headers['x-gl-device'] = fp;
  if (ua) headers['user-agent'] = ua;
  if (cookie) headers.cookie = cookie;
  const r = await fetch(`${BASE}/api/session`, { headers });
  return { status: r.status, body: await r.json().catch(() => null), setCookie: r.headers.getSetCookie ? r.headers.getSetCookie() : [] };
}

// Sunucunun tohumlaması + dinlemeye başlaması için kısa bekleme
(async () => {
  await sleep(900);

  console.log('\n1) Sayfa yenileme / cihaz taklidi denemeleri');
  const A1 = await vote({ sid: SID('a'), fp: FP('a'), ip: '198.51.100.10' });
  ok('ilk ziyaretçi oy verebiliyor', A1.body && A1.body.ok === true, JSON.stringify(A1.body));
  await sleep(GAP);

  const A2 = await vote({ sid: SID('b'), fp: FP('a'), ip: '198.51.100.10' });
  ok('sayfayı yenileyen (yeni oturum, aynı cihaz) tekrar oy veremiyor', A2.body?.error === 'no_votes_left', JSON.stringify(A2.body));
  await sleep(GAP);

  const A3 = await vote({ sid: SID('c'), fp: FP('a'), ua: 'OtherBrowser/9.9', ip: '198.51.100.10' });
  ok('tarayıcı kimliği (UA) değiştirmek oy kazandırmıyor', A3.body?.error === 'no_votes_left', JSON.stringify(A3.body));
  await sleep(GAP);

  const A4 = await vote({ sid: SID('d'), fp: FP('a'), ua: 'OtherBrowser/9.9', ip: '88.241.77.9' });
  ok('IP değiştirmek (mobil veri aç-kapa) oy kazandırmıyor', A4.body?.error === 'no_votes_left', JSON.stringify(A4.body));
  await sleep(GAP);

  const A5 = await vote({ sid: SID('e'), fp: FP('b'), ip: '78.180.22.9' });
  ok('gerçekten başka cihaz oy verebiliyor', A5.body && A5.body.ok === true, JSON.stringify(A5.body));
  await sleep(GAP);

  console.log('\n2) Çerez tabanlı cihaz kimliği (parmak izi gönderilemeyen tarayıcı)');
  const C1 = await session({ ua: 'CookieOnly/1.0', sid: SID('f') });
  const cookie = (C1.setCookie || []).find(c => c.startsWith('gl_device='));
  ok('sunucu gl_device çerezi veriyor', !!cookie, JSON.stringify(C1.setCookie));
  const devCookie = cookie ? cookie.split(';')[0] : '';
  const C2 = await vote({ sid: SID('f'), ua: 'CookieOnly/1.0', ip: '203.0.113.5', cookie: devCookie });
  ok('çerezli ziyaretçi oy verebiliyor', C2.body && C2.body.ok === true, JSON.stringify(C2.body));
  await sleep(GAP);
  const C3 = await vote({ sid: SID('g'), ua: 'CookieOnly/2.0', ip: '203.0.113.99', cookie: devCookie });
  ok('çerez + UA + oturum değişse de ek oy yok', C3.body?.error === 'no_votes_left', JSON.stringify(C3.body));
  await sleep(GAP);

  console.log('\n3) Alt ağ (IP bloğu) günlük sınırı');
  const S1 = await vote({ sid: SID('h'), fp: FP('c'), ip: '192.0.2.11' });
  ok('aynı ağdan 1. cihaz oy verebiliyor', S1.body && S1.body.ok === true, JSON.stringify(S1.body));
  await sleep(GAP);
  const S2 = await vote({ sid: SID('i'), fp: FP('d'), ip: '192.0.2.12' });
  ok('aynı ağdan 2. cihaz oy verebiliyor (sınır 2)', S2.body && S2.body.ok === true, JSON.stringify(S2.body));
  await sleep(GAP);
  const S3 = await vote({ sid: SID('j'), fp: FP('e'), ip: '192.0.2.13' });
  ok('aynı ağdan 3. cihaz günlük sınıra takılıyor', S3.body?.error === 'daily_cap', JSON.stringify(S3.body));
  await sleep(GAP);
  const S4 = await vote({ sid: SID('k'), fp: FP('f'), ip: '192.0.3.13' });
  ok('farklı ağdan cihaz oy verebiliyor (yanlış pozitif yok)', S4.body && S4.body.ok === true, JSON.stringify(S4.body));
  await sleep(GAP);

  console.log('\n4) Satın alınan oylar kalıcı');
  const db = require('../server/db');
  const { hash } = require('../server/services/fraud');
  const paidKey = `dev-${hash('fp:' + FP('9'))}`;
  db.prepare('INSERT OR REPLACE INTO vote_sessions (id,session_id,day,purchased,purchased_used) VALUES (?,?,?,?,?)')
    .run(`${paidKey}:2020-01-01`, paidKey, '2020-01-01', 5, 1); // dün 4 oy kaldı
  const P1 = await session({ sid: SID('l'), fp: FP('9'), ua: 'Paid/1.0' });
  ok('satın alınan bakiye ertesi gün devrediyor', P1.body?.purchased === 4, JSON.stringify(P1.body));
  const P2 = await vote({ sid: SID('l'), fp: FP('9'), ua: 'Paid/1.0', ip: '198.18.0.5' });
  ok('bedava oy kullanıldı, 4 satın alınmış oy duruyor', P2.body && P2.body.ok === true && P2.body.remaining === 4 && P2.body.purchased_used === 0, JSON.stringify(P2.body));
  await sleep(GAP);
  const P3 = await vote({ sid: SID('l'), fp: FP('9'), ua: 'Paid/1.0', ip: '198.18.0.5' });
  ok('satın alınmış oy gerçekten harcanıyor (remaining 3)', P3.body && P3.body.ok === true && P3.body.remaining === 3 && P3.body.purchased_used === 1, JSON.stringify(P3.body));
  const src = db.prepare('SELECT purchased,purchased_used FROM vote_sessions WHERE id=?').get(`${paidKey}:2020-01-01`);
  ok('devredilen eski gün sıfırlandı (çift sayım yok)', src && src.purchased === 0 && src.purchased_used === 0, JSON.stringify(src));
  console.log('\n5) Giriş yapınca bakiye hesaba geçiyor');
  const userKey = `dev-${hash('fp:' + FP('z'))}`;
  db.prepare('INSERT OR REPLACE INTO vote_sessions (id,session_id,day,purchased) VALUES (?,?,?,?)')
    .run(`${userKey}:${day}`, userKey, day, 3);
  const auth = require('../server/services/auth');
  db.prepare(`INSERT INTO users (email,username,password_hash,display_name,provider,email_verified_at,avatar_color)
              VALUES (?,?,?,?,?,datetime('now'),?)`)
    .run('abuse@test.local', 'abuse_user', auth.hashPassword('TestParola123!'), 'Test', 'local', '#f5b524');
  const loginSid = SID('m');
  const L1 = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-gl-session': loginSid, 'x-gl-device': FP('z'), 'user-agent': 'Paid/1.0' },
    body: JSON.stringify({ identifier: 'abuse_user', password: 'TestParola123!' })
  });
  ok('giriş yapılabiliyor', L1.status === 200, `HTTP ${L1.status}`);
  const L2 = await session({ sid: loginSid, fp: FP('z') });
  ok('giriş sonrası cihazdaki 3 oy hesapta görünüyor', L2.body?.signedIn === true && L2.body?.purchased === 3, JSON.stringify(L2.body));
  const L3 = await session({ sid: loginSid, fp: FP('y') }); // başka cihaz, aynı hesap
  ok('başka cihazdan girince oylar hesabı takip ediyor', L3.body?.purchased === 3, JSON.stringify(L3.body));

  console.log(`\nSonuç: ${pass} geçti, ${fail} başarısız`);
  if (fail) { console.log('Başarısızlar:'); failures.forEach(f => console.log('  - ' + f)); }
  try { require('fs').rmSync(tmpDb, { force: true }); } catch { }
  process.exit(fail ? 1 : 0);
})();
