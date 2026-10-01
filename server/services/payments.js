// Payment provider abstraction.
//
// İki ödeme yolu desteklenir:
//   • cold_wallet (kripto) — kullanıcı USDT/TRC20 transferini kendisi yapar,
//     işlem hash'ini bildirir. Para geldi mi sorusu zincir üstü kontrolle
//     (server/services/onchain.js) ya da adminin elle doğrulamasıyla yanıtlanır.
//   • stripe (kredi/banka kartı) — kullanıcı Stripe'ın barındırılan ödeme
//     sayfasına yönlendirilir; ödeme alındığında Stripe imzalı bir webhook
//     gönderir ve satın alma otomatik olarak aktifleşir.
//
// Aynı soyutlama iyzico/PayTR gibi sağlayıcılar için de genişletilebilir:
// yeni bir sınıf yazıp `register()` ile eklemek ve PAYMENT_PROVIDER'ı
// değiştirmek yeterlidir.
const crypto = require('crypto');
const db = require('../db');
const { isValidTronAddress } = require('./onchain');

const COLD_WALLET_ADDRESS = process.env.CRYPTO_WALLET_ADDRESS || '';
const CRYPTO_ASSET = String(process.env.CRYPTO_ASSET || 'USDT').toUpperCase();
const CRYPTO_NETWORK = String(process.env.CRYPTO_NETWORK || 'TRC20').toUpperCase();

const STRIPE_SECRET_KEY = () => process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = () => process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_API_BASE = () => process.env.STRIPE_API_BASE || 'https://api.stripe.com';

function cryptoAmountForUsd(amountUsd) {
  if (CRYPTO_ASSET !== 'USDT') throw new Error('unsupported_crypto_asset');
  return Number(amountUsd).toFixed(2);
}

function safeMeta(meta, extra = {}) {
  const input = { ...(meta || {}), ...extra }; const out = {};
  for (const key of ['advertiser', 'sponsor', 'x_handle', 'text', 'cta', 'url']) {
    if (input[key] !== undefined && input[key] !== null) out[key] = String(input[key]).slice(0, key === 'text' ? 120 : key === 'url' ? 500 : 80);
  }
  // Görsel yalnızca sunucunun kendi kaydettiği dosya yolu olarak saklanır.
  if (input.image && /^\/uploads\/[A-Za-z0-9._-]+$/.test(String(input.image))) out.image = String(input.image).slice(0, 300);
  return out;
}

/* ------------------------------ kripto (cold wallet) ---------------------- */
class ColdWalletProvider {
  get name() { return 'cold_wallet'; }
  get method() { return 'crypto'; }
  get configured() { return !!COLD_WALLET_ADDRESS; }
  // Yanlış yazılmış bir cüzdan adresine müşteri para göndermesin diye adres
  // biçimi kontrol edilir (TRC20 = T ile başlayan 34 karakterlik base58 adres).
  get addressValid() { return CRYPTO_NETWORK !== 'TRC20' ? !!COLD_WALLET_ADDRESS : isValidTronAddress(COLD_WALLET_ADDRESS); }
  createIntent({ kind, reference, amountUsd, currency = 'USD', sessionId, identityKey, meta, advertiser }) {
    if (!COLD_WALLET_ADDRESS) throw new Error('crypto_wallet_not_configured');
    if (!this.addressValid) throw new Error('crypto_wallet_address_invalid');
    const cryptoAmount = cryptoAmountForUsd(amountUsd); const intentId = 'crypto_' + crypto.randomBytes(12).toString('hex');
    const storedMeta = safeMeta(meta, { advertiser });
    db.prepare(`INSERT INTO payments (provider,intent_id,kind,reference,amount_usd,currency,status,demo,session_id,identity_key,meta)
                VALUES ('cold_wallet',?,?,?,?,?,'pending',0,?,?,?)`).run(intentId, kind, reference, amountUsd, currency, sessionId || null, identityKey || null, JSON.stringify(storedMeta));
    return {
      intentId, paymentMethod: 'cold_wallet', amountUsd, cryptoAmount,
      cryptoAmountDisplay: `${cryptoAmount} ${CRYPTO_ASSET}`,
      wallet: { address: COLD_WALLET_ADDRESS, asset: CRYPTO_ASSET, network: CRYPTO_NETWORK },
      instructions: `Send exactly ${cryptoAmount} ${CRYPTO_ASSET} on ${CRYPTO_NETWORK} to this wallet, then submit the transaction hash. Your purchase is activated only after the payment is verified.`
    };
  }
  confirm(intentId, details = {}) {
    const p = db.prepare('SELECT * FROM payments WHERE intent_id=?').get(intentId);
    if (!p) return { status: 'failed', error: 'unknown_intent' };
    if (p.status === 'pending_verification') return { status: 'pending_verification', payment: p, idempotent: true };
    if (p.status !== 'pending') return { status: p.status, payment: p };
    const txHash = String(details.txHash || (details.payment && details.payment.txHash) || '').trim().slice(0, 180);
    if (!/^[A-Za-z0-9:_-]{20,180}$/.test(txHash)) return { status: 'failed', error: 'transaction_hash_required' };
    let meta = {}; try { meta = p.meta ? JSON.parse(p.meta) : {}; } catch { meta = {}; }
    Object.assign(meta, safeMeta(details)); meta.txHash = txHash; meta.submittedAt = new Date().toISOString();
    try {
      const info = db.prepare("UPDATE payments SET status='pending_verification',meta=?,tx_hash=? WHERE intent_id=? AND status='pending'").run(JSON.stringify(meta), txHash, intentId);
      if (!info.changes) return { status: 'pending_verification', payment: db.prepare('SELECT * FROM payments WHERE intent_id=?').get(intentId), idempotent: true };
    } catch (err) {
      if (String(err && err.message).includes('UNIQUE constraint failed') && /tx_hash/i.test(String(err.message))) return { status: 'failed', error: 'transaction_hash_already_submitted' };
      throw err;
    }
    return { status: 'pending_verification', payment: db.prepare('SELECT * FROM payments WHERE intent_id=?').get(intentId) };
  }
  handleWebhook() { return null; }
}

