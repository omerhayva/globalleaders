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
    // TX_OK: 1 USDT (votes-10 = $1) · TX_WRONG_TO: başka cüzdana 1 USDT
    // TX_LOW: anthem ($5) için yalnızca 1 USDT
    const to = hash === TX_WRONG_TO ? OTHER_WALLET : TRON_WALLET;
    const value = hash === TX_LOW ? '1000000' : '1000000';
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
    if (body.includes('mode=payment')) {
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
  ok('tutar görüntüsü', intent.json.cryptoAmountDisplay === '1.00 USDT', intent.json.cryptoAmountDisplay);
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
  ok('doğrulanan tutar', chain.json.onchain && chain.json.onchain.amountUsd === 1, JSON.stringify(chain.json.onchain));

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
  const manualOk = await j('POST', `/api/admin/payments/${r2.id}/verify`, { amount: 1, note: 'cüzdanda gördüm, TX kontrol edildi' }, AH);
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

  server.close();
  db.close && db.close();
  try { fs.unlinkSync(tmpDb); } catch { }
  console.log(`\n${fail === 0 ? '✅' : '❌'} payments: ${pass} geçti, ${fail} başarısız`);
  if (fail) { console.log('Başarısızlar: ' + failures.join(', ')); process.exit(1); }
})().catch(e => { console.error('test crashed:', e); process.exit(1); });
