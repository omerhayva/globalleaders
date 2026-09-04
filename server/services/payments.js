// ---------------------------------------------------------------------------
// Payment architecture: PaymentProvider interface -> PaymentService facade.
// Business logic (PurchaseService in api.js) never talks to a concrete provider.
// To go live: implement StripeProvider / PayPalProvider / RegionalProvider /
// CryptoProvider with the same 3 methods and register it below.
// ---------------------------------------------------------------------------
const crypto = require('crypto');
const db = require('../db');

/** @interface PaymentProvider
 *  createIntent({kind, reference, amountUsd, currency, sessionId, meta}) -> {intentId, clientAction}
 *  confirm(intentId, payload) -> {status: 'succeeded'|'failed', receipt}
 *  handleWebhook(rawBody, headers) -> {intentId, status} | null
 */

class MockPaymentProvider {
  get name() { return 'mock'; }
  createIntent({ kind, reference, amountUsd, currency = 'USD', sessionId, meta }) {
    const intentId = 'mock_' + crypto.randomBytes(10).toString('hex');
    db.prepare(`INSERT INTO payments (provider,intent_id,kind,reference,amount_usd,currency,status,demo,session_id,meta)
                VALUES ('mock',?,?,?,?,?,'pending',1,?,?)`)
      .run(intentId, kind, reference, amountUsd, currency, sessionId || null, JSON.stringify(meta || {}));
    // clientAction tells the frontend what UI flow to run; a real provider would
    // return e.g. a Stripe client_secret here instead.
    return { intentId, clientAction: { type: 'demo_confirm', message: 'DEMO MODE — no real charge will occur.' } };
  }
  confirm(intentId) {
    const p = db.prepare(`SELECT * FROM payments WHERE intent_id=?`).get(intentId);
    if (!p) return { status: 'failed', error: 'unknown_intent' };
    if (p.status === 'succeeded') return { status: 'succeeded', payment: p, idempotent: true };
    db.prepare(`UPDATE payments SET status='succeeded' WHERE intent_id=?`).run(intentId);
    return { status: 'succeeded', payment: db.prepare(`SELECT * FROM payments WHERE intent_id=?`).get(intentId) };
  }
  handleWebhook() { return null; } // mock provider has no async webhooks
}

class PaymentService {
  constructor() {
    this.providers = new Map();
    this.register(new MockPaymentProvider());
    this.active = 'mock'; // switch to 'stripe' etc. once a real provider is registered
  }
  register(provider) { this.providers.set(provider.name, provider); }
  get provider() { return this.providers.get(this.active); }
  createIntent(opts) { return this.provider.createIntent(opts); }
  confirm(intentId, payload) { return this.provider.confirm(intentId, payload); }
  webhook(providerName, rawBody, headers) {
    const p = this.providers.get(providerName);
    return p ? p.handleWebhook(rawBody, headers) : null;
  }
}

module.exports = new PaymentService();
