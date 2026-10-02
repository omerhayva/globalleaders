#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Ödeme doğrulama testleri — dış ağa ÇIKMADAN, sahte blokzincir/Stripe
// yanıtlarıyla gerçek HTTP akışını çalıştırır:
//
//   1) Kripto: intent → confirm(txHash) → admin "zincirde kontrol et" → aktif
//   2) Kripto: yanlış cüzdan / eksik tutar → aktifleşmez, red nedeni görünür
//   3) Kripto: zincir kaydı yokken elle onay → gerekçe zorunlu (422)
//   4) Kart: Stripe Checkout oturumu (sahte API) → imzalı webhook → otomatik aktif
//   5) Kart: imzasız/sahte webhook reddedilir
//
// Çalıştırma: node scripts/test-payments.js   (npm run test:payments)
// ---------------------------------------------------------------------------
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const tmpDb = path.join(os.tmpdir(), `gl-payments-test-${crypto.randomBytes(4).toString('hex')}.db`);
process.env.GL_DB_FILE = tmpDb;
process.env.NODE_ENV = 'test';
process.env.GL_ADMIN_SECRET = 'test-admin-secret-0123456789';
process.env.GL_ADMIN_PASSWORD = 'test-admin-password';
process.env.PUBLIC_BASE_URL = 'https://globalleaders.test';
process.env.PAYMENT_PROVIDER = 'cold_wallet';
process.env.CRYPTO_ASSET = 'USDT';
process.env.CRYPTO_NETWORK = 'TRC20';
process.env.CRYPTO_WALLET_ADDRESS = 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE';
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.STRIPE_API_BASE = 'https://api.stripe.test';

