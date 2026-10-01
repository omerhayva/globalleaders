/* Payment review UI: on-chain verification for crypto, webhook activation for cards. */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const api = (url, opts) => fetch('/api/admin' + url, opts ? { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined } : undefined).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw j; return j; });
  const money = n => `$${Number(n || 0).toFixed(2)}`;
  const when = s => s ? String(s).replace('T', ' ').slice(0, 16) : '—';

  const CHAIN_LABEL = {
    verified: ['✅', 'On-chain doğrulandı', 'ok'],
    confirmed: ['✅', 'Zincirde görüldü', 'ok'],
    not_checked: ['⏳', 'Henüz kontrol edilmedi', 'warn'],
    not_found: ['⛔', 'Zincirde bulunamadı', 'bad'],
    transfer_not_found: ['⛔', 'Cüzdana transfer yok', 'bad'],
    pending_confirmation: ['⏳', 'Onay bekliyor (blok)', 'warn'],
    wrong_recipient: ['⛔', 'Yanlış cüzdan', 'bad'],
    wrong_asset: ['⛔', 'Yanlış token/ağ', 'bad'],
    amount_too_low: ['⚠️', 'Tutar eksik', 'bad'],
    network_error: ['⚠️', 'RPC hatası (tekrar denenebilir)', 'warn'],
    unsupported_network: ['⚠️', 'Desteklenmeyen ağ', 'bad'],
    paid_webhook: ['✅', 'Stripe webhook ile doğrulandı', 'ok'],
    webhook_wait: ['⏳', 'Stripe webhook bekleniyor', 'warn'],
    failed: ['⛔', 'Ödeme başarısız', 'bad'],
    rejected: ['⛔', 'Ödeme reddedildi', 'bad']
  };
  function chainCell(p) {
    const [icon, text, cls] = CHAIN_LABEL[p.chainStatus] || ['·', esc(p.chainStatus || '—'), 'warn'];
    return `<span class="chain-${cls}">${icon} ${esc(text)}</span>${p.chainCheckedAt ? `<br><span class="muted small">${when(p.chainCheckedAt)}</span>` : ''}`;
  }

  function cleanProductionUI() {
    document.querySelectorAll('.login-box p').forEach(el => { if (/Demo default password|leaders2026/i.test(el.textContent)) el.remove(); });
    const main = $('#main'); if (!main) return;
    main.querySelectorAll('[data-t="simulator_enabled"],[data-demo]').forEach(el => el.closest('.field')?.remove());
    main.querySelectorAll('.panel').forEach(panel => { if (/DEMO DATA TOOLS|MockPaymentProvider active/i.test(panel.textContent)) panel.remove(); });
    main.querySelectorAll('.field').forEach(field => { if (/ADMIN PASSWORD/i.test(field.textContent)) field.remove(); });
    main.querySelectorAll('p').forEach(p => { if (/Provider architecture:.*MockPaymentProvider/i.test(p.textContent)) p.textContent = 'Ödeme: kripto cüzdan transferi (zincir üstü otomatik doğrulama) veya Stripe kart ödemesi (webhook ile otomatik aktivasyon).'; });
  }

  function injectNav() {
    const side = $('.admin-side');
    if (!side || $('[data-crypto-nav]')) return;
    const b = document.createElement('button'); b.className = 'navbtn'; b.dataset.cryptoNav = '1'; b.textContent = '💳 Payments & On-chain'; b.onclick = render;
    side.insertBefore(b, side.querySelector('[onclick*="location.href"]') || null);
  }

  async function render() {
    const main = $('#main'); if (!main) return;
    document.querySelectorAll('.navbtn').forEach(b => b.classList.remove('active'));
    const nav = $('[data-crypto-nav]'); if (nav) nav.classList.add('active');
    main.innerHTML = '<p class="muted">Ödemeler yükleniyor…</p>';
    let data;
    try { data = await api('/payments'); }
    catch (err) { main.innerHTML = `<div class="panel"><p class="muted">Ödemeler alınamadı: ${esc(err.error || err.message || 'failed')}</p></div>`; return; }
    const rows = Array.isArray(data) ? data : (data.payments || []);
    const wallet = data.wallet || {};
    const attn = rows.filter(p => (p.method === 'crypto' && p.status === 'pending_verification') || p.status === 'paid');

    main.innerHTML = `
      <div class="panel" style="margin-bottom:1rem">
        <h2>💳 ÖDEME DOĞRULAMA</h2>
        <p class="muted small">Kripto ödemesi <b>zincirde kanıtlanmadan</b> aktifleştirilmez: “🔗 Zincirde kontrol et” düğmesi işlem hash’ini TRON ağında arar (varlık, ağ, alıcı cüzdan ve tutar birebir eşleşmeli). Kart ödemeleri Stripe webhook’u ile otomatik onaylanır, burada yalnızca durumunu görürsünüz.</p>
        <p class="small">
          Kripto cüzdan: <b>${wallet.address ? esc(wallet.address) : '⚠️ CRYPTO_WALLET_ADDRESS tanımlı değil'}</b> · ${esc(wallet.asset || 'USDT')}/${esc(wallet.network || 'TRC20')} ·
          Otomatik doğrulama: <b>${wallet.autoVerify ? 'AÇIK (hash girilince zincir kontrol edilir)' : 'kapalı (elle “Zincirde kontrol et”)'}</b> ·
          Kart sağlayıcı: <b>${data.cardConfigured ? 'Stripe bağlı' : '⚠️ STRIPE_SECRET_KEY tanımlı değil'}</b>
        </p>
      </div>
      <div class="panel">
        <h2>AKSİYON BEKLEYENLER (${attn.length})</h2>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>#</th><th>Yöntem</th><th>Ürün</th><th>Tutar</th><th>Durum</th><th>Zincir kontrolü</th><th>İşlem (TX)</th><th>Alıcı</th><th></th></tr></thead>
          <tbody>${attn.length ? attn.map(p => {
            const m = (() => { try { return p.meta ? JSON.parse(p.meta) : {}; } catch { return {}; } })();
            const tx = p.tx_hash || m.txHash || '';
            const isCard = p.method === 'card';
            const actions = isCard
              ? `<button class="btn btn-vote small" data-activate="${p.id}" data-paid="${p.status === 'paid' ? '1' : '0'}">${p.status === 'paid' ? 'AKTİFLEŞTİR' : 'ELLE AKTİFLEŞTİR'}</button> <button class="btn btn-ghost small" data-reject="${p.id}">REDDET</button>`
              : `<button class="btn btn-vote small" data-check="${p.id}">🔗 ZİNCİRDE KONTROL ET</button> <button class="btn btn-ghost small" data-manual="${p.id}" data-amount="${p.amount_usd}">ELLE ONAYLA</button> <button class="btn btn-ghost small" data-reject="${p.id}">REDDET</button>`;
            const txCell = tx ? (/^[0-9a-fA-F]{64}$/.test(tx) && p.explorerUrl ? `<a href="${esc(p.explorerUrl)}" target="_blank" rel="noopener" class="muted small">${esc(tx.slice(0, 18))}…(explorer)</a>` : `<code class="small">${esc(String(tx).slice(0, 28))}${String(tx).length > 28 ? '…' : ''}</code>`) : '<span class="muted">—</span>';
            return `<tr><td>${p.id}</td><td>${isCard ? '💳 Kart' : '🪙 Kripto'}</td><td>${esc(p.kind)}<br><span class="muted small">${esc(p.reference || '')}</span></td><td><b>${money(p.amount_usd)}</b></td><td><code>${esc(p.status)}</code></td><td>${chainCell(p)}</td><td>${txCell}</td><td>${esc(m.advertiser || m.sponsor || '—')}${m.x_handle ? ` · @${esc(m.x_handle)}` : ''}${p.session_id ? `<br><span class="muted small">${esc(String(p.session_id).slice(0, 10))}…</span>` : ''}</td><td class="rowbtns">${actions}</td></tr>`;
          }).join('') : '<tr><td colspan="9" class="muted">Aksiyon bekleyen ödeme yok.</td></tr>'}</tbody>
        </table></div>
        <p class="muted small" style="margin-top:.6rem">“Elle onayla” yalnızca zincir kaydı yokken kullanılır ve bir gerekçe yazmanızı şart koşar; gerekçe denetim kaydına işlenir.</p>
      </div>`;

    main.onclick = async e => {
      const check = e.target.closest('[data-check]');
      if (check) {
        check.disabled = true; check.textContent = '⏳ Zincir taranıyor…';
        try {
          const r = await api(`/payments/${check.dataset.check}/check-chain`, { method: 'POST' });
          if (r.ok) alert(r.activated ? '✅ Para cüzdana ulaştı ve satın alma aktifleştirildi.' : `✅ Zincirde doğrulandı: ${r.message}`);
          else alert(`Doğrulanamadı (${r.reason}): ${r.message}`);
        } catch (err) { alert(err.error || err.message || 'Zincir kontrolü başarısız.'); }
        render(); return;
      }
      const manual = e.target.closest('[data-manual]');
      if (manual) {
        const amount = prompt('Cüzdanda gördüğünüz tutar (USDT) — sipariş tutarıyla birebir eşleşmeli:', manual.dataset.amount);
        if (amount === null) return;
        const note = prompt('Zincir kaydı yok. Elle onay gerekçesi (örn. “cüzdanda gördüm, tx 3f2a…”):', '');
        if (!note) return;
        try { await api(`/payments/${manual.dataset.manual}/verify`, { method: 'POST', body: { amount, note } }); alert('Elle onaylandı ve aktifleştirildi.'); }
        catch (err) {
          if (err.error === 'reason_required') alert('Gerekçe zorunlu (en az 3 karakter).');
          else if (err.error === 'amount_mismatch') alert(`Tutar uyuşmuyor. Beklenen ${err.expected}, girilen ${err.received ?? 'bilinmiyor'}.`);
          else alert(err.error || 'Onay başarısız.');
        }
        render(); return;
      }
      const activate = e.target.closest('[data-activate]');
      if (activate) {
        const paidByWebhook = activate.dataset.paid === '1';
        if (paidByWebhook) {
          if (!confirm('Bu kart ödemesi Stripe webhook’u ile doğrulandı. Satın alma aktifleştirilsin mi?')) return;
          try { await api(`/payments/${activate.dataset.activate}/verify`, { method: 'POST', body: {} }); alert('Aktifleştirildi.'); }
          catch (err) { alert(err.error || 'Aktifleştirme başarısız.'); }
        } else {
          const note = prompt('Bu kart ödemesi için henüz webhook gelmedi. Stripe panelinde ödemeyi gördüyseniz kısa bir not yazın:', '');
          if (!note) return;
          try { await api(`/payments/${activate.dataset.activate}/verify`, { method: 'POST', body: { note } }); alert('Elle aktifleştirildi (not denetim kaydına işlendi).'); }
          catch (err) { alert(err.error === 'reason_required' ? 'Önce Stripe panelinden ödemeyi doğrulayıp bir not yazmalısınız.' : (err.error || 'Aktifleştirme başarısız.')); }
        }
        render(); return;
      }
      const r = e.target.closest('[data-reject]');
      if (r) {
        const reason = prompt('Red gerekçesi (zorunlu):');
        if (!reason) return;
        try { await api(`/payments/${r.dataset.reject}/reject`, { method: 'POST', body: { reason } }); alert('Reddedildi.'); }
        catch (err) { alert(err.error || 'Red işlemi başarısız.'); }
        render(); return;
      }
    };
  }

  const observer = new MutationObserver(() => { injectNav(); cleanProductionUI(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  injectNav(); cleanProductionUI();
})();