/* ------------------------------ kart (Stripe Checkout) ------------------- */
// İmza doğrulama: Stripe "Stripe-Signature: t=...,v1=..." başlığını gönderir;
// HMAC-SHA256(secret, `${t}.${rawBody}`) değeri v1 ile eşleşmelidir.
function verifyStripeSignature(rawBody, header, secret, toleranceSec = 300) {
  if (!secret || !header) return false;
  const parts = String(header).split(',').map(s => s.trim());
  const t = parts.find(p => p.startsWith('t='));
  const sigs = parts.filter(p => p.startsWith('v1=')).map(p => p.slice(3));
  if (!t || !sigs.length) return false;
  const timestamp = Number(t.slice(2));
  if (!Number.isFinite(timestamp)) return false;
  if (toleranceSec > 0 && Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t.slice(2)}.${rawBody}`).digest('hex');
  return sigs.some(sig => {
    try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig)); } catch { return false; }
  });
}

class StripeProvider {
  get name() { return 'stripe'; }
  get method() { return 'card'; }
  get configured() { return !!STRIPE_SECRET_KEY(); }
  async createIntent({ kind, reference, amountUsd, currency = 'USD', sessionId, identityKey, meta, advertiser, baseUrl, description }) {
    if (!this.configured) throw new Error('card_provider_not_configured');
    const intentId = 'card_' + crypto.randomBytes(12).toString('hex');
    const storedMeta = safeMeta(meta, { advertiser });
    db.prepare(`INSERT INTO payments (provider,intent_id,kind,reference,amount_usd,currency,status,demo,session_id,identity_key,meta)
                VALUES ('stripe',?,?,?,?,?,'pending',0,?,?,?)`).run(intentId, kind, reference, amountUsd, currency, sessionId || null, identityKey || null, JSON.stringify(storedMeta));

    const root = String(baseUrl || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
    const params = new URLSearchParams();
    params.set('mode', 'payment');
    params.set('success_url', `${root}/?payment=success&intent=${intentId}`);
    params.set('cancel_url', `${root}/?payment=cancelled&intent=${intentId}`);
    params.set('client_reference_id', intentId);
    params.set('metadata[intentId]', intentId);
    params.set('metadata[kind]', String(kind));
    params.set('line_items[0][quantity]', '1');
    params.set('line_items[0][price_data][currency]', String(currency || 'USD').toLowerCase());
    params.set('line_items[0][price_data][unit_amount]', String(Math.round(Number(amountUsd) * 100)));
    params.set('line_items[0][price_data][product_data][name]', String(description || 'Global Leaders Live purchase').slice(0, 120));

    const r = await fetch(`${STRIPE_API_BASE()}/v1/checkout/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${STRIPE_SECRET_KEY()}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    });
    const session = await r.json().catch(() => ({}));
    if (!r.ok || !session.url) {
      db.prepare("UPDATE payments SET status='failed' WHERE intent_id=?").run(intentId);
      return { intentId, paymentMethod: 'card', amountUsd, error: 'card_session_failed', detail: (session && session.error && session.error.message) || `HTTP ${r.status}` };
    }
    db.prepare('UPDATE payments SET meta=? WHERE intent_id=?').run(JSON.stringify({ ...storedMeta, stripeSessionId: session.id }), intentId);
    return { intentId, paymentMethod: 'card', amountUsd, clientAction: { type: 'redirect', url: session.url }, cardSessionId: session.id };
  }
  confirm() { return { status: 'failed', error: 'card_payments_are_confirmed_by_webhook' }; }
  // Stripe webhook'u: para gerçekten alındığında çalışır. Dönüş: {handled, paymentId, event}
  async handleWebhook(rawBody, headers = {}) {
    const secret = STRIPE_WEBHOOK_SECRET();
    const raw = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody || '');
    if (secret && !verifyStripeSignature(raw, headers['stripe-signature'], secret)) {
      return { handled: false, error: 'invalid_signature' };
    }
    let event = null; try { event = JSON.parse(raw); } catch { return { handled: false, error: 'invalid_payload' }; }
    const type = event && event.type;
    const session = (event && event.data && event.data.object) || {};
    const intentId = session.client_reference_id || (session.metadata && session.metadata.intentId);
    if (!intentId) return { handled: false, error: 'unknown_intent', event: type };
    const payment = db.prepare('SELECT * FROM payments WHERE intent_id=?').get(intentId);
    if (!payment) return { handled: false, error: 'unknown_intent', event: type };

    if (type === 'checkout.session.completed' || type === 'payment_intent.succeeded') {
      if (payment.status === 'pending') {
        db.prepare("UPDATE payments SET status='paid', tx_hash=? WHERE id=? AND status='pending'").run(String(session.payment_intent || session.id || '').slice(0, 180), payment.id);
      }
      return { handled: true, paymentId: payment.id, event: type, paid: true };
    }
    if (type === 'checkout.session.expired' || type === 'payment_intent.payment_failed') {
      db.prepare("UPDATE payments SET status='failed' WHERE id=? AND status='pending'").run(payment.id);
      return { handled: true, paymentId: payment.id, event: type, paid: false };
    }
    return { handled: false, event: type, paymentId: payment.id };
  }
}

