#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Site bütünlüğü testleri (ağsız, geçici veritabanıyla):
//   • Lider sıraları (rank) boş kalmıyor → arayüzde "null" görünmüyor
//   • Aksansız arama: "erdogan" → "Recep Tayyip Erdoğan" (ı/ğ/ş katlama)
//   • /leaders?q= sayfası ve /api/leaderboard?q= filtresi
//   • Boş kurulumda sayfalar hata vermiyor (boş durum mesajları)
//   • og:image meta etiketi + PNG paylaşım kartı üretimi (sharp varsa)
//
// Çalıştırma: npm run test:site
// ---------------------------------------------------------------------------
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const tmpDb = path.join(os.tmpdir(), `gl-site-test-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.GL_DB_FILE = tmpDb;
process.env.NODE_ENV = 'test';
process.env.GL_ADMIN_SECRET = 'site-test-secret';
process.env.GL_ADMIN_PASSWORD = 'site-test-password';
process.env.PUBLIC_BASE_URL = 'https://globalleaders.test';
process.env.CRYPTO_WALLET_ADDRESS = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';

let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✔ ${name}`); } else { fail++; failures.push(name); console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); } };

const seed = require('../server/seed');
const db = require('../server/db');
const express = require('express');
const index = require('../server/index.js');

(async () => {
  // server/index.js dinlemeye başlar; portu log yerine env'den biliyoruz.
  const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`;
  await new Promise(r => setTimeout(r, 800));

  const get = async url => { const r = await fetch(BASE + url); const text = await r.text(); return { status: r.status, text, headers: r.headers }; };
  const json = async url => { const r = await fetch(BASE + url); return { status: r.status, body: await r.json().catch(() => null) }; };

  console.log('1) Lider sıraları ve arama altyapısı');
  const missingRanks = db.prepare('SELECT COUNT(*) c FROM leaders WHERE visible=1 AND rank IS NULL').get().c;
  ok('tüm liderlerin sırası dolu', missingRanks === 0, `${missingRanks} boş`);

  const leadersHtml = await get('/leaders');
  ok('/leaders 200', leadersHtml.status === 200);
  ok('sayfada "null" görünmüyor', !/data-roll>null/.test(leadersHtml.text) && !/>null</.test(leadersHtml.text));

  const missingSearch = db.prepare("SELECT COUNT(*) c FROM leaders WHERE name_search IS NULL OR name_search=''").get().c;
  ok('arama dizini (name_search) dolu', missingSearch === 0, `${missingSearch} boş`);

  const folded = await json('/api/leaderboard?limit=5&q=erdogan');
  ok('"erdogan" araması Erdoğan’ı buluyor', folded.body && folded.body.rows.some(r => /Erdoğan/.test(r.name)), JSON.stringify((folded.body || {}).rows || []).slice(0, 120));

  // Aksanlı/özel harfli isimler ASCII yazımla da bulunmalı (Sánchez, Wałęsa, Havel).
  for (const [term, expected] of [['sanchez', 'Sánchez'], ['walesa', 'Wałęsa'], ['havel', 'Havel'], ['ataturk', 'Atatürk']]) {
    const res = await json('/api/leaderboard?limit=5&q=' + term);
    ok(`"${term}" araması ${expected} buluyor`, res.body && res.body.rows.some(r => r.name.includes(expected)), `total=${res.body && res.body.total}`);
  }

  const noMatch = await json('/api/leaderboard?limit=5&q=zzzzqqq');
  ok('eşleşmeyen arama boş dönüyor', noMatch.body && noMatch.body.total === 0 && noMatch.body.rows.length === 0);

  const searchPage = await get('/leaders?q=erdogan');
  ok('arama sonuç sayfası çalışıyor', searchPage.status === 200 && /Erdoğan/.test(searchPage.text));
  const emptyPage = await get('/leaders?q=zzzzqqq');
  ok('boş sonuçta dostane mesaj', emptyPage.status === 200 && /No leader matches/.test(emptyPage.text));

  console.log('\n2) Ana sayfa ve boş durumlar');
  const home = await get('/');
  ok('/ 200', home.status === 200);
  ok('boş kurulumda "No votes yet today" mesajı', /No votes yet today/.test(home.text));
  ok('boş kurulumda "Voting opens the map" mesajı', /Voting opens the map/.test(home.text));
  ok('canonical + description var', /<link rel="canonical"/.test(home.text) && /<meta name="description"/.test(home.text));
  ok('robots.txt sitemap bildiriyor', /Sitemap: https:\/\/globalleaders\.live\/sitemap\.xml/.test((await get('/robots.txt')).text));
  const sitemap = await get('/sitemap.xml');
  ok('sitemap lider ve ülke sayfalarını içeriyor', sitemap.status === 200 && (sitemap.text.match(/<loc>/g) || []).length > 150);

  console.log('\n3) Paylaşım kartı (og:image)');
  const leaderPage = await get('/leader/recep-tayyip-erdogan');
  const ogImage = (leaderPage.text.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] || '';
  ok('og:image meta etiketi var', !!ogImage, ogImage);
  ok('twitter:card büyük görsel', /summary_large_image/.test(leaderPage.text));
  const graphics = require('../server/services/graphics-og');
  if (graphics.available()) {
    ok('og:image PNG’ye işaret ediyor', /\.png$/.test(ogImage), ogImage);
    const png = await fetch(BASE + `/og/leader/recep-tayyip-erdogan.png`);
    const buf = Buffer.from(await png.arrayBuffer());
    const dims = buf.length > 24 ? { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) } : null;
    ok('PNG kartı 1200×630 üretildi', png.status === 200 && dims && dims.w === 1200 && dims.h === 630, JSON.stringify(dims));
  } else {
    console.log('  ⚠ sharp kurulu değil — PNG kartı testi atlandı (SVG yedeği çalışıyor)');
    ok('og:image SVG yedeğine düşüyor', /\.svg$/.test(ogImage), ogImage);
  }

  console.log('\n4) Sayfa bütünlüğü (kırık bağlantı / eksik meta)');
  for (const url of ['/', '/leaders', '/history', '/countries', '/trending', '/about', '/legal', '/country/tr', '/country/tr/anthem']) {
    const res = await get(url);
    const problems = [];
    if (res.status !== 200) problems.push(`HTTP ${res.status}`);
    if (!/<title>[^<]{5,}/.test(res.text)) problems.push('başlık yok');
    if (!/<h1[ >]/.test(res.text)) problems.push('h1 yok');
    if (/data-roll>null/.test(res.text)) problems.push('null sıra');
    ok(`${url} sağlıklı`, problems.length === 0, problems.join(', '));
  }

  console.log('\n5) Üye kayıtları ve giriş kayıtları (admin)');
  {
    const adminLogin = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.GL_ADMIN_PASSWORD }) });
    const cookie = (adminLogin.headers.getSetCookie ? adminLogin.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    ok('admin girişi yapılabiliyor', adminLogin.status === 200, `HTTP ${adminLogin.status}`);
    // Önce bir kayıt ve bir de başarısız giriş üret (olay kaydı oluşsun).
    const reg = await fetch(BASE + '/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gl-session': 'f'.repeat(32), 'user-agent': 'SiteTest/1.0' }, body: JSON.stringify({ username: 'site_test_user', email: 'site-test@example.com', password: 'TestParola123!' }) });
    const emptyEmail = (await reg.json().catch(() => ({}))).error === 'email_delivery_not_configured';
    ok('e-posta sağlayıcısı yoksa kayıt net hata veriyor', reg.status === 503 && emptyEmail, `HTTP ${reg.status}`);
    const dbLocal = require('../server/db');
    const serviceAuth = require('../server/services/auth');
    dbLocal.prepare(`INSERT INTO users (email,username,password_hash,display_name,provider,email_verified_at,avatar_color) VALUES (?,?,?,?,?,datetime('now'),?)`)
      .run('site-test@example.com', 'site_test_user2', serviceAuth.hashPassword('TestParola123!'), 'Site Test', 'local', '#f5b524');
    await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gl-session': 'e'.repeat(32), 'user-agent': 'SiteTest/1.0' }, body: JSON.stringify({ identifier: 'site_test_user2', password: 'yanlis' }) });
    await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gl-session': 'e'.repeat(32), 'user-agent': 'SiteTest/1.0' }, body: JSON.stringify({ identifier: 'site_test_user2', password: 'TestParola123!' }) });

    const membersRes = await fetch(BASE + '/api/admin/members', { headers: { cookie } });
    const members = await membersRes.json().catch(() => ({}));
    ok('üye listesi ucu çalışıyor', membersRes.status === 200 && members.stats && Array.isArray(members.members), `HTTP ${membersRes.status}`);
    ok('üye listesinde kayıt görünüyor', (members.members || []).some(m => m.username === 'site_test_user2'), JSON.stringify(members.members || []).slice(0, 120));
    const loginsRes = await fetch(BASE + '/api/admin/logins', { headers: { cookie } });
    const logins = await loginsRes.json().catch(() => ({}));
    const kinds = new Set((logins.events || []).map(e => e.kind));
    ok('giriş kaydı ve başarısız giriş kaydı tutuluyor', kinds.has('login') && kinds.has('login_failed'), JSON.stringify(logins.counts || {}));
    const csv = await fetch(BASE + '/api/admin/members.csv', { headers: { cookie } });
    const csvText = await csv.text();
    ok('üyeler CSV olarak indirilebiliyor', csv.status === 200 && csvText.includes('site_test_user2') && csvText.includes('email'), `HTTP ${csv.status}`);
  }

  console.log('\n6) Google ile giriş (uçtan uca, sahte Google sunucusuyla)');
  {
    const http = require('http');
    // 1) Anahtar yokken: düğme hiç görünmez, başlatma ucu net hata verir.
    const provOff = await json('/api/auth/providers');
    ok('Google kapalıyken sağlayıcı listesi enabled=false', provOff.body && provOff.body.google && provOff.body.google.enabled === false, JSON.stringify(provOff.body));
    const startOff = await fetch(BASE + '/api/auth/google/start');
    ok('anahtar yokken başlatma ucu 503 döner', startOff.status === 503, `HTTP ${startOff.status}`);

    // 2) Sahte Google sunucusu: authorize → token → userinfo
    let seenTokenBody = null;
    let fakeProfile = { sub: '109876543210987654321', email: 'google.user@example.com', email_verified: true, name: 'Google Kullanıcı', picture: 'https://lh3.googleusercontent.com/fake.png' };
    const fake = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname === '/authorize') {
        const redirect = u.searchParams.get('redirect_uri');
        const state = u.searchParams.get('state');
        if (u.searchParams.get('client_id') !== 'test-client-id') { res.statusCode = 400; return res.end('bad client'); }
        res.writeHead(302, { Location: `${redirect}?code=FAKE-CODE-123&state=${encodeURIComponent(state)}` }).end();
        return;
      }
      if (u.pathname === '/token') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
          seenTokenBody = new URLSearchParams(body);
          res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'fake-access-token', token_type: 'Bearer', expires_in: 3600 }));
        });
        return;
      }
      if (u.pathname === '/userinfo') {
        if (String(req.headers.authorization) !== 'Bearer fake-access-token') { res.statusCode = 401; return res.end('{}'); }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(fakeProfile));
        return;
      }
      res.statusCode = 404; res.end();
    });
    await new Promise(r => fake.listen(0, '127.0.0.1', r));
    const fakeBase = `http://127.0.0.1:${fake.address().port}`;
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_AUTH_URL = fakeBase + '/authorize';
    process.env.GOOGLE_TOKEN_URL = fakeBase + '/token';
    process.env.GOOGLE_USERINFO_URL = fakeBase + '/userinfo';
    process.env.GOOGLE_REDIRECT_URI = BASE + '/api/auth/google/callback';

    const provOn = await json('/api/auth/providers');
    ok('anahtarlar girilince enabled=true', provOn.body && provOn.body.google.enabled === true, JSON.stringify(provOn.body));

    // 3) Başlat: state çerezi + Google'a yönlendirme
    const start = await fetch(BASE + '/api/auth/google/start?next=%2Fleaders', { redirect: 'manual' });
    const startCookie = (start.headers.getSetCookie ? start.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    const authLoc = start.headers.get('location') || '';
    const authParams = new URL(authLoc).searchParams;
    ok('başlatma Google yetkilendirmeye yönlendiriyor', start.status === 302 && authLoc.startsWith(fakeBase + '/authorize'), authLoc.slice(0, 90));
    ok('yetkilendirme parametreleri doğru', authParams.get('client_id') === 'test-client-id' && authParams.get('response_type') === 'code' && /email/.test(authParams.get('scope') || '') && !!authParams.get('state'), JSON.stringify(Object.fromEntries(authParams)));
    ok('CSRF için state çerezi veriliyor', /gl_oauth_state=/.test(startCookie), startCookie.slice(0, 60));

    // 4) Sahte Google onayı → bizim callback → kullanıcı oluşur ve siteye döner
    const approve = await fetch(authLoc, { redirect: 'manual' });
    const cbLoc = approve.headers.get('location') || '';
    ok('Google onayı callback adresimize dönüyor', approve.status === 302 && cbLoc.startsWith(BASE + '/api/auth/google/callback'), cbLoc.slice(0, 90));
    const done = await fetch(cbLoc, { headers: { cookie: startCookie }, redirect: 'manual' });
    ok('callback başarıyla /leaders?signed_in=1 adresine döner', done.status === 302 && /\/leaders\?signed_in=1$/.test(done.headers.get('location') || ''), String(done.headers.get('location')));
    ok('token takası istemci sırrını ve doğru redirect_uri gönderiyor', seenTokenBody && seenTokenBody.get('client_secret') === 'test-client-secret' && seenTokenBody.get('code') === 'FAKE-CODE-123' && seenTokenBody.get('redirect_uri') === BASE + '/api/auth/google/callback', JSON.stringify(seenTokenBody && Object.fromEntries(seenTokenBody)));

    const meCookie = (done.headers.getSetCookie ? done.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ') || startCookie;
    const me = await fetch(BASE + '/api/auth/me', { headers: { cookie: startCookie } });
    const meBody = await me.json().catch(() => ({}));
    ok('Google kullanıcısı oturum açmış görünüyor', meBody.user && meBody.user.email === 'google.user@example.com', JSON.stringify(meBody).slice(0, 120));
    ok('profil fotoğrafı ve sağlayıcı bilgisi geliyor', meBody.user && meBody.user.provider === 'google' && /lh3\.googleusercontent\.com/.test(meBody.user.avatar || ''), JSON.stringify(meBody.user || {}).slice(0, 120));

    const dbLocal2 = require('../server/db');
    const row = dbLocal2.prepare('SELECT * FROM users WHERE google_sub=?').get('109876543210987654321');
    ok('üye kaydı Google kimliğiyle veritabanında', !!row && row.provider === 'google' && !!row.email_verified_at && !!row.username, JSON.stringify(row ? { u: row.username, p: row.provider } : null));
    const ev = dbLocal2.prepare(`SELECT * FROM login_events WHERE kind='login_google' ORDER BY id DESC LIMIT 1`).get();
    ok('giriş olayı kaydedildi (login_google)', !!ev && ev.identifier === 'google.user@example.com', JSON.stringify(ev || null));

    // 5) Güvenlik: state uyuşmazsa giriş yapılmaz
    const badState = await fetch(BASE + `/api/auth/google/callback?code=FAKE-CODE-123&state=0000000000000000000000000000000000000000000000`, { headers: { cookie: startCookie }, redirect: 'manual' });
    ok('yanlış state reddedilir (CSRF koruması)', /google_error=state/.test(badState.headers.get('location') || ''), String(badState.headers.get('location')));

    // 6) Mevcut (şifreli) hesapla birleştirme: aynı e-posta ile Google girişi
    const dbLocal3 = require('../server/db');
    const serviceAuth2 = require('../server/services/auth');
    dbLocal3.prepare(`INSERT INTO users (email,username,password_hash,display_name,provider,email_verified_at,avatar_color) VALUES (?,?,?,?,?,datetime('now'),?)`)
      .run('linked@example.com', 'linked_user', serviceAuth2.hashPassword('Parola1234!'), 'Linked User', 'local', '#34d399');
    const beforeCount = dbLocal3.prepare('SELECT COUNT(*) c FROM users').get().c;
    fakeProfile = { sub: '555000111222333', email: 'linked@example.com', email_verified: true, name: 'Linked User', picture: 'https://lh3.googleusercontent.com/linked.png' };
    const s2 = await fetch(BASE + '/api/auth/google/start', { redirect: 'manual' });
    const c2 = (s2.headers.getSetCookie ? s2.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    const a2 = await fetch(s2.headers.get('location'), { redirect: 'manual' });
    const d2 = await fetch(a2.headers.get('location'), { headers: { cookie: c2 }, redirect: 'manual' });
    const afterCount = dbLocal3.prepare('SELECT COUNT(*) c FROM users').get().c;
    ok('aynı e-posta ile Google girişi YENİ üye açmıyor (hesap birleşir)', afterCount === beforeCount, `${beforeCount} → ${afterCount}`);
    const linked = dbLocal3.prepare('SELECT * FROM users WHERE email=?').get('linked@example.com');
    ok('mevcut hesaba Google kimliği bağlandı', !!linked && linked.google_sub === '555000111222333' && !!linked.password_hash, JSON.stringify(linked ? { sub: linked.google_sub, pw: !!linked.password_hash } : null));
    ok('birleşen hesap Google ile giriş yapabiliyor', d2.status === 302 && /signed_in=1/.test(d2.headers.get('location') || ''), String(d2.headers.get('location')));
    const pwLogin = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-gl-session': 'd'.repeat(32) }, body: JSON.stringify({ identifier: 'linked_user', password: 'Parola1234!' }) });
    ok('birleşme sonrası şifreyle giriş bozulmuyor', pwLogin.status === 200, `HTTP ${pwLogin.status}`);

    await new Promise(r => fake.close(r));
    delete process.env.GOOGLE_CLIENT_ID; delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_AUTH_URL; delete process.env.GOOGLE_TOKEN_URL; delete process.env.GOOGLE_USERINFO_URL;
    delete process.env.GOOGLE_REDIRECT_URI;
  }

  console.log('\n7) Trafik ölçümü (analytics + KPI)');
  {
    // Birkaç sayfa gezisi + arama motorundan geliş + bot isteği
    const ua = 'RealVisitor/1.0 (TestTarayici)';
    for (const [path, ref] of [['/', 'https://www.google.com/search?q=global+leaders'], ['/leaders', BASE + '/'], ['/trending', 'https://x.com/somebody/status/1']]) {
      await fetch(BASE + path, { headers: { 'user-agent': ua, 'accept-language': 'tr-TR,tr;q=0.9', ...(ref ? { referer: ref } : {}) } });
    }
    await fetch(BASE + '/api/stats', { headers: { 'user-agent': ua } });
    await new Promise(r => setTimeout(r, 300));
    // Bot filtresi: Googlebot isteği ölçüme HİÇ girmemeli.
    const analyticsSvc = require('../server/services/analytics');
    const dbA = require('../server/db');
    analyticsSvc.ensureSchema();
    const countViews = () => dbA.prepare('SELECT COUNT(*) c FROM page_views').get().c;
    const before = countViews();
    await fetch(BASE + '/leaders', { headers: { 'user-agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' } });
    await fetch(BASE + '/trending', { headers: { 'user-agent': 'curl/8.5.0' } });
    await new Promise(r => setTimeout(r, 200));
    ok('bot istekleri ölçüme girmiyor', countViews() === before, `${before} → ${countViews()}`);
    ok('bot tanıma doğru çalışıyor', analyticsSvc.isBot({ headers: { 'user-agent': 'Googlebot/2.1' } }) === true && analyticsSvc.isBot({ headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } }) === false);

    const adminLogin2 = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.GL_ADMIN_PASSWORD }) });
    const adminCookie = (adminLogin2.headers.getSetCookie ? adminLogin2.headers.getSetCookie() : []).map(c => c.split(';')[0]).join('; ');
    const an = await fetch(BASE + '/api/admin/analytics?days=30', { headers: { cookie: adminCookie } });
    const a = await an.json().catch(() => ({}));
    ok('analytics ucu çalışıyor', an.status === 200 && !!a.visitors, `HTTP ${an.status}`);
    ok('ziyaretçi sayılıyor', a.visitors && a.visitors.today >= 1, JSON.stringify(a.visitors));
    ok('sayfa görüntülemesi kaydediliyor', a.views && a.views.today >= 3, JSON.stringify(a.views));
    ok('trafik kaynağı sınıflandırılıyor (arama/sosyal/iç)', Array.isArray(a.sources) && ['search', 'social', 'internal'].every(k => a.sources.some(x => x.source === k)), JSON.stringify(a.sources));
    ok('ülke tahmini kaydediliyor (TR)', (a.countries || []).some(c => c.country === 'TR'), JSON.stringify(a.countries));
    ok('huni ve gelir metrikleri var', !!a.funnel && !!a.revenue && typeof a.engagement.votesPerVisitor === 'number', JSON.stringify(a.funnel));
    ok('viral katsayı ve tutundurma hesaplanıyor', typeof a.viral.kFactor === 'number' && typeof a.retention.day7 === 'number', JSON.stringify(a.viral));
    const rawIpStored = require('../server/db').prepare(`SELECT COUNT(*) c FROM pragma_table_info('page_views') WHERE name LIKE '%ip%'`).get().c;
    ok('ham IP saklanmıyor (KVKK/GDPR)', rawIpStored === 0, `ip kolonu: ${rawIpStored}`);
  }

  try { fs.unlinkSync(tmpDb); } catch { }
  console.log(`\n${fail === 0 ? '✅' : '❌'} site: ${pass} geçti, ${fail} başarısız`);
  if (fail) { console.log('Başarısızlar: ' + failures.join(', ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('test crashed:', e); process.exit(1); });
