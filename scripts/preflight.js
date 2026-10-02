// ============================================================================
// GLOBAL LEADERS LIVE — yayın öncesi kontrol (preflight)
//
//   npm run preflight            # .env dosyasını okur, canlıya çıkmadan kontrol eder
//
// Amaç: "yayına aldım ama kripto/kart çalışmıyor" sürprizini önlemek.
// Zorunlu bir değer eksikse çıkış kodu 1 olur; uyarılar çıkış kodunu değiştirmez.
// ============================================================================
const fs = require('fs');
const path = require('path');
const envFile = require('../server/env');

const env = envFile.loadEnv();
const get = (k) => String(process.env[k] === undefined ? '' : process.env[k]).trim();

const results = [];
const fail = (name, msg) => results.push({ level: 'FAIL', name, msg });
const warn = (name, msg) => results.push({ level: 'WARN', name, msg });
const pass = (name, msg) => results.push({ level: 'PASS', name, msg: msg || '' });

const isPlaceholder = (v) => /replace-with|changeme|your-|xxx+/i.test(v);

// .env yoksa ama değerler gerçek ortam değişkeni olarak geliyorsa sorun değil
// (Docker compose `env_file`/`environment`, systemd, PM2 böyle çalışır).
if (env.missing && get('GL_ADMIN_SECRET')) warn('.env dosyası', 'Yok — değerler ortam değişkenlerinden geliyor (Docker/systemd). Yerel kurulumda `cp .env.example .env`.');
else if (env.missing) fail('.env dosyası', 'Bulunamadı — `cp .env.example .env` ile oluşturup doldurun.');
else pass('.env dosyası', `${env.loaded} değer yüklendi (${path.relative(process.cwd(), env.file)})`);

// ---- 1) Temel ----
get('NODE_ENV') === 'production' ? pass('NODE_ENV', 'production') : warn('NODE_ENV', `"${get('NODE_ENV') || '(boş)'}" — canlıda production olmalı (demo/hata detayları sızabilir).`);

const base = get('PUBLIC_BASE_URL');
if (!base) fail('PUBLIC_BASE_URL', 'Boş. Ödeme dönüş bağlantıları ve paylaşım kartları bu adrese göre üretilir.');
else if (!/^https:\/\//i.test(base)) fail('PUBLIC_BASE_URL', `"${base}" — HTTPS olmalı (http:// ödeme webhook ve çerez güvenliği için yanlış).`);
else if (/localhost|127\.0\.0\.1/i.test(base)) fail('PUBLIC_BASE_URL', `"${base}" — canlıda alan adınız olmalı.`);
else pass('PUBLIC_BASE_URL', base);

// ---- 2) Yönetici ve güvenlik sırları ----
const secrets = [
  ['GL_ADMIN_PASSWORD', 12, 'Panel girişi'],
  ['GL_ADMIN_SECRET', 32, 'Panel API imzası'],
  ['GL_FRAUD_SALT', 32, 'Oy sahteciliği tuzu (değiştirilirse eski cihaz kimlikleri sıfırlanır)']
];
for (const [key, min, desc] of secrets) {
  const v = get(key);
  if (!v) fail(key, `Boş — ${desc} için zorunlu. Üret: openssl rand -hex 32`);
  else if (isPlaceholder(v)) fail(key, 'Örnek/placeholder değer duruyor. Gerçek rastgele değerle değiştirin.');
  else if (v.length < min) fail(key, `Çok kısa (${v.length} karakter) — en az ${min} olmalı.`);
  else pass(key, `${v.length} karakter`);
}

// ---- 3) Kripto (tek seferlik paketler) ----
const wallet = get('CRYPTO_WALLET_ADDRESS');
if (!wallet) warn('CRYPTO_WALLET_ADDRESS', 'Boş — kripto ödeme seçeneği görünmeyecek.');
else if (isPlaceholder(wallet)) fail('CRYPTO_WALLET_ADDRESS', 'Hâlâ örnek adres. Kendi herkese açık USDT (TRC20) adresinizi yazın.');
else if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(wallet)) fail('CRYPTO_WALLET_ADDRESS', `"${wallet}" geçerli bir TRON (TRC20) adresi değil.`);
else pass('CRYPTO_WALLET_ADDRESS', `${wallet.slice(0, 6)}…${wallet.slice(-4)} (yalnızca genel adres — seed/private key asla)`);

get('CRYPTO_ASSET').toUpperCase() === 'USDT' ? pass('CRYPTO_ASSET', 'USDT') : warn('CRYPTO_ASSET', `"${get('CRYPTO_ASSET')}" — ilk sürüm yalnızca USDT destekliyor.`);
get('AUTO_ONCHAIN_VERIFY') === '1' ? pass('AUTO_ONCHAIN_VERIFY', 'Zincir doğrulaması açık') : warn('AUTO_ONCHAIN_VERIFY', 'Kapalı — ödemeler yalnızca elle onaylanır (yoğun trafikte gecikme).');
if (!get('TRON_API_KEY')) warn('TRON_API_KEY', 'Boş — TronGrid hız limitine takılabilirsiniz (ücretsiz anahtar: trongrid.io).');

