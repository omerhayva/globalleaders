// Payment provider abstraction. Initial production payment method: manual cold-wallet transfer.
const crypto = require('crypto');
const db = require('../db');

const COLD_WALLET_ADDRESS = process.env.CRYPTO_WALLET_ADDRESS || '';
const CRYPTO_ASSET = String(process.env.CRYPTO_ASSET || 'USDT').toUpperCase();
const CRYPTO_NETWORK = String(process.env.CRYPTO_NETWORK || 'TRC20').toUpperCase();

function cryptoAmountForUsd(amountUsd) {
  if (CRYPTO_ASSET !== 'USDT') throw new Error('unsupported_crypto_asset');
  return Number(amountUsd).toFixed(2);
}

function safeMeta(meta, extra = {}) {
  const input = { ...(meta || {}), ...extra }; const out = {};
  for (const key of ['advertiser', 'sponsor', 'x_handle', 'text', 'cta', 'url']) {
    if (input[key] !== undefined && input[key] !== null) out[key] = String(input[key]).slice(0, key === 'text' ? 120 : key === 'url' ? 500 : 80);
  }
  return out;
}

class ColdWalletProvider {
  get name() { return 'cold_wallet'; }
  createIntent({ kind, reference, amountUsd, currency = 'USD', sessionId, meta, advertiser }) {
    if (!COLD_WALLET_ADDRESS) throw new Error('crypto_wallet_not_configured');
    const cryptoAmount = cryptoAmountForUsd(amountUsd); const intentId = 'crypto_' + crypto.randomBytes(12).toString('hex');
    const storedMeta = safeMeta(meta, { advertiser });
    db.prepare(`INSERT INTO payments (provider,intent_id,kind,reference,amount_usd,currency,status,demo,session_id,meta)
                VALUES ('cold_wallet',?,?,?,?,?,'pending',0,?,?)`).run(intentId, kind, reference, amountUsd, currency, sessionId || null, JSON.stringify(storedMeta));
    return {
      intentId, paymentMethod: 'cold_wallet', amountUsd, cryptoAmount,
      cryptoAmountDisplay: `${cryptoAmount} ${CRYPTO_ASSET}`,
      wallet: { address: COLD_WALLET_ADDRESS, asset: CRYPTO_ASSET, network: CRYPTO_NETWORK },
      instructions: `Send exactly ${cryptoAmount} ${CRYPTO_ASSET} on ${CRYPTO_NETWORK} to this wallet, then submit the transaction hash. Your purchase is activated only after manual payment verification.`
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

class MockPaymentProvider {
  get name() { return 'mock'; }
  createIntent({ kind, reference, amountUsd, currency = 'USD', sessionId, meta }) {
    const intentId = 'mock_' + crypto.randomBytes(10).toString('hex');
    db.prepare(`INSERT INTO payments (provider,intent_id,kind,reference,amount_usd,currency,status,demo,session_id,meta)
                VALUES ('mock',?,?,?,?,?,'pending',1,?,?)`).run(intentId, kind, reference, amountUsd, currency, sessionId || null, JSON.stringify(meta || {}));
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
  constructor() { this.providers = new Map(); this.register(new ColdWalletProvider()); this.register(new MockPaymentProvider()); this.active = process.env.PAYMENT_PROVIDER || 'cold_wallet'; }
  register(provider) { this.providers.set(provider.name, provider); }
  get provider() { return this.providers.get(this.active); }
  createIntent(opts) { if (!this.provider) throw new Error('payment_provider_not_configured'); return this.provider.createIntent(opts); }
  confirm(intentId, payload) { if (!this.provider) return { status: 'failed', error: 'payment_provider_not_configured' }; return this.provider.confirm(intentId, payload); }
  webhook(providerName, rawBody, headers) { const p = this.providers.get(providerName); return p ? p.handleWebhook(rawBody, headers) : null; }
}

module.exports = new PaymentService();
