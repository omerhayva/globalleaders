// Payment provider abstraction. Real money must only flow through a configured provider.
const crypto = require('crypto');
const db = require('../db');

class MockPaymentProvider {
  get name() { return 'mock'; }
  createIntent({ kind, reference, amountUsd, currency = 'USD', sessionId, meta }) {
    const intentId = 'mock_' + crypto.randomBytes(10).toString('hex');
    db.prepare(`INSERT INTO payments (provider,intent_id,kind,reference,amount_usd,currency,status,demo,session_id,meta)
                VALUES ('mock',?,?,?,?,?,'pending',1,?,?)`)
      .run(intentId, kind, reference, amountUsd, currency, sessionId || null, JSON.stringify(meta || {}));
    return { intentId, clientAction: { type: 'demo_confirm', message: 'Demo payment only — no real charge will occur.' } };
  }
  confirm(intentId) {
    const p = db.prepare('SELECT * FROM payments WHERE intent_id=?').get(intentId);
    if (!p) return { status: 'failed', error: 'unknown_intent' };
    if (p.status === 'succeeded') return { status: 'succeeded', payment: p, idempotent: true };
    db.prepare("UPDATE payments SET status='succeeded' WHERE intent_id=? AND status='pending'").run(intentId);
    return { status: 'succeeded', payment: db.prepare('SELECT * FROM payments WHERE intent_id=?').get(intentId) };
  }
  handleWebhook() { return null; }
}

class PaymentService {
  constructor() {
    this.providers = new Map();
    this.register(new MockPaymentProvider());
    // Mock is intentionally disabled by default. A real provider must be registered
    // and selected explicitly before purchases can be enabled in production.
    this.active = process.env.PAYMENT_PROVIDER || 'mock';
  }
  register(provider) { this.providers.set(provider.name, provider); }
  get provider() { return this.providers.get(this.active); }
  createIntent(opts) {
    if (!this.provider) throw new Error('payment_provider_not_configured');
    return this.provider.createIntent(opts);
  }
  confirm(intentId, payload) {
    if (!this.provider) return { status: 'failed', error: 'payment_provider_not_configured' };
    return this.provider.confirm(intentId, payload);
  }
  webhook(providerName, rawBody, headers) {
    const p = this.providers.get(providerName);
    return p ? p.handleWebhook(rawBody, headers) : null;
  }
}

module.exports = new PaymentService();