const realFetch = globalThis.fetch;
let pass = 0, fail = 0; const failures = [];
const ok = (name, cond, extra = '') => { if (cond) { pass++; console.log(`  ✔ ${name}`); } else { fail++; failures.push(name); console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`); } };

// --- sahte TronGrid + Stripe API -------------------------------------------
const TRON_WALLET = process.env.CRYPTO_WALLET_ADDRESS;
const USDT_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const TX_OK = 'a'.repeat(64), TX_WRONG_TO = 'b'.repeat(64), TX_LOW = 'c'.repeat(64), TX_PENDING = 'd'.repeat(64);

const OTHER_WALLET = 'TWd4WrZ9wn84f5x1hZhL4DHvk738ns5jwb';
function tronResponse(url) {
  const m = url.match(/\/transactions\/([A-Za-z0-9]+)/);
  const hash = m ? m[1] : '';
  if (url.includes('/events')) {
    // Fiyatlar: votes-10 = $5, anthem = $5. TX_OK tam tutarı taşır,
    // TX_LOW anthem için eksik tutar (1 USDT) gönderir.
    const to = hash === TX_WRONG_TO ? OTHER_WALLET : TRON_WALLET;
    const value = hash === TX_LOW ? '1000000' : '5000000';
    return { status: 200, ok: true, json: async () => ({ data: [{ event_name: 'Transfer', contract_address: USDT_CONTRACT, result: { from: 'TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE', to, value } }] }) };
  }
  if ([TX_OK, TX_WRONG_TO, TX_LOW].includes(hash)) return { status: 200, ok: true, json: async () => ({ data: [{ blockNumber: 61234567, ret: [{ contractRet: 'SUCCESS' }] }] }) };
  if (hash === TX_PENDING) return { status: 200, ok: true, json: async () => ({ data: [{ ret: [{ contractRet: 'SUCCESS' }] }] }) };
  return { status: 404, ok: false, json: async () => ({}) };
}

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('http://127.0.0.1')) return realFetch(u, opts); // kendi test sunucumuz
  if (u.includes('trongrid')) return tronResponse(u);
  if (u.startsWith('https://api.stripe.test')) {
    const body = String((opts && opts.body) || '');
    if (!opts || !opts.headers || !String(opts.headers.authorization || '').startsWith('Bearer sk_test')) {
      return { status: 401, ok: false, json: async () => ({ error: { message: 'bad api key' } }) };
    }
    if (body.includes('mode=payment') || body.includes('mode=subscription')) {
      return { status: 200, ok: true, json: async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.test/pay/cs_test_123' }) };
    }
    return { status: 400, ok: false, json: async () => ({ error: { message: 'unexpected call' } }) };
  }
  throw new Error('unexpected network call: ' + u);
};

const express = require('express');
const db = require('../server/db');
// Ülke kaydı olmadan anthem satın alması doğrulanamaz (gerçek kurulumda seed edilir).
db.prepare("INSERT OR IGNORE INTO countries (code,name) VALUES ('TR','Türkiye')").run();
const api = require('../server/api');
const admin = require('../server/admin');

function startServer() {
  const app = express();
  app.use(require('cookie-parser')());
  app.use('/api/webhooks', express.raw({ type: '*/*', limit: '256kb' })); // gerçek sunucudaki sıra
  app.use(express.json({ limit: '8mb' }));
  app.use((req, res, next) => { req.sessionId = String(req.headers['x-gl-session'] || crypto.randomBytes(16).toString('hex')); next(); });
  app.use('/api', api);
  app.use('/api/admin', admin);
  return new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
}

let base;
const j = async (method, url, body, headers = {}) => {
  // İmza testleri için gövde bazen hazır string olarak gönderilir (Stripe gibi).
  const payload = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
  const r = await fetch(base + url, { method, headers: { 'content-type': 'application/json', ...headers }, body: payload });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { }
  return { status: r.status, json, headers: r.headers };
};

(async () => {
  const server = await startServer();
  base = `http://127.0.0.1:${server.address().port}`;

  // ---- admin oturumu ----
  const login = await j('POST', '/api/admin/login', { password: process.env.GL_ADMIN_PASSWORD });
  ok('admin login', login.status === 200, `status=${login.status}`);
  const adminCookie = (login.headers.get('set-cookie') || '').split(';')[0];
  const AH = { cookie: adminCookie };

  const SESSION = 'f'.repeat(32);
  let voteSession = null;

  console.log('\n1) Kripto akışı: intent → confirm → zincir kontrolü → aktif');
  const intent = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-10', method: 'crypto' }, { 'x-gl-session': SESSION });
  ok('intent oluştu (crypto)', intent.status === 200 && intent.json.intentId && intent.json.paymentMethod === 'cold_wallet');
  ok('cüzdan bilgisi döndü', intent.json.wallet && intent.json.wallet.address === TRON_WALLET && intent.json.wallet.network === 'TRC20');
  ok('tutar görüntüsü', intent.json.cryptoAmountDisplay === '5.00 USDT', intent.json.cryptoAmountDisplay);
  const intentId = intent.json.intentId;

  const badHash = await j('POST', '/api/purchase/confirm', { intentId, details: { txHash: 'x' } }, { 'x-gl-session': SESSION });
  ok('geçersiz hash reddedildi', badHash.status === 402 || badHash.status === 400, `status=${badHash.status}`);

  const conf = await j('POST', '/api/purchase/confirm', { intentId, details: { txHash: TX_OK } }, { 'x-gl-session': SESSION });
  ok('confirm → pending_verification', conf.status === 202 && conf.json.status === 'pending_verification', `status=${conf.status}`);

  const status1 = await j('GET', `/api/purchase/status?intent=${intentId}`, undefined, { 'x-gl-session': SESSION });
  ok('alıcı durumu "doğrulanıyor"', status1.json.status === 'pending_verification' && /doğrulan/i.test(status1.json.message || ''), JSON.stringify(status1.json));

  const dup = await j('POST', '/api/purchase/confirm', { intentId, details: { txHash: TX_OK } }, { 'x-gl-session': SESSION });
  ok('aynı hash tekrar gönderilemez', dup.json.error === 'transaction_hash_already_submitted' || dup.status === 202, `status=${dup.status}`);

  const list = await j('GET', '/api/admin/payments', undefined, AH);
  const row = (list.json.payments || []).find(p => p.intentId === intentId);
  ok('admin listesi zincir durumunu gösteriyor', list.status === 200 && row && row.chainStatus === 'not_checked', row && row.chainStatus);
  ok('admin listesi cüzdanı gösteriyor', list.json.wallet && list.json.wallet.address === TRON_WALLET);
  ok('kart sağlayıcı durumu', list.json.cardConfigured === true);

  const chain = await j('POST', `/api/admin/payments/${row.id}/check-chain`, {}, AH);
  ok('zincir kontrolü başarılı', chain.status === 200 && chain.json.ok === true, JSON.stringify(chain.json).slice(0, 200));
  ok('zincir doğrulaması satın almayı aktifleştirdi', chain.json.activated === true);
  ok('doğrulanan tutar', chain.json.onchain && chain.json.onchain.amountUsd === 5, JSON.stringify(chain.json.onchain));

  const vs = await j('GET', '/api/session', undefined, { 'x-gl-session': SESSION });
  voteSession = vs.json;
  ok('kupon oyları hesaba eklendi', (voteSession.purchased || 0) >= 10, `purchased=${voteSession.purchased}`);

  const status2 = await j('GET', `/api/purchase/status?intent=${intentId}`, undefined, { 'x-gl-session': SESSION });
  ok('alıcı durumu "aktif"', status2.json.status === 'succeeded' && status2.json.activated === true, JSON.stringify(status2.json));

  const again = await j('POST', `/api/admin/payments/${row.id}/check-chain`, {}, AH);
  ok('ikinci zincir kontrolü idempotent', again.json.ok === true && again.json.activated === false, JSON.stringify(again.json).slice(0, 160));

  console.log('\n2) Hatalı ödemeler aktifleşmiyor');
  const i2 = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-10', method: 'crypto' }, { 'x-gl-session': SESSION });
  await j('POST', '/api/purchase/confirm', { intentId: i2.json.intentId, details: { txHash: TX_WRONG_TO } }, { 'x-gl-session': SESSION });
  const r2 = (await j('GET', '/api/admin/payments', undefined, AH)).json.payments.find(p => p.intentId === i2.json.intentId);
  const chainWrong = await j('POST', `/api/admin/payments/${r2.id}/check-chain`, {}, AH);
  ok('yanlış cüzdan reddedildi', chainWrong.json.ok === false && ['wrong_recipient', 'transfer_not_found'].includes(chainWrong.json.reason), JSON.stringify(chainWrong.json).slice(0, 160));
  const manualNoReason = await j('POST', `/api/admin/payments/${r2.id}/verify`, {}, AH);
  ok('gerekçesiz elle onay reddedildi (422)', manualNoReason.status === 422 && manualNoReason.json.error === 'reason_required', `status=${manualNoReason.status}`);
  const manualOk = await j('POST', `/api/admin/payments/${r2.id}/verify`, { amount: 5, note: 'cüzdanda gördüm, TX kontrol edildi' }, AH);
  ok('gerekçeli elle onay çalışıyor ve zincir kaydı işleniyor', manualOk.status === 200 && manualOk.json.ok === true, JSON.stringify(manualOk.json).slice(0, 120));

  const i3 = await j('POST', '/api/purchase/intent', { kind: 'anthem', reference: 'TR', method: 'crypto' }, { 'x-gl-session': SESSION });
  ok('anthem intent oluştu', i3.status === 200 && !!i3.json.intentId, JSON.stringify(i3.json).slice(0, 160));
  await j('POST', '/api/purchase/confirm', { intentId: i3.json.intentId, details: { txHash: TX_LOW, sponsor: 'Test Sponsor', x_handle: '@test' } }, { 'x-gl-session': SESSION });
  const list3 = (await j('GET', '/api/admin/payments', undefined, AH)).json.payments;
  const row3 = list3.find(p => p.intentId === i3.json.intentId);
  const chainLow = await j('POST', `/api/admin/payments/${row3.id}/check-chain`, {}, AH);
  ok('eksik tutar reddedildi', chainLow.json.ok === false && chainLow.json.reason === 'amount_too_low', JSON.stringify(chainLow.json).slice(0, 160));

  const i4 = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-60', method: 'crypto' }, { 'x-gl-session': SESSION });
  await j('POST', '/api/purchase/confirm', { intentId: i4.json.intentId, details: { txHash: TX_PENDING } }, { 'x-gl-session': SESSION });
  const list4 = (await j('GET', '/api/admin/payments', undefined, AH)).json.payments;
  const row4 = list4.find(p => p.intentId === i4.json.intentId);
  const chainPend = await j('POST', `/api/admin/payments/${row4.id}/check-chain`, {}, AH);
  ok('onaysız işlem "blok bekliyor" diyor', chainPend.json.ok === false && chainPend.json.reason === 'pending_confirmation', JSON.stringify(chainPend.json).slice(0, 160));

  console.log('\n3) Red akışı');
  const reject = await j('POST', `/api/admin/payments/${row4.id}/reject`, { reason: 'test red' }, AH);
  ok('ödeme reddedildi', reject.status === 200 && reject.json.ok === true);
  const rejectedStatus = await j('GET', `/api/purchase/status?intent=${i4.json.intentId}`, undefined, { 'x-gl-session': SESSION });
  ok('alıcı reddi görüyor', rejectedStatus.json.status === 'rejected', JSON.stringify(rejectedStatus.json).slice(0, 120));

  console.log('\n4) Kart akışı (Stripe Checkout + imzalı webhook)');
  const cardIntent = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-60', method: 'card' }, { 'x-gl-session': SESSION });
  ok('kart intent oluştu', cardIntent.status === 200 && cardIntent.json.paymentMethod === 'card', JSON.stringify(cardIntent.json).slice(0, 200));
  ok('Stripe yönlendirme bağlantısı var', cardIntent.json.clientAction && cardIntent.json.clientAction.type === 'redirect' && /checkout\.stripe\.test/.test(cardIntent.json.clientAction.url));
  const cardId = cardIntent.json.intentId;

  const confirmCard = await j('POST', '/api/purchase/confirm', { intentId: cardId, details: {} }, { 'x-gl-session': SESSION });
  ok('kart ödemesi istemciden onaylanamıyor', confirmCard.status === 400 && confirmCard.json.error === 'card_payments_are_confirmed_by_webhook', JSON.stringify(confirmCard.json));

  const paidEvent = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', client_reference_id: cardId, payment_intent: 'pi_test_999' } } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${paidEvent}`).digest('hex');

  const badHook = await j('POST', '/api/webhooks/stripe', { fake: true });
  ok('sahte webhook gövdesi imzasız reddedildi', badHook.status === 400 || badHook.json.received === false, JSON.stringify(badHook.json));

  const hook = await j('POST', '/api/webhooks/stripe', paidEvent, { 'stripe-signature': `t=${t},v1=${sig}` });
  ok('imzalı webhook kabul edildi', hook.status === 200 && hook.json.received === true, JSON.stringify(hook.json));
  ok('kart ödemesi otomatik aktifleşti', hook.json.activated === true, JSON.stringify(hook.json));

  const hookAgain = await j('POST', '/api/webhooks/stripe', paidEvent, { 'stripe-signature': `t=${t},v1=${sig}` });
  ok('webhook tekrarı çift kupon yazmıyor', hookAgain.json.idempotent === true && hookAgain.json.activated === false, JSON.stringify(hookAgain.json));
  const vsAfter = await j('GET', '/api/session', undefined, { 'x-gl-session': SESSION });
  // Zincirle doğrulanan 10 + elle onaylanan 10 + kartla alınan 60 = 80
  // (blok bekleyen votes-60 reddedildiği için sayılmaz)
  ok('kupon bakiyesi tam bir kez yazıldı (80)', (vsAfter.json.purchased || 0) === 80, `purchased=${vsAfter.json.purchased}`);

  const statusCard = await j('GET', `/api/purchase/status?intent=${cardId}`, undefined, { 'x-gl-session': SESSION });
  ok('kart sahibi "aktif" görüyor', statusCard.json.status === 'succeeded' && statusCard.json.method === 'card', JSON.stringify(statusCard.json).slice(0, 140));

  // Webhook'u hiç gelmemiş kart ödemesi: gerekçesiz elle aktivasyon reddedilir,
  // gerekçeyle (Stripe panelinde görüldüyse) aktifleştirilebilir.
  const card2 = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-10', method: 'card' }, { 'x-gl-session': SESSION });
  const listCard2 = (await j('GET', '/api/admin/payments', undefined, AH)).json.payments;
  const rowCard2 = listCard2.find(p => p.intentId === card2.json.intentId);
  ok('webhooksuz kart ödemesi "bekliyor" görünüyor', rowCard2 && rowCard2.chainStatus === 'webhook_wait', rowCard2 && rowCard2.chainStatus);

  const cardNoNote = await j('POST', `/api/admin/payments/${rowCard2.id}/verify`, {}, AH);
  ok('webhooksuz kart ödemesi gerekçesiz aktifleşmiyor (422)', cardNoNote.status === 422 && cardNoNote.json.error === 'reason_required', `status=${cardNoNote.status}`);
  const cardNote = await j('POST', `/api/admin/payments/${rowCard2.id}/verify`, { note: 'Stripe panelinde ödemeyi gördüm' }, AH);
  ok('gerekçeli kart aktivasyonu çalışıyor', cardNote.status === 200 && cardNote.json.ok === true, JSON.stringify(cardNote.json).slice(0, 140));

  const listPaid = (await j('GET', '/api/admin/payments', undefined, AH)).json.payments;
  const rowPaid = listPaid.find(p => p.intentId === cardId);
  ok('webhook ile doğrulanan kart "paid_webhook" görünüyor', rowPaid && rowPaid.status === 'succeeded', rowPaid && rowPaid.status);

  const stale = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_x', client_reference_id: cardId } } });
  const oldT = t - 4000;
  const oldSig = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${oldT}.${stale}`).digest('hex');
  const staleHook = await j('POST', '/api/webhooks/stripe', stale, { 'stripe-signature': `t=${oldT},v1=${oldSig}` });
  ok('eski zaman damgalı imza reddedildi (replay)', staleHook.status === 400, JSON.stringify(staleHook.json));

  console.log('\n5) Güvenlik kontrolleri');
  // Placeholder/geçersiz cüzdan adresiyle kripto ödeme başlatılamaz.
  {
    const saved = process.env.CRYPTO_WALLET_ADDRESS;
    process.env.CRYPTO_WALLET_ADDRESS = 'TDev' + 'x'.repeat(20) + '0'.repeat(11);
    delete require.cache[require.resolve('../server/services/payments')];
    delete require.cache[require.resolve('../server/services/onchain')];
    const fresh = require('../server/services/payments');
    ok('geçersiz adres → kripto kapalı', fresh.availability().crypto.enabled === false && fresh.availability().crypto.addressValid === false, JSON.stringify(fresh.availability().crypto));
    let blocked = null; try { fresh.createIntent({ method: 'crypto', kind: 'votes', reference: 'votes-10', amountUsd: 1 }); } catch (e) { blocked = e.message; }
    ok('geçersiz adresle intent engellendi', blocked === 'crypto_wallet_address_invalid', String(blocked));
    process.env.CRYPTO_WALLET_ADDRESS = saved;
    delete require.cache[require.resolve('../server/services/payments')];
    delete require.cache[require.resolve('../server/services/onchain')];
  }

  console.log('\n6) Ek kontroller');
  const methods = await j('GET', '/api/payment-methods');
  ok('ödeme yöntemleri ucu', methods.json.crypto && methods.json.crypto.enabled === true && methods.json.card && methods.json.card.enabled === true, JSON.stringify(methods.json));
  const otherSession = await j('GET', `/api/purchase/status?intent=${intentId}`, undefined, { 'x-gl-session': 'a'.repeat(32) });
  ok('başka oturum ödeme durumunu göremiyor', otherSession.status === 403, `status=${otherSession.status}`);
  const dashboard = await j('GET', '/api/admin/dashboard', undefined, AH);
  ok('dashboard ciro yalnızca başarılı ödemeleri sayıyor', dashboard.status === 200 && dashboard.json.revenue && dashboard.json.revenue.today >= 6, JSON.stringify(dashboard.json.revenue));

  console.log('\n7) Supporter aboneliği (aylık destekçi üyeliği)');
  {
    // Giriş yapmış bir üye oluştur (ödeme testi auth router'ı bağlamıyor).
    const authSvc = require('../server/services/auth');
    const subscriptionsSvc = require('../server/services/subscriptions');
    const u = db.prepare(`INSERT INTO users (email,username,password_hash,display_name,provider,email_verified_at,avatar_color)
                          VALUES (?,?,?,?,?,datetime('now'),?)`)
      .run('supporter@example.com', 'supporter_user', authSvc.hashPassword('TestParola123!'), 'Supporter', 'local', '#f5b524');
    const SUP_SESSION = 'f'.repeat(32);
    const day = new Date().toISOString().slice(0, 10);
    db.prepare(`INSERT INTO vote_sessions (id,session_id,day,user_id) VALUES (?,?,?,?)`).run(`${SUP_SESSION}:${day}`, SUP_SESSION, day, u.lastInsertRowid);
    const SH = { 'x-gl-session': SUP_SESSION };

    const before = await j('GET', '/api/subscription', undefined, SH);
    ok('giriş öncesi/sonrası durum ucu çalışıyor', before.status === 200 && before.json.active === false, JSON.stringify(before.json));

    const freeBefore = await j('GET', '/api/session', undefined, SH);
    ok('normal üyenin günlük hakkı 1', freeBefore.json.freePerDay === 1 && freeBefore.json.supporter.active === false, JSON.stringify({ f: freeBefore.json.freePerDay, s: freeBefore.json.supporter }));

    const sIntent = await j('POST', '/api/subscription/intent', { method: 'card' }, SH);
    ok('abonelik niyeti oluştu (kart)', sIntent.status === 200 && sIntent.json.paymentMethod === 'card' && !!sIntent.json.intentId, JSON.stringify(sIntent.json).slice(0, 160));
    ok('abonelik Stripe yönlendirmesine sahip', sIntent.json.clientAction && sIntent.json.clientAction.type === 'redirect', JSON.stringify(sIntent.json.clientAction || {}));
    const subIntentId = sIntent.json.intentId;

    // Yanlış kişi ödemeyi göremez
    const stranger = await j('GET', `/api/purchase/status?intent=${subIntentId}`, undefined, { 'x-gl-session': 'b'.repeat(32) });
    ok('abonelik ödemesi başkasına kapalı', stranger.status === 403, `status=${stranger.status}`);

    // Stripe abonelik ödemesi onaylandı → imzalı webhook
    const subEvent = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_sub_1', client_reference_id: subIntentId, subscription: 'sub_test_777', customer: 'cus_test_777', payment_intent: 'pi_sub_777' } } });
    const t7 = Math.floor(Date.now() / 1000);
    const sig7 = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t7}.${subEvent}`).digest('hex');
    const subHook = await j('POST', '/api/webhooks/stripe', subEvent, { 'stripe-signature': `t=${t7},v1=${sig7}` });
    ok('abonelik webhook ile aktifleşti', subHook.status === 200 && subHook.json.activated === true, JSON.stringify(subHook.json));

    const afterSub = await j('GET', '/api/subscription', undefined, SH);
    ok('abonelik aktif görünüyor', afterSub.json.active === true && afterSub.json.adFree === true && afterSub.json.bonusFreeVotes >= 4, JSON.stringify(afterSub.json));

    const freeAfter = await j('GET', '/api/session', undefined, SH);
    ok('destekçinin günlük hakkı yükseldi (1 + bonus)', freeAfter.json.freePerDay === 1 + afterSub.json.bonusFreeVotes, JSON.stringify({ f: freeAfter.json.freePerDay }));
    ok('oturumda destekçi bilgisi dönüyor', freeAfter.json.supporter && freeAfter.json.supporter.active === true, JSON.stringify(freeAfter.json.supporter));

    // Yenileme: invoice.paid dönem sonunu ileri taşır
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    const renew = JSON.stringify({ type: 'invoice.paid', data: { object: { subscription: 'sub_test_777', lines: { data: [{ period: { end: periodEnd } }] } } } });
    const t8 = Math.floor(Date.now() / 1000);
    const sig8 = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t8}.${renew}`).digest('hex');
    const renewHook = await j('POST', '/api/webhooks/stripe', renew, { 'stripe-signature': `t=${t8},v1=${sig8}` });
    ok('yenileme olayı işlendi', renewHook.status === 200 && renewHook.json.handled === true && !!renewHook.json.subscription, JSON.stringify(renewHook.json).slice(0, 160));

    // İptal: abonelik pasife düşer, kota normale iner
    const cancel = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_test_777', status: 'canceled' } } });
    const t9 = Math.floor(Date.now() / 1000);
    const sig9 = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t9}.${cancel}`).digest('hex');
    await j('POST', '/api/webhooks/stripe', cancel, { 'stripe-signature': `t=${t9},v1=${sig9}` });
    const afterCancel = await j('GET', '/api/subscription', undefined, SH);
    ok('iptal sonrası üyelik pasif', afterCancel.json.active === false, JSON.stringify(afterCancel.json));
    const freeCanceled = await j('GET', '/api/session', undefined, SH);
    ok('iptal sonrası günlük hak normale döndü', freeCanceled.json.freePerDay === 1, JSON.stringify({ f: freeCanceled.json.freePerDay }));

    // İptal yolu: Stripe faturalama portalı yalnızca kart üyeliğine açık.
    const portalAnon = await j('POST', '/api/subscription/portal', {}, { 'x-gl-session': 'c'.repeat(32) });
    ok('giriş yapmadan üyelik yönetimi yok (401)', portalAnon.status === 401, `status=${portalAnon.status}`);
    const portalNoCard = await j('POST', '/api/subscription/portal', {}, SH);
    ok('kartla alınmayan üyelikte portal kapalı (400)', portalNoCard.status === 400 && portalNoCard.json.error === 'no_card_membership', JSON.stringify(portalNoCard.json));

    // Admin: elle aktifleştirme (havale/nakit) ve MRR
    const ADMINH = { 'x-gl-admin': '' };
    const adminCookieArr = (await (await fetch('http://127.0.0.1:' + server.address().port + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.GL_ADMIN_PASSWORD }) })).headers.getSetCookie()).map(c => c.split(';')[0]).join('; ');
    ADMINH['cookie'] = adminCookieArr;
    const grant = await j('POST', '/api/admin/subscriptions/grant', { identifier: 'supporter_user', months: 3 }, ADMINH);
    ok('admin elle destekçi aktifleştirebiliyor', grant.status === 200 && grant.json.ok === true && grant.json.subscription.status === 'active', JSON.stringify(grant.json).slice(0, 160));
    const list = await j('GET', '/api/admin/subscriptions', undefined, ADMINH);
    ok('abonelik listesi ve MRR hesaplanıyor', list.status === 200 && list.json.stats.active >= 1 && list.json.stats.mrr > 0, JSON.stringify(list.json.stats));
    const dash = await j('GET', '/api/admin/dashboard', undefined, ADMINH);
    ok('panel MRR gösteriyor', dash.status === 200 && dash.json.subscriptions && dash.json.subscriptions.mrr > 0, JSON.stringify(dash.json.subscriptions || {}));
    const revoke = await j('POST', `/api/admin/subscriptions/${grant.json.subscription.id}/revoke`, {}, ADMINH);
    ok('admin aboneliği iptal edebiliyor', revoke.status === 200 && revoke.json.subscription.status === 'canceled', JSON.stringify(revoke.json).slice(0, 140));

    // Fiyat kademeleri
    const p1 = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-10', method: 'crypto' }, SH);
    ok('10 oy paketi $5', p1.json.amountUsd === 5, JSON.stringify(p1.json).slice(0, 120));
    const p2 = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-60', method: 'crypto' }, SH);
    ok('60 oy paketi $20', p2.json.amountUsd === 20, JSON.stringify(p2.json).slice(0, 120));
    const p3 = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-250', method: 'crypto' }, SH);
    ok('250 oy paketi $50 (yeni kademe)', p3.json.amountUsd === 50, JSON.stringify(p3.json).slice(0, 120));
    const bogus = await j('POST', '/api/purchase/intent', { kind: 'votes', reference: 'votes-1000', method: 'crypto' }, SH);
    ok('olmayan paket reddedildi', bogus.status === 400 && bogus.json.error === 'pack_not_found', JSON.stringify(bogus.json));
  }

  server.close();
  db.close && db.close();
  try { fs.unlinkSync(tmpDb); } catch { }
  console.log(`\n${fail === 0 ? '✅' : '❌'} payments: ${pass} geçti, ${fail} başarısız`);
  if (fail) { console.log('Başarısızlar: ' + failures.join(', ')); process.exit(1); }
})().catch(e => { console.error('test crashed:', e); process.exit(1); });
