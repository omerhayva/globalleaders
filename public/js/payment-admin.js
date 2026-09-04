/* Cold-wallet payment review UI and production admin cleanup. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const api = (url, opts) => fetch('/api/admin' + url, opts ? { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined } : undefined).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw j; return j; });
  const money = n => `$${Number(n || 0).toFixed(2)}`;
  const meta = p => { try { return p.meta ? JSON.parse(p.meta) : {}; } catch { return {}; } };

  function cleanProductionUI() {
    document.querySelectorAll('.login-box p').forEach(el => { if (/Demo default password|leaders2026/i.test(el.textContent)) el.remove(); });
    const main = $('#main'); if (!main) return;
    main.querySelectorAll('[data-t="simulator_enabled"],[data-demo]').forEach(el => el.closest('.field')?.remove());
    main.querySelectorAll('.panel').forEach(panel => { if (/DEMO DATA TOOLS|MockPaymentProvider active/i.test(panel.textContent)) panel.remove(); });
    main.querySelectorAll('.field').forEach(field => { if (/ADMIN PASSWORD/i.test(field.textContent)) field.remove(); });
    main.querySelectorAll('p').forEach(p => { if (/Provider architecture:.*MockPaymentProvider/i.test(p.textContent)) p.textContent = 'Production checkout: direct cold-wallet USDT transfer with manual blockchain verification.'; });
  }

  function injectNav() {
    const side = $('.admin-side');
    if (!side || $('[data-crypto-nav]')) return;
    const b = document.createElement('button'); b.className = 'navbtn'; b.dataset.cryptoNav = '1'; b.textContent = '🔐 Crypto Verification'; b.onclick = render;
    side.insertBefore(b, side.querySelector('[onclick*="location.href"]') || null);
  }

  async function render() {
    const main = $('#main'); if (!main) return;
    document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
    const nav = $('[data-crypto-nav]'); if (nav) nav.classList.add('active');
    main.innerHTML = '<p class="muted">Loading crypto payments…</p>';
    try {
      const rows = await api('/payments');
      const pending = rows.filter(p => p.provider === 'cold_wallet' && p.status === 'pending_verification');
      main.innerHTML = `<div class="panel" style="margin-bottom:1rem"><h2>🔐 COLD-WALLET VERIFICATION</h2><p class="muted small">Check the transaction on the correct blockchain explorer before approving. The amount must exactly match the order. Approval is atomic and cannot credit the same payment twice.</p></div><div class="panel"><h2>PENDING PAYMENTS (${pending.length})</h2><div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Type</th><th>Reference</th><th>Expected</th><th>TX HASH</th><th>Buyer data</th><th>Actions</th></tr></thead><tbody>${pending.length ? pending.map(p => { const m = meta(p); return `<tr><td>${p.id}</td><td>${esc(p.kind)}</td><td>${esc(p.reference)}</td><td><b>${money(p.amount_usd)} USDT</b></td><td style="max-width:280px;word-break:break-all"><code>${esc(p.tx_hash || m.txHash || '')}</code></td><td>${esc(m.advertiser || m.sponsor || '—')}${m.x_handle ? ` · @${esc(m.x_handle)}` : ''}${m.url ? `<br><span class="muted">${esc(m.url)}</span>` : ''}</td><td class="rowbtns"><button class="btn btn-vote small" data-verify="${p.id}" data-amount="${p.amount_usd}">VERIFY & ACTIVATE</button><button class="btn btn-ghost small" data-reject="${p.id}">REJECT</button></td></tr>`; }).join('') : '<tr><td colspan="7" class="muted">No payments waiting for verification.</td></tr>'}</tbody></table></div></div>`;
      main.onclick = async e => {
        const v = e.target.closest('[data-verify]');
        if (v) { const id = v.dataset.verify; const amount = prompt(`Confirm received amount in USDT for payment #${id}:`, v.dataset.amount); if (amount === null) return; try { await api(`/payments/${id}/verify`, { method: 'POST', body: { amount } }); alert('Payment verified and activated.'); render(); } catch (err) { alert(err.error === 'amount_mismatch' ? `Amount mismatch. Expected ${err.expected} USDT, received ${err.received ?? 'unknown'}.` : (err.error || 'Verification failed.')); } }
        const r = e.target.closest('[data-reject]');
        if (r) { const reason = prompt('Rejection reason (required):'); if (!reason) return; try { await api(`/payments/${r.dataset.reject}/reject`, { method: 'POST', body: { reason } }); alert('Payment rejected.'); render(); } catch (err) { alert(err.error || 'Rejection failed.'); } }
      };
    } catch (err) { main.innerHTML = `<div class="panel"><p class="muted">Could not load payments: ${esc(err.error || err.message || 'failed')}</p></div>`; }
  }

  const observer = new MutationObserver(() => { injectNav(); cleanProductionUI(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectNav(); cleanProductionUI();
})();