class MockPaymentProvider {
  get name() { return 'mock'; }
  get method() { return 'demo'; }
  get configured() { return true; }
  createIntent({ kind, reference, amountUsd, currency = 'USD', sessionId, identityKey, meta }) {
    const intentId = 'mock_' + crypto.randomBytes(10).toString('hex');
    db.prepare(`INSERT INTO payments (provider,intent_id,kind,reference,amount_usd,currency,status,demo,session_id,identity_key,meta)
                VALUES ('mock',?,?,?,?,?,'pending',1,?,?,?)`).run(intentId, kind, reference, amountUsd, currency, sessionId || null, identityKey || null, JSON.stringify(meta || {}));
    return { intentId, clientAction: { type: 'demo_confirm', message: 'Demo payment only — no real charge will occur.' } };
  }
  confirm(intentId) {
    const p = db.prepare('SELECT * FROM payments WHERE intent_id=?').get(intentId); if (!p) return { status: 'failed', error: 'unknown_intent' };
    if (p.status === 'succeeded') return { status: 'succeeded', payment: p, idempotent: true };
    db.prepare("UPDATE payments SET status='succeeded' WHERE intent_id=? AND status='pending'").run(intentId);
    return { status: 'succeeded', payment: db.prepare('SELECT * FROM payments WHERE intent_id=?').get(intentId) };
  }
  handleWebhook() { return null; }
}

class PaymentService {
  constructor() {
    this.providers = new Map();
    this.register(new ColdWalletProvider());
    this.register(new StripeProvider());
    this.register(new MockPaymentProvider());
    this.active = process.env.PAYMENT_PROVIDER || 'cold_wallet';
  }
  register(provider) { this.providers.set(provider.name, provider); }
  get provider() { return this.providers.get(this.active); }
  providerForMethod(method) {
    const m = String(method || '').toLowerCase();
    if (m === 'card' || m === 'stripe') return this.providers.get('stripe');
    if (m === 'crypto' || m === 'cold_wallet') return this.providers.get('cold_wallet');
    return this.provider;
  }
  // Arayüz hangi ödeme seçeneklerini göstereceğini buradan öğrenir.
  availability() {
    const crypto = this.providers.get('cold_wallet');
    const card = this.providers.get('stripe');
    return {
      crypto: { enabled: !!crypto.configured && crypto.addressValid, configured: !!crypto.configured, addressValid: crypto.addressValid, asset: CRYPTO_ASSET, network: CRYPTO_NETWORK, label: `Crypto (${CRYPTO_ASSET} · ${CRYPTO_NETWORK})` },
      card: { enabled: !!card.configured, provider: 'stripe', label: 'Credit / debit card' },
      autoOnchainVerify: process.env.AUTO_ONCHAIN_VERIFY === '1'
    };
  }
  createIntent(opts) { const p = this.providerForMethod(opts && opts.method); if (!p) throw new Error('payment_provider_not_configured'); return p.createIntent(opts); }
  confirm(intentId, payload) { const p = this.provider; if (!p) return { status: 'failed', error: 'payment_provider_not_configured' }; return p.confirm(intentId, payload); }
  async webhook(providerName, rawBody, headers) {
    const p = this.providers.get(providerName) || (providerName === 'card' ? this.providers.get('stripe') : null);
    return p ? await p.handleWebhook(rawBody, headers) : null;
  }
}

module.exports = new PaymentService();
module.exports.verifyStripeSignature = verifyStripeSignature;
module.exports.PaymentService = PaymentService;
