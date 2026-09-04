const db = require('../db');
const core = require('../core');

function readMeta(payment) {
  try { return payment.meta ? JSON.parse(payment.meta) : {}; } catch { return {}; }
}

function fulfillPayment(paymentId, adminId, verifiedAmount) {
  const result = db.transaction(() => {
    const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (!payment) return { error: 'payment_not_found' };
    if (payment.provider !== 'cold_wallet') return { error: 'only_cold_wallet_can_be_verified' };
    if (payment.status === 'succeeded' && payment.fulfilled_at) return { ok: true, idempotent: true, payment };
    if (payment.status !== 'pending_verification') return { error: 'payment_not_pending', status: payment.status };
    if (!payment.tx_hash) return { error: 'transaction_hash_missing' };
    const expected = Number(payment.amount_usd); const received = Number(verifiedAmount);
    if (!Number.isFinite(received) || received <= 0 || Math.abs(received - expected) > 0.000001) return { error: 'amount_mismatch', expected, received: Number.isFinite(received) ? received : null };
    const fulfillmentKey = `payment:${payment.id}`; const now = new Date().toISOString(); const meta = readMeta(payment);

    if (payment.kind === 'votes') {
      const packs = { 'votes-10': 10, 'votes-60': 60 }; const votes = packs[payment.reference]; if (!votes) return { error: 'pack_not_found' };
      const session = core.getOrCreateVoteSession(payment.session_id, null, null);
      db.prepare('UPDATE vote_sessions SET purchased=purchased+? WHERE id=?').run(votes, session.id);
      db.prepare('INSERT INTO bonus_votes (session_id,reason) VALUES (?,?)').run(payment.session_id, `purchase:${payment.reference}:payment:${payment.id}`);
      const updated = db.prepare('SELECT * FROM vote_sessions WHERE id=?').get(session.id);
      db.prepare(`UPDATE payments SET status='succeeded',fulfilled_at=?,fulfillment_key=?,verified_at=?,verified_by=? WHERE id=? AND status='pending_verification'`).run(now, fulfillmentKey, now, String(adminId || 'admin'), payment.id);
      return { ok: true, kind: 'votes', votesAdded: votes, remaining: core.remainingVotes(updated), paymentId: payment.id };
    }

    if (payment.kind === 'ad') {
      const slotId = String(payment.reference || ''); const slot = db.prepare('SELECT * FROM advertising_slots WHERE id=? AND active=1').get(slotId); if (!slot) return { error: 'slot_not_found' };
      const advertiser = String(meta.advertiser || 'Anonymous sponsor').slice(0, 60) || 'Anonymous sponsor'; const xh = String(meta.x_handle || '').slice(0, 16) || null;
      const text = String(meta.text || '').slice(0, 120); const cta = String(meta.cta || 'Learn more').slice(0, 30) || 'Learn more'; const url = meta.url ? String(meta.url).slice(0, 500) : null;
      db.prepare("UPDATE advertisements SET status='replaced' WHERE slot_id=? AND status='active'").run(slotId);
      const ad = db.prepare(`INSERT INTO advertisements (slot_id,advertiser,image,text,cta,url,x_handle,starts_at,status) VALUES (?,?,?,?,?,?,?,datetime('now'),'active')`).run(slotId, advertiser, null, text, cta, url, xh);
      db.prepare('INSERT INTO ad_purchases (slot_id,ad_id,payment_id,advertiser,amount_usd) VALUES (?,?,?,?,?)').run(slotId, ad.lastInsertRowid, payment.id, advertiser, expected);
      db.prepare(`UPDATE payments SET status='succeeded',fulfilled_at=?,fulfillment_key=?,verified_at=?,verified_by=? WHERE id=? AND status='pending_verification'`).run(now, fulfillmentKey, now, String(adminId || 'admin'), payment.id);
      return { ok: true, kind: 'ad', slotId, advertiser, paymentId: payment.id };
    }

    if (payment.kind === 'anthem') {
      const cc = String(payment.reference || '').toUpperCase(); if (!/^[A-Z]{2}$/.test(cc) || !db.prepare('SELECT 1 FROM countries WHERE code=?').get(cc)) return { error: 'country_not_found' };
      const sponsor = String(meta.sponsor || 'Anonymous').slice(0, 60) || 'Anonymous'; const xh = String(meta.x_handle || '').slice(0, 16) || null; const prev = db.prepare('SELECT sponsor FROM anthem_slots WHERE country_code=?').get(cc);
      db.prepare(`INSERT INTO anthem_slots (country_code,sponsor,sponsor_session,price_usd,purchased_at,sponsor_x) VALUES (?,?,?,?,datetime('now'),?) ON CONFLICT(country_code) DO UPDATE SET sponsor=excluded.sponsor,sponsor_session=excluded.sponsor_session,price_usd=excluded.price_usd,purchased_at=excluded.purchased_at,sponsor_x=excluded.sponsor_x`).run(cc, sponsor, payment.session_id, expected, xh);
      db.prepare('INSERT INTO anthem_purchases (country_code,sponsor,payment_id,amount_usd,sponsor_x) VALUES (?,?,?,?,?)').run(cc, sponsor, payment.id, expected, xh);
      if (prev && prev.sponsor) db.prepare('INSERT INTO anthem_history (country_code,sponsor,event) VALUES (?,?,?)').run(cc, prev.sponsor, 'replaced');
      db.prepare('INSERT INTO anthem_history (country_code,sponsor,event) VALUES (?,?,?)').run(cc, sponsor, 'purchased');
      db.prepare(`UPDATE payments SET status='succeeded',fulfilled_at=?,fulfillment_key=?,verified_at=?,verified_by=? WHERE id=? AND status='pending_verification'`).run(now, fulfillmentKey, now, String(adminId || 'admin'), payment.id);
      return { ok: true, kind: 'anthem', country: cc, sponsor, paymentId: payment.id };
    }
    return { error: 'unsupported_payment_kind' };
  })();

  if (result.ok) {
    const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId);
    if (result.kind === 'ad') core.pushActivity('ad', `📢 ${result.advertiser} took over the ${result.slotId.replace('-', ' ')} ad space`, null, null);
    else if (result.kind === 'anthem') { const cname = (db.prepare('SELECT name FROM countries WHERE code=?').get(result.country) || {}).name || result.country; core.pushActivity('anthem', `${core.FLAG(result.country)} ${result.sponsor} took over ${cname}'s national anthem`, result.country, null); }
    return { ...result, payment };
  }
  return result;
}

function rejectPayment(paymentId, adminId, reason) {
  const cleanReason = String(reason || '').trim().slice(0, 500); if (!cleanReason) return { error: 'rejection_reason_required' };
  const payment = db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId); if (!payment) return { error: 'payment_not_found' };
  const meta = readMeta(payment); meta.rejectionReason = cleanReason; meta.rejectedAt = new Date().toISOString();
  const result = db.prepare(`UPDATE payments SET status='rejected',verified_at=?,verified_by=?,meta=? WHERE id=? AND status='pending_verification'`).run(new Date().toISOString(), String(adminId || 'admin'), JSON.stringify(meta), paymentId);
  if (!result.changes) return { error: 'payment_not_pending' };
  return { ok: true, payment: db.prepare('SELECT * FROM payments WHERE id=?').get(paymentId) };
}

module.exports = { fulfillPayment, rejectPayment };
