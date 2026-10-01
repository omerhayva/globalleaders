// Ödeme doğrulama orkestrasyonu: zincir üstü kontrol + (başarılıysa) aktifleştirme.
// Hem API'nin otomatik modu hem de admin panelindeki "Zincirde kontrol et"
// düğmesi bu tek fonksiyonu kullanır — böylece davranış tek yerde tanımlıdır.
const db = require('../db');
const onchain = require('./onchain');
const { fulfillPayment } = require('./payment-fulfillment');

function readMeta(payment) { try { return payment.meta ? JSON.parse(payment.meta) : {}; } catch { return {}; } }

function walletConfig() {
  return {
    address: process.env.CRYPTO_WALLET_ADDRESS || '',
    asset: String(process.env.CRYPTO_ASSET || 'USDT').toUpperCase(),
    network: String(process.env.CRYPTO_NETWORK || 'TRC20').toUpperCase()
  };
}

// Dönüş: { ok, reason?, message, fulfilled?, payment }
async function checkPaymentOnchain(paymentId, { fetchImpl, actor = 'onchain' } = {}) {
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
  if (!payment) return { ok: false, reason: 'payment_not_found', message: 'Payment not found.' };
  if (payment.provider !== 'cold_wallet') return { ok: false, reason: 'not_crypto_payment', message: 'Only crypto payments are checked on-chain.' };
  if (payment.status === 'succeeded') return { ok: true, fulfilled: false, alreadyActive: true, message: 'This payment was already verified and activated.', payment };
  if (payment.status !== 'pending_verification') return { ok: false, reason: 'payment_not_pending', message: `Payment is ${payment.status}, nothing to check.`, payment };

  const cfg = walletConfig();
  if (!cfg.address) return { ok: false, reason: 'crypto_wallet_not_configured', message: 'Crypto wallet address is not configured on the server.', payment };

  const meta = readMeta(payment);
  const txHash = payment.tx_hash || meta.txHash;
  const result = await onchain.verifyUsdtTrc20({
    txHash, toAddress: cfg.address, expectedUsd: Number(payment.amount_usd),
    asset: cfg.asset, network: cfg.network, fetchImpl
  });

  meta.lastCheck = { at: new Date().toISOString(), ok: !!result.ok, reason: result.reason || null, message: result.message || null, txHash: txHash || null };
  if (result.ok) meta.onchain = { amountUsd: result.amountUsd, block: result.block, at: meta.lastCheck.at };
  db.prepare('UPDATE payments SET meta=? WHERE id=?').run(JSON.stringify(meta), paymentId);

  if (!result.ok) return { ...result, payment: db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId) };

  const fulfilled = fulfillPayment(paymentId, actor, result.amountUsd);
  return {
    ok: true, reason: null, message: result.message, onchain: { amountUsd: result.amountUsd, block: result.block },
    fulfilled: !!(fulfilled && fulfilled.ok), activated: fulfilled && fulfilled.ok, detail: fulfilled,
    payment: db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId)
  };
}

// Müşteri hash'i gönderdikten sonra (AUTO_ONCHAIN_VERIFY=1) arka planda çalışır:
// transfer zincirde görünene kadar kısa aralıklarla dener, olunca aktifleştirir.
async function autoVerifyOnchain(paymentId, { attempts = 6, delayMs = 20000, fetchImpl } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await checkPaymentOnchain(paymentId, { fetchImpl, actor: 'onchain_auto' });
      if (res.ok || res.reason === 'amount_too_low' || res.reason === 'wrong_recipient' || res.reason === 'wrong_asset' || res.reason === 'not_crypto_payment') return res;
      if (res.reason === 'network_error' || res.reason === 'not_found' || res.reason === 'transfer_not_found' || res.reason === 'pending_confirmation') {
        if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
        continue;
      }
      return res;
    } catch (e) { if (i === attempts - 1) throw e; await new Promise(r => setTimeout(r, delayMs)); }
  }
  return { ok: false, reason: 'not_found', message: 'Transaction was not visible on-chain yet; it will be checked again on the next site activity.' };
}

module.exports = { checkPaymentOnchain, autoVerifyOnchain, walletConfig, readMeta };