// ---- 4) Kart + abonelik (yinelenen gelir) ----
const sk = get('STRIPE_SECRET_KEY');
if (!sk) warn('STRIPE_SECRET_KEY', 'Boş — kart ve Supporter aboneliği kapalı kalır (kripto çalışmaya devam eder).');
else if (isPlaceholder(sk)) fail('STRIPE_SECRET_KEY', 'Placeholder duruyor.');
else if (/^sk_live_/.test(sk)) pass('STRIPE_SECRET_KEY', 'Canlı anahtar (sk_live_…)');
else warn('STRIPE_SECRET_KEY', 'Test anahtarı (sk_test_…) — canlıda gerçek tahsilat yapılmaz.');

const whsec = get('STRIPE_WEBHOOK_SECRET');
if (!sk) { /* kart kapalıysa webhook da gerekmez */ }
else if (!whsec) fail('STRIPE_WEBHOOK_SECRET', 'Kart açık ama webhook sırrı yok — para alınsa da satın alma otomatik aktifleşmez.');
else if (/^whsec_/.test(whsec)) pass('STRIPE_WEBHOOK_SECRET', 'Tanımlı (whsec_…)');
else warn('STRIPE_WEBHOOK_SECRET', 'whsec_ ile başlamıyor — Stripe panelinden aldığınız değeri kontrol edin.');

const price = Number(get('SUPPORTER_PRICE_USD') || 4.99);
const bonus = Number(get('SUPPORTER_BONUS_VOTES') || 4);
price > 0 ? pass('SUPPORTER_PRICE_USD', `$${price.toFixed(2)}/ay`) : fail('SUPPORTER_PRICE_USD', 'Sıfır veya geçersiz.');
bonus >= 0 ? pass('SUPPORTER_BONUS_VOTES', `+${bonus} günlük oy`) : fail('SUPPORTER_BONUS_VOTES', 'Negatif olamaz.');

// ---- 5) E-posta ve Google girişi ----
if (!get('RESEND_API_KEY')) warn('RESEND_API_KEY', 'Boş — doğrulama/e-posta gönderimi yapılmaz.');
const gid = get('GOOGLE_CLIENT_ID'), gsec = get('GOOGLE_CLIENT_SECRET');
if (gid && !gsec) fail('GOOGLE_CLIENT_SECRET', 'CLIENT_ID var, SECRET yok — Google girişi çalışmaz.');
else if (!gid && gsec) fail('GOOGLE_CLIENT_ID', 'SECRET var, CLIENT_ID yok — Google girişi çalışmaz.');
else if (gid && gsec) pass('Google girişi', 'Yapılandırılmış');
else warn('Google girişi', 'Kapalı — sorun değil, e-posta/parola ile giriş çalışır.');

// ---- 6) Veritabanı ve yazılabilir klasörler ----
const dbFile = get('GL_DB_FILE') || path.join(process.cwd(), 'data', 'globalleaders.db');
try {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  fs.accessSync(path.dirname(dbFile), fs.constants.W_OK);
  pass('Veritabanı klasörü', `${path.dirname(dbFile)} yazılabilir`);
} catch (e) { fail('Veritabanı klasörü', `${path.dirname(dbFile)} yazılamıyor: ${e.message}`); }
for (const dir of ['public/uploads', 'var']) {
  try { fs.mkdirSync(dir, { recursive: true }); fs.accessSync(dir, fs.constants.W_OK); pass(`${dir}/`, 'yazılabilir'); }
  catch (e) { fail(`${dir}/`, `yazılamıyor: ${e.message} (reklam görselleri/oturum verisi kaydedilemez)`); }
}

// ---- 7) Derlenmiş arayüz güncel mi? (eski paket canlıya gitmesin) ----
const bundle = path.join('public', 'js', 'react-app.js');
const sources = ['client/ui/modals.jsx', 'client/ui/HeaderActions.jsx', 'client/index.jsx'];
try {
  const bTime = fs.statSync(bundle).mtimeMs;
  const stale = sources.filter((f) => fs.existsSync(f) && fs.statSync(f).mtimeMs > bTime + 1000);
  if (stale.length) fail('react-app.js', `Paket eskimiş görünüyor (kaynak daha yeni: ${stale.join(', ')}). "npm run build:react" çalıştırın.`);
  else pass('react-app.js', 'Derlenmiş paket güncel');
} catch { fail('react-app.js', 'Derlenmiş paket yok — "npm run build:react" çalıştırın.'); }

// ---- Rapor ----
const icon = { FAIL: '❌', WARN: '⚠️ ', PASS: '✔' };
console.log('\n═══════ YAYIN ÖNCESİ KONTROL ═══════\n');
for (const r of results) console.log(`${icon[r.level]} ${r.name}${r.msg ? ' — ' + r.msg : ''}`);
const fails = results.filter((r) => r.level === 'FAIL').length;
const warns = results.filter((r) => r.level === 'WARN').length;
console.log(`\nZorunlu eksik: ${fails} · Uyarı: ${warns}`);
if (fails) { console.log('\n❌ Yayına çıkmadan önce yukarıdaki zorunlu maddeleri tamamlayın.'); process.exit(1); }
console.log(warns ? '\n✅ Zorunlu maddeler tamam. Uyarıları gözden geçirip yayına alabilirsiniz.' : '\n✅ Her şey hazır — yayına alabilirsiniz.');
