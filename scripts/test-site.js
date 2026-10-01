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

  try { fs.unlinkSync(tmpDb); } catch { }
  console.log(`\n${fail === 0 ? '✅' : '❌'} site: ${pass} geçti, ${fail} başarısız`);
  if (fail) { console.log('Başarısızlar: ' + failures.join(', ')); process.exit(1); }
  process.exit(0);
})().catch(e => { console.error('test crashed:', e); process.exit(1); });
