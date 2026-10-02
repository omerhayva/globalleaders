import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../useStore.jsx';
import { actions, getState } from '../store.js';
import { api, esc, num } from '../api.js';

export function ModalHost() {
  const st = useStore();
  useEffect(() => {
    if (!st.modal) return;
    const h = e => { if (e.key === 'Escape') actions.closeModal(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [st.modal]);
  const host = document.getElementById('modals');
  if (!host || !st.modal) return null;
  const M = MODALS[st.modal.type];
  return createPortal(
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) actions.closeModal(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <button className="close" aria-label="Close" onClick={() => actions.closeModal()}>×</button>
        {M ? <M {...st.modal.props} /> : null}
      </div>
    </div>,
    host
  );
}

// Tek satırlık "kopyala" satırı — adres ve tutar için ortak kullanılır.
function CopyRow({ label, value, copyValue, mono = true }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(copyValue ?? value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { actions.toast('Copy failed — please select the text manually.', 'error'); }
  };
  return (
    <div className="pay-line">
      <div className="pay-line-text">
        <span className="pay-label">{label}</span>
        <b className={mono ? 'pay-mono' : ''}>{value}</b>
      </div>
      <button type="button" className="btn btn-ghost small" onClick={copy} disabled={!value} aria-label={`Copy ${label.toLowerCase()}`}>{copied ? '✓' : 'COPY'}</button>
    </div>
  );
}

// Sade 3 adımlı ödeme kutusu: tutar → adres → işlem hash'i.
function PayBox({ intent, onSubmit, busy, note = 'Your purchase is activated after the transfer is verified.' }) {
  const [txHash, setTxHash] = useState('');
  const wallet = intent.wallet || {};
  const valid = /^[A-Za-z0-9:_-]{20,180}$/.test(txHash.trim());
  return (
    <div className="paybox">
      <p className="pay-step"><i>1</i> Send this exact amount</p>
      <CopyRow label={`AMOUNT · ${wallet.asset || 'USDT'} (${wallet.network || '—'})`} value={intent.cryptoAmountDisplay || '—'} copyValue={intent.cryptoAmount} mono={false} />
      <p className="pay-step"><i>2</i> To this wallet</p>
      <CopyRow label={`WALLET ADDRESS · ${wallet.network || '—'}`} value={wallet.address || 'Wallet is not configured'} />
      <p className="pay-note">Send only {wallet.asset || 'USDT'} on {wallet.network || 'the stated network'} — another network can lose the funds.</p>
      <p className="pay-step"><i>3</i> Paste the transaction hash</p>
      <div className="field"><input value={txHash} onChange={e => setTxHash(e.target.value.trim())} maxLength="180" placeholder="Transaction hash (txid)" autoComplete="off" aria-label="Transaction hash" /></div>
      <button className="btn btn-gold big" style={{ width: '100%' }} disabled={busy || !valid} onClick={() => onSubmit(txHash.trim())}>{busy ? 'SENDING…' : 'SEND FOR VERIFICATION'}</button>
      <p className="pay-note center">{note}</p>
    </div>
  );
}

// Ödeme durumu: "bildirildi → doğrulanıyor → aktifleşti" zincirini gösterir ve
// sunucuyu yoklar; kullanıcı parayı gönderdikten sonra ne olduğunu görebilir.
function PayDone({ intentId, note }) {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    if (!intentId) return;
    let alive = true;
    const tick = () => api('/api/purchase/status?intent=' + encodeURIComponent(intentId)).then(r => { if (alive) setStatus(r); }).catch(() => { });
    tick(); const t = setInterval(tick, 6000);
    return () => { alive = false; clearInterval(t); };
  }, [intentId]);
  const st = status ? status.status : 'pending_verification';
  const icon = st === 'succeeded' ? '✅' : st === 'rejected' || st === 'failed' ? '⚠️' : st === 'paid' ? '💳' : '⏳';
  const title = st === 'succeeded' ? 'Payment confirmed — activated!' : st === 'rejected' || st === 'failed' ? 'Payment problem' : st === 'paid' ? 'Card payment received' : 'Payment submitted';
  const msg = (status && status.message) || note;
  if (st === 'succeeded') { setTimeout(() => { actions.closeModal(); if (status && status.kind !== 'votes') location.reload(); }, 1500); }
  return (
    <div className="center paydone">
      <h3>{icon} {title}</h3>
      <p className="muted small">{msg}</p>
      {status && status.explorerUrl ? <p className="muted small"><a href={status.explorerUrl} target="_blank" rel="noopener">View transaction on the explorer ↗</a></p> : null}
      <p className="muted small">You can close this window — activation is automatic once the payment is confirmed.</p>
      <button className="btn btn-ghost" onClick={() => actions.closeModal()}>DONE</button>
    </div>
  );
}

// Ödeme başlatılamadığında gösterilen sade uyarı (modal kapanmaz, denenebilir).
function PayError({ message, onRetry }) {
  return (
    <div className="paybox">
      <p className="pay-note" role="alert">⚠️ {message || 'Checkout could not be started.'}</p>
      <button className="btn btn-ghost" style={{ width: '100%' }} onClick={onRetry}>TRY AGAIN</button>
    </div>
  );
}

// Kullanıcı ödeme yöntemini seçer. Yalnızca tek yöntem yapılandırılmışsa
// seçim gizlenir ve akış sade kalır.
function MethodChoice({ availability, method, onPick }) {
  if (!availability) return null;
  const crypto = availability.crypto && availability.crypto.enabled;
  const card = availability.card && availability.card.enabled;
  if (!(crypto && card)) return null;
  return (
    <div className="pay-method" role="group" aria-label="Payment method">
      <button type="button" className={'pay-method-btn' + (method === 'crypto' ? ' sel' : '')} onClick={() => onPick('crypto')}>🪙 {availability.crypto.label || 'Crypto'}<span>USDT · TRC20 transfer</span></button>
      <button type="button" className={'pay-method-btn' + (method === 'card' ? ' sel' : '')} onClick={() => onPick('card')}>💳 {availability.card.label}<span>Visa · Mastercard · Stripe</span></button>
    </div>
  );
}

// Kart yolu: tek düğme — güvenli Stripe sayfasına yönlendirir, sonrası otomatik.
function CardBox({ intent, beforeRedirect }) {
  const [going, setGoing] = useState(false);
  const url = intent.clientAction && intent.clientAction.url;
  const go = async () => {
    if (!url) return;
    if (beforeRedirect) { setGoing(true); let ok = false; try { ok = await beforeRedirect(); } catch { ok = false; } if (!ok) { setGoing(false); return; } }
    else setGoing(true);
    window.location.href = url;
  };
  return (
    <div className="paybox">
      <p className="pay-step"><i>1</i> Pay by card</p>
      <p className="pay-note">Kart bilgileriniz Global Leaders Live sunucularına hiç girmez; ödeme Stripe’ın güvenli sayfasında alınır. Ödeme onaylandığında satın alma <b>otomatik</b> aktifleşir.</p>
      <button className="btn btn-gold big" style={{ width: '100%' }} disabled={going || !url} onClick={go}>{going ? 'YÖNLENDİRİLİYOR…' : '💳 GO TO SECURE CARD PAYMENT'}</button>
      <p className="pay-note center">Kart bilgileri Stripe tarafından işlenir (PCI-DSS).</p>
    </div>
  );
}

// Demo modda (mock sağlayıcı) tek düğmeyle tamamlanan akış.
function DemoBox({ intent, onSubmit, busy }) {
  return (
    <div className="paybox">
      <p className="pay-note">Demo mod: gerçek bir tahsilat yapılmaz.</p>
      <button className="btn btn-gold big" style={{ width: '100%' }} disabled={busy} onClick={() => onSubmit('')}>{busy ? '…' : 'COMPLETE DEMO PURCHASE'}</button>
    </div>
  );
}

// Stripe’dan dönüşte (?payment=success&intent=...) açılan durum penceresi.
export function PaymentStatusModal({ intentId }) {
  return <PayDone intentId={intentId} note="Kart ödemesi alındıysa satın alma birkaç saniye içinde otomatik aktifleşir." />;
}

// Ödeme sayfasından dönüş: ?payment=success|cancelled&intent=... adresini okur
// ve durum modalını açar. Kart ödemesinde aktivasyon webhook ile gelir.
export function PaymentReturnWatcher() {
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const flag = q.get('payment'); const intent = q.get('intent');
    if (!flag || !intent) return;
    const clean = () => { const u = new URL(location.href); u.searchParams.delete('payment'); u.searchParams.delete('intent'); history.replaceState({}, '', u.toString()); };
    if (flag === 'success') { actions.openModal('paymentStatus', { intentId: intent }); }
    else if (flag === 'cancelled') { actions.toast('Card payment cancelled — no charge was made.', 'error'); }
    clean();
  }, []);
  return null;
}

const VOTE_ERR = { no_votes_left: 'You used your free vote today. Share for +1 or buy a pack!', too_fast: 'Whoa — slow down a little ⏱', daily_cap: 'Daily voting limit reached for your network.', device_limit: 'Daily free-vote limit reached for this device. Share for +1 or buy a pack!', suspended: 'Voting temporarily suspended for suspicious activity.', captcha_required: 'Too much activity — please try again later.', rate_limited: 'Too many requests — please slow down.', idempotency_key_required: 'Vote could not be sent — please try again.' };
// The vote endpoint requires an Idempotency-Key (16–128 chars) so a retried
// request can never double-count a vote. The key must come from the client.
const idemKey = () => {
  try { if (globalThis.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID().replace(/-/g, ''); } catch { }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
};
function emotionalToast(leader, r) { if (r.oldRank && r.newRank < r.oldRank) actions.toast(`🔥 Your vote moved <b>${esc(leader.name)}</b> from #${r.oldRank} → <b>#${r.newRank}</b>!`, 'epic', 5200); else if (r.newRank === 1) actions.toast(`👑 <b>${esc(leader.name)}</b> is holding <b>#1</b> — powered by your vote!`, 'epic', 5000); else actions.toast(`✅ +${r.count} for <b>${esc(leader.name)}</b> · now ${num(r.totalVotes)} votes at #${r.newRank}. ${r.remaining > 0 ? `You have ${r.remaining} vote${r.remaining > 1 ? 's' : ''} left.` : 'Out of votes — share for +1 or grab a pack!'}`, 'success', 5000); }
function OutOfVotesBody({ slug, reason }) {
  const device = reason === 'device_limit';
  return <>
    <h3>{device ? "Today's free vote is used on this device 😱" : "You're out of votes 😱"}</h3>
    <p className="muted small">{device ? <>Each device gets <b>1 free vote per day</b>. Get more right now:</> : <>You get <b>1 free vote per day</b>. Get more right now:</>}</p>
    <p className="muted small">⭐ Supporters get <b>5 free votes every day</b> and see no ads — <button className="link" onClick={() => actions.openModal('supporter')}>become a supporter</button>.</p>
    <div className="pack-grid" style={{ gridTemplateColumns: '1fr' }}>
      <button className="pack" onClick={() => actions.openModal('share', { slug, wantBonus: true })}><b>🎁 +1 VOTE</b><span>Share a leader (max 3/day)</span><span className="price">FREE</span></button>
      <button className="pack" onClick={() => actions.openModal('buyvotes')}><b>⚡ VOTE PACKS</b><span>10 / 60 / 250 votes</span><span className="price">from $5</span></button>
    </div>
  </>;
}

export function VoteModal({ slug, reason }) {
  const st = useStore(); const [leader, setLeader] = useState(null); const [n, setN] = useState(1); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/leader/' + slug).then(setLeader).catch(() => { actions.toast('Leader not found', 'error'); actions.closeModal(); }); }, [slug]);
  if (!leader) return <p className="muted small center">Loading…</p>;
  const max = Math.max(0, st.session.remaining ?? 1); if (max === 0) return <OutOfVotesBody slug={slug} reason={reason} />;
  // Hatada: sunucu "remaining" döndürdüyse sayaç gerçeğe çekilir (üst çubuk yanlış
  // vaatte bulunmasın); oy hakkı bittiyse kullanıcı paylaş/satın al seçeneklerine
  // yönlendirilir — aksi halde sadece bir toast görüp çıkışsız kalıyordu.
  const go = async () => { setBusy(true); try { const r = await api('/api/vote', { method: 'POST', body: { slug, count: n }, headers: { 'Idempotency-Key': idemKey() } }); actions.setSession(r); api('/api/my-votes').then(actions.setMyVotes).catch(() => { }); actions.closeModal(); actions.confetti(); emotionalToast(leader, r); actions.flashLeader(slug); setTimeout(() => actions.openModal('share', { slug, wantBonus: st.session.remaining === 0, afterVote: true }), 1600); } catch (err) { actions.closeModal(); actions.toast(VOTE_ERR[err.error] || 'Vote failed. Try again.', 'error'); if (err && typeof err.remaining === 'number') actions.setSession(err); if (err.error === 'no_votes_left' || err.error === 'device_limit') actions.openModal('vote', { slug, reason: err.error }); } };
  return <div><h3>Vote for {leader.flag} {leader.name}</h3><p className="muted small">#{leader.rank} · {num(leader.total_votes)} votes · You have {max} vote{max > 1 ? 's' : ''} available</p><div className="lb-power" aria-hidden="true"><i style={{ '--w': Math.max(5, leader.pct) + '%' }}></i></div><p className="muted small center" style={{ margin: '.2rem 0 .6rem' }}>{leader.pct}% of all community votes</p>{max > 1 ? <div className="vote-spinner"><button aria-label="Fewer votes" onClick={() => setN(v => Math.max(1, v - 1))}>−</button><span className="vote-count">{n}</span><button aria-label="More votes" onClick={() => setN(v => Math.min(max, v + 1))}>+</button></div> : <div style={{ height: '0.8rem' }}></div>}<button className="btn btn-vote big" style={{ width: '100%' }} disabled={busy} onClick={go}>CAST {n} VOTE{n > 1 ? 'S' : ''}</button><p className="muted small center" style={{ marginTop: '.6rem' }}>1 free vote per day · earn more by sharing (+1) or <button className="x-link" style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }} onClick={() => actions.openModal('buyvotes')}>buy vote packs</button></p></div>;
}

export function BuyVotesModal() {
  const [pack, setPack] = useState('votes-10'); const [method, setMethod] = useState(null); const [availability, setAvailability] = useState(null);
  const [intent, setIntent] = useState(null); const [busy, setBusy] = useState(false); const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState(null); const [retry, setRetry] = useState(0);
  useEffect(() => { api('/api/payment-methods').then(a => { setAvailability(a); setMethod(a.crypto && a.crypto.enabled ? 'crypto' : (a.card && a.card.enabled ? 'card' : 'crypto')); }).catch(() => setMethod('crypto')); }, []);
  const go = async txHash => { setBusy(true); try { const r = await api('/api/purchase/confirm', { method: 'POST', body: { intentId: intent.intentId, details: { txHash } } }); if (r.status === 'pending_verification') { setSubmitted(true); setBusy(false); return; } const st0 = getState(); actions.setSession({ remaining: r.remaining, purchased: (st0.session.purchased || 0) + r.votesAdded }); actions.closeModal(); actions.toast(`⚡ <b>+${r.votesAdded} votes</b> added!`, 'epic', 5500); } catch (e) { actions.toast(e.error || 'Payment submission failed', 'error'); setBusy(false); } };
  useEffect(() => { if (!method) return; setIntent(null); setSubmitted(false); setError(null); api('/api/purchase/intent', { method: 'POST', body: { kind: 'votes', reference: pack, method } }).then(setIntent).catch(e => setError(e && (e.message || e.error) || 'Checkout failed')); }, [pack, method, retry]);
  if (submitted) return <PayDone intentId={intent && intent.intentId} note="Your vote pack is credited right after the transfer is verified." />;
  const isCard = !!(intent && intent.paymentMethod === 'card');
  return <div><h3>⚡ Buy vote packs</h3><p className="muted small">Pick a pack and pay by crypto or card — votes arrive after the payment is confirmed.</p><div className="pack-grid three"><button className={'pack' + (pack === 'votes-10' ? ' sel' : '')} onClick={() => setPack('votes-10')}><b>10</b><span>VOTES</span><span className="price">$5.00</span></button><button className={'pack' + (pack === 'votes-60' ? ' sel' : '')} onClick={() => setPack('votes-60')}><b>60</b><span>VOTES</span><span className="price">$20.00</span><em className="pack-note">33¢ / vote</em></button><button className={'pack' + (pack === 'votes-250' ? ' sel' : '')} onClick={() => setPack('votes-250')}><b>250</b><span>VOTES</span><span className="price">$50.00</span><em className="pack-note">20¢ / vote — best value</em></button></div>
        <div className="supporter-teaser">
          <div><b>⭐ Supporter membership — $4.99/month</b><p className="muted small" style={{ margin: '0.2rem 0 0' }}>5 free votes every day, no ads, supporter badge. Cancel anytime.</p></div>
          <button className="btn btn-gold small" onClick={() => actions.openModal('supporter')}>BECOME A SUPPORTER</button>
        </div><MethodChoice availability={availability} method={method} onPick={setMethod} />{error ? <PayError message={error} onRetry={() => setRetry(r => r + 1)} /> : (!intent ? <p className="muted small center paybox">Preparing checkout…</p> : (isCard ? <CardBox intent={intent} /> : (intent.clientAction && intent.clientAction.type === 'demo_confirm' ? <DemoBox intent={intent} onSubmit={go} busy={busy} /> : <PayBox intent={intent} onSubmit={go} busy={busy} note="Votes are credited right after the transfer is verified." />)))}</div>;
}

export function ShareModal({ slug, wantBonus = false, afterVote = false }) {
  const [leader, setLeader] = useState(null); useEffect(() => { api('/api/leader/' + slug).then(setLeader).catch(() => actions.closeModal()); }, [slug]); if (!leader) return <p className="muted small center">Loading…</p>;
  const text = `${leader.flag} ${leader.name} is currently #${leader.rank} in Global Leaders Live with ${num(leader.total_votes)} votes. Do you agree? Vote now.`;
  const platforms = [['whatsapp', '💬', 'WhatsApp', u => `https://wa.me/?text=${encodeURIComponent(text + ' ' + u)}`],['x', '𝕏', 'X', u => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(u)}`],['facebook', '📘', 'Facebook', u => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`],['telegram', '✈️', 'Telegram', u => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(text)}`],['reddit', '🤖', 'Reddit', u => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(text)}`],['copy', '🔗', 'Copy Link', null]];
  const doShare = async platform => { try { const r = await api('/api/share', { method: 'POST', body: { slug, platform } }); const url = location.origin + r.shareUrl; if (platform === 'copy') { await navigator.clipboard.writeText(text + ' ' + url).catch(() => { }); actions.toast('🔗 Link copied!', 'success'); } else if (platform === 'native' && navigator.share) navigator.share({ title: 'Global Leaders Live', text, url }).catch(() => { }); else { const p = platforms.find(x => x[0] === platform); if (p && p[3]) window.open(p[3](url), '_blank', 'noopener,width=640,height=560'); } if (r.bonusAwarded) { actions.setSession(r); setTimeout(() => actions.toast('🎁 <b>+1 BONUS VOTE</b> earned for sharing!', 'epic'), 700); } else setTimeout(() => actions.toast('Thanks for sharing! (Daily bonus limit reached)', ''), 700); actions.closeModal(); } catch { actions.toast('Share failed, try again', 'error'); } };
  return <div>{afterVote || wantBonus ? <><h3>Want 1 MORE vote? 🎁</h3><p className="muted small">Share {leader.name} and get <b>+1 bonus vote</b> instantly (max 3/day).</p></> : <><h3>Share {leader.name}</h3><p className="muted small">Every share can earn you +1 bonus vote.</p></>}<div className="terms-box" style={{ textAlign: 'center' }}><div style={{ fontSize: '1.6rem' }}>{leader.flag}</div><b>{leader.name}</b> · #{leader.rank} · {num(leader.total_votes)} votes<br /><span className="muted">"Do you agree? Vote now."</span></div><div className="share-grid">{platforms.map(([id, ico, label]) => <button key={id} className="share-btn" onClick={() => doShare(id)}><span className="ico">{ico}</span>{label}</button>)}</div>{navigator.share ? <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => doShare('native')}>📲 More share options…</button> : null}</div>;
}

export function CheckoutModal({ kind, reference }) {
  const [method, setMethod] = useState(null); const [availability, setAvailability] = useState(null);
  const [intent, setIntent] = useState(null); const [busy, setBusy] = useState(false); const [submitted, setSubmitted] = useState(false); const rootRef = useRef(null);
  const [error, setError] = useState(null); const [retry, setRetry] = useState(0);
  useEffect(() => { api('/api/payment-methods').then(a => { setAvailability(a); setMethod(a.crypto && a.crypto.enabled ? 'crypto' : (a.card && a.card.enabled ? 'card' : 'crypto')); }).catch(() => setMethod('crypto')); }, []);
  useEffect(() => { if (!method) return; setIntent(null); setSubmitted(false); setError(null); api('/api/purchase/intent', { method: 'POST', body: { kind, reference, method } }).then(setIntent).catch(e => setError(e && (e.message || e.error) || 'Checkout failed')); }, [kind, reference, method, retry]);
  if (submitted) return <PayDone intentId={intent && intent.intentId} note={kind === 'ad' ? 'Your ad appears as soon as the payment is confirmed.' : 'Your sponsor credit appears as soon as the payment is confirmed.'} />;
  const t = (intent && intent.terms) || {};
  const val = id => { const el = rootRef.current && rootRef.current.querySelector('#' + id); return el ? el.value.trim() : ''; };
  // Form alanlarını oku; eksikse null döner ve çağıran taraf kullanıcıyı uyarır.
  const collect = kind === 'ad'
    ? () => { const name = val('adName'); if (!name) { actions.toast('Your name or company is required', 'error'); return null; } return { advertiser: name, x_handle: val('adX'), text: val('adText'), cta: val('adCta'), url: val('adUrl') }; }
    : () => { const sponsor = val('anName'); if (!sponsor) { actions.toast('Your name or company is required', 'error'); return null; } return { sponsor, x_handle: val('anX') }; };
  const withImage = async details => {
    if (kind !== 'ad') return details;
    const f = rootRef.current.querySelector('#adImg').files[0]; if (!f) return details;
    if (f.size > 2 * 1024 * 1024) { actions.toast('Image too large (max 2MB)', 'error'); return null; }
    details.image = await new Promise(res => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f); });
    return details;
  };
  const go = async txHash => {
    const base = collect(); if (!base) return;
    const details = await withImage(base); if (!details) return;
    details.payment = { txHash }; setBusy(true);
    try { const r = await api('/api/purchase/confirm', { method: 'POST', body: { intentId: intent.intentId, details } }); if (r.status === 'pending_verification') { setSubmitted(true); setBusy(false); return; } actions.closeModal(); actions.toast(`🏆 <b>Purchase complete!</b> ${esc(r.shareText || '')}`, 'epic', 6000); if (r.shareText && navigator.clipboard) navigator.clipboard.writeText(r.shareText + ' ' + location.origin).catch(() => { }); setTimeout(() => location.reload(), 2200); }
    catch (e) { actions.toast(e.error || 'Payment submission failed', 'error'); setBusy(false); }
  };
  // Kart: önce reklam/sponsor bilgisi sunucuya kaydedilir, sonra Stripe'a gidilir;
  // böylece webhook ile aktifleşen satın almada içerik kaybolmaz.
  const beforeCard = async () => {
    const base = collect(); if (!base) return false;
    const details = await withImage(base); if (!details) return false;
    try { await api('/api/purchase/details', { method: 'POST', body: { intentId: intent.intentId, details } }); return true; }
    catch (e) { actions.toast(e.error || 'Could not save details', 'error'); return false; }
  };
  const isCard = !!(intent && intent.paymentMethod === 'card');
  // Özet satırı ancak intent bilgisi geldiğinde gösterilir (yüklenirken boş kalmasın).
  const summary = !t.item ? null : (kind === 'ad'
    ? <p className="muted small">{t.item.replace(/^Advertising slot: /, 'Ad space: ')} · <b>{t.price}</b> · owned until someone outbids you.</p>
    : <p className="muted small">{t.item.replace(/^National anthem sponsorship: /, 'Anthem of ')} · <b>{t.price}</b> · yours until someone takes it over.</p>);
  const fields = kind === 'ad'
    ? <><div className="field"><label>YOUR NAME OR COMPANY *</label><input id="adName" maxLength="60" placeholder="Acme Inc." /></div><div className="field"><label>𝕏 HANDLE</label><input id="adX" maxLength="16" placeholder="@acme" /></div><div className="field"><label>SHORT TEXT</label><input id="adText" maxLength="120" placeholder="The best rockets in the galaxy 🚀" /></div><div className="field"><label>BUTTON TEXT</label><input id="adCta" maxLength="30" placeholder="Learn more" /></div><div className="field"><label>LINK (OPTIONAL)</label><input id="adUrl" type="url" placeholder="https://example.com" /></div><div className="field"><label>IMAGE (OPTIONAL, JPG/PNG/WEBP, max 2MB)</label><input id="adImg" type="file" accept="image/png,image/jpeg,image/webp" /></div></>
    : <><div className="field"><label>YOUR NAME OR COMPANY *</label><input id="anName" maxLength="60" placeholder="John Doe" /></div><div className="field"><label>𝕏 HANDLE (OPTIONAL)</label><input id="anX" maxLength="16" placeholder="@johndoe" /></div></>;
  return <div ref={rootRef}><h3>{kind === 'ad' ? '📢 Take over this ad space' : '🎵 Take over this anthem'}</h3>{summary}{fields}<MethodChoice availability={availability} method={method} onPick={setMethod} />{error ? <PayError message={error} onRetry={() => setRetry(r => r + 1)} /> : (!intent ? <p className="muted small center paybox">Preparing checkout…</p> : (isCard ? <CardBox intent={intent} beforeRedirect={beforeCard} /> : (intent.clientAction && intent.clientAction.type === 'demo_confirm' ? <DemoBox intent={intent} onSubmit={go} busy={busy} /> : <PayBox intent={intent} onSubmit={go} busy={busy} note="Your slot activates after the transfer is verified." />)))}</div>;
}

// Supporter aboneliği: kart ile aylık destekçi üyeliği.
// Stripe abonelik modu kullanılır; giriş yapılmış bir hesap gerekir.
export function SupporterModal() {
  const st = useStore();
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { api('/api/subscription').then(setStatus).catch(() => setStatus({ active: false })); }, []);
  const active = !!(status && status.active);
  const start = async () => {
    if (!st.me) { actions.closeModal(); return actions.openModal('signin', { afterMsg: 'Sign in to start your supporter membership — it follows your account.' }); }
    setBusy(true); setError(null);
    try {
      const intent = await api('/api/subscription/intent', { method: 'POST', body: { method: 'card' } });
      if (intent.clientAction && intent.clientAction.type === 'redirect') { location.href = intent.clientAction.url; return; }
      if (intent.clientAction && intent.clientAction.type === 'demo_confirm') {
        const r = await api('/api/subscription/confirm', { method: 'POST', body: { intentId: intent.intentId } });
        actions.closeModal();
        actions.toast('⭐ <b>Welcome, supporter!</b> Your free votes just went up.', 'epic', 6500);
        api('/api/session').then(actions.setSession).catch(() => { });
        return r;
      }
      setError('Membership checkout could not be started.');
    } catch (e) { setError(e && (e.message || e.error) || 'Membership checkout failed'); }
    finally { setBusy(false); }
  };
  if (active) return <div><h3>⭐ Supporter membership</h3>
    <p className="muted small">Thank you! Your membership is active{status.currentPeriodEnd ? ` until ${String(status.currentPeriodEnd).slice(0, 10)}` : ''}.</p>
    <div className="pack-grid" style={{ gridTemplateColumns: '1fr' }}>
      <div className="pack sel"><b>+{status.bonusFreeVotes || 4}</b><span>EXTRA FREE VOTES / DAY</span></div>
      {status.adFree ? <div className="pack"><b>🚫</b><span>ADS HIDDEN</span></div> : null}
      <div className="pack"><b>★</b><span>SUPPORTER BADGE</span></div>
    </div>
    <p className="muted small center" style={{ marginTop: '0.6rem' }}>Renews monthly until cancelled. To cancel, reply to your Stripe receipt or contact us.</p>
  </div>;
  return <div><h3>⭐ Become a supporter</h3>
    <p className="muted small">Membership is linked to your account and renews monthly.</p>
    <div className="pack-grid"><div className="pack sel"><b>${(status && status.priceUsd ? status.priceUsd : 4.99).toFixed(2)}</b><span>PER MONTH</span></div><div className="pack"><b>+{status && status.bonusFreeVotes ? status.bonusFreeVotes : 4}</b><span>FREE VOTES / DAY</span></div><div className="pack"><b>🚫</b><span>NO ADS</span></div></div>
    {error ? <PayError message={error} onRetry={start} /> : <button className="btn btn-gold big" style={{ width: '100%', marginTop: '0.6rem' }} disabled={busy} onClick={start}>{busy ? 'STARTING…' : (st.me ? 'CONTINUE TO CARD PAYMENT' : 'SIGN IN AND CONTINUE')}</button>}
    <p className="muted small center" style={{ marginTop: '0.5rem' }}>Card only — recurring payments cannot run on crypto.</p>
  </div>;
}

export function MyVotesModal() { const st = useStore(); const total = (st.session.freePerDay || 0) + (st.session.bonus_earned || 0) + (st.session.purchased || 0); const mv = st.myVotes || []; return <div><h3>🗳 My votes</h3><p className="muted small">Remaining today: <b>{st.session.remaining ?? '…'}/{total}</b> · Free {st.session.freePerDay}/day · Bonus earned {st.session.bonus_earned || 0} · Purchased {st.session.purchased || 0}</p><div className="myvotes-list">{mv.length ? mv.map(v => <a className="trend-row" key={v.slug} href={`/leader/${encodeURIComponent(v.slug)}`}><span>{v.flag} {v.name}</span><b>×{v.n} · #{v.rank}</b></a>) : <p className="muted small">You haven't voted yet. Your 1 free daily vote is waiting!</p>}</div><div className="hero-cta"><button className="btn btn-gold" onClick={() => actions.openModal('buyvotes')}>⚡ BUY MORE VOTES</button></div></div>; }

export function SignInModal({ afterMsg }) {
  const [mode, setMode] = useState('login');
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  // Google girişi yalnızca sunucuda anahtarlar tanımlıysa gösterilir.
  const [googleOn, setGoogleOn] = useState(null);
  useEffect(() => { api('/api/auth/providers').then(r => setGoogleOn(!!(r && r.google && r.google.enabled))).catch(() => setGoogleOn(false)); }, []);
  const googleGo = () => {
    if (!googleOn) return actions.toast('Google sign-in is not enabled on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).', 'error', 6000);
    const next = location.pathname + location.search;
    location.href = '/api/auth/google/start?next=' + encodeURIComponent(next);
  };
  const googleBtn = <div className="oauth-row">
    <button type="button" className="btn google-btn" disabled={busy} onClick={googleGo}>
      <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" style={{ flex: '0 0 auto' }}>
        <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z" />
        <path fill="#4285F4" d="M46.5 24.5c0-1.6-.2-3.1-.5-4.5H24v9h12.7c-.6 3-2.3 5.6-4.8 7.3l7.6 5.9c4.4-4.1 7-10.1 7-17.7z" />
        <path fill="#FBBC05" d="M10.4 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.8-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.8-6.1z" />
        <path fill="#34A853" d="M24 48c6.2 0 11.5-2 15.4-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.8 2.3-6.3 0-11.7-3.7-13.6-9.1l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
      </svg>
      <span>Continue with Google</span>
    </button>
    <p className="muted small center" style={{ margin: '0.5rem 0 0' }}>No password needed — Google verifies your email.</p>
  </div>;

  const fail = e => actions.toast(e?.error === 'username_taken' ? 'That username is already taken.' : e?.error === 'email_taken' ? 'That email is already registered.' : e?.error === 'invalid_username' ? 'Username: 3–32 characters, letters/numbers/underscore only.' : e?.error === 'invalid_password' ? 'Password must be 8–128 characters.' : e?.error === 'email_delivery_not_configured' ? 'Email verification is not configured on the server yet.' : e?.error === 'email_delivery_failed' ? 'Verification email could not be sent. Please try again later.' : e?.error === 'account_locked' ? 'Too many failed attempts. Try again later.' : e?.message || 'Something went wrong. Please try again.', 'error');

  const login = async () => {
    if (!identifier.trim() || !password) return actions.toast('Enter your username/email and password.', 'error');
    setBusy(true);
    try {
      const r = await api('/api/auth/login', { method: 'POST', body: { identifier: identifier.trim(), password } });
      actions.setMe(r.user);
      actions.closeModal();
      actions.toast(r.needsEmailVerification ? `👑 Welcome, ${esc(r.user.name)}! Please verify your email to secure the account.` : `👑 <b>Welcome back, ${esc(r.user.name)}!</b> Your votes follow this account.`, 'epic', 5500);
      api('/api/my-votes').then(actions.setMyVotes).catch(() => { });
      api('/api/session').then(actions.setSession).catch(() => { });
    } catch (e) { fail(e); setBusy(false); }
  };

  const register = async () => {
    if (!username.trim() || !email.trim() || !password) return actions.toast('Username, email and password are required.', 'error');
    if (password !== confirm) return actions.toast('Passwords do not match.', 'error');
    setBusy(true);
    try {
      const r = await api('/api/auth/register', { method: 'POST', body: { username: username.trim(), email: email.trim(), password, name: name.trim() || username.trim() } });
      actions.setMe(r.user);
      actions.closeModal();
      actions.toast('✅ Account created. Check your email and verify your address.', 'success', 6500);
      api('/api/session').then(actions.setSession).catch(() => { });
    } catch (e) { fail(e); setBusy(false); }
  };

  const forgot = async () => {
    if (!email.trim()) return actions.toast('Enter the email address on your account.', 'error');
    setBusy(true);
    try { const r = await api('/api/auth/forgot-password', { method: 'POST', body: { email: email.trim() } }); actions.toast(r.message || 'If the account exists, reset instructions have been sent.', 'success', 6000); setMode('login'); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return <div>
    <h3>👑 {mode === 'register' ? 'Create your account' : mode === 'forgot' ? 'Reset your password' : 'Welcome back'}</h3>
    <p className="muted small">{afterMsg || (mode === 'register' ? 'Create one account with a username, email and password. Your votes and purchases follow you across devices.' : mode === 'forgot' ? 'We will email a secure password-reset link to your account email.' : 'Sign in to keep your votes and purchases linked to your account on every device.')}</p>
    {mode === 'login' ? <>
      <div className="field"><label>USERNAME OR EMAIL *</label><input value={identifier} onChange={e => setIdentifier(e.target.value)} maxLength="160" autoComplete="username" placeholder="yourname or you@mail.com" autoFocus /></div>
      <div className="field"><label>PASSWORD *</label><input value={password} onChange={e => setPassword(e.target.value)} type="password" maxLength="128" autoComplete="current-password" placeholder="••••••••" onKeyDown={e => { if (e.key === 'Enter') login(); }} /></div>
      <button className="btn btn-gold big" style={{ width: '100%' }} disabled={busy} onClick={login}>{busy ? 'SIGNING IN…' : 'SIGN IN'}</button>
      {googleBtn}
      <div className="auth-links"><button type="button" className="x-link" onClick={() => setMode('forgot')}>Forgot password?</button><button type="button" className="x-link" onClick={() => setMode('register')}>Create account</button></div>
    </> : mode === 'register' ? <>
      <div className="field"><label>USERNAME *</label><input value={username} onChange={e => setUsername(e.target.value.toLowerCase())} maxLength="32" autoComplete="username" placeholder="mehmet_yilmaz" autoFocus /></div>
      <div className="field"><label>EMAIL *</label><input value={email} onChange={e => setEmail(e.target.value)} type="email" maxLength="160" autoComplete="email" placeholder="you@mail.com" /></div>
      <div className="field"><label>NAME — optional</label><input value={name} onChange={e => setName(e.target.value)} maxLength="60" autoComplete="name" placeholder="Mehmet Yılmaz" /></div>
      <div className="field"><label>PASSWORD *</label><input value={password} onChange={e => setPassword(e.target.value)} type="password" maxLength="128" autoComplete="new-password" placeholder="At least 8 characters" /></div>
      <div className="field"><label>REPEAT PASSWORD *</label><input value={confirm} onChange={e => setConfirm(e.target.value)} type="password" maxLength="128" autoComplete="new-password" placeholder="Repeat password" onKeyDown={e => { if (e.key === 'Enter') register(); }} /></div>
      <button className="btn btn-gold big" style={{ width: '100%' }} disabled={busy} onClick={register}>{busy ? 'CREATING ACCOUNT…' : 'CREATE ACCOUNT'}</button>
      {googleBtn}
      <p className="muted small center">Creating an account needs a verification email — or skip it entirely with Google.</p>
      <div className="auth-links"><button type="button" className="x-link" onClick={() => setMode('login')}>Already have an account? Sign in</button></div>
    </> : <>
      <div className="field"><label>ACCOUNT EMAIL *</label><input value={email} onChange={e => setEmail(e.target.value)} type="email" maxLength="160" autoComplete="email" placeholder="you@mail.com" autoFocus onKeyDown={e => { if (e.key === 'Enter') forgot(); }} /></div>
      <button className="btn btn-gold big" style={{ width: '100%' }} disabled={busy} onClick={forgot}>{busy ? 'SENDING…' : 'EMAIL RESET LINK'}</button>
      <div className="auth-links"><button type="button" className="x-link" onClick={() => setMode('login')}>Back to sign in</button></div>
    </>}
  </div>;
}

export function AccountModal() {
  const st = useStore(); const me = st.me;
  if (!me) return null;
  const out = async () => { try { await api('/api/auth/logout', { method: 'POST' }); } catch { } actions.setMe(null); actions.closeModal(); actions.toast('Signed out. Your votes stay linked to your account.', '', 4000); };
  const supporter = (st.session && st.session.supporter) || null;
  return <div><h3><span className="avatar big" style={{ background: me.color }}>{me.initials}</span> {me.name}{st.session && st.session.supporter && st.session.supporter.active ? <span className="supporter-badge" title="Supporter">★</span> : null}</h3><p className="muted small">@{me.username} · {me.email}{me.email_verified ? ' · ✓ Email verified' : ' · ⚠ Email not verified'}</p>{!me.email_verified ? <p className="muted small">Verify your email to keep the account fully secured and recoverable.</p> : null}<div className="pack-grid" style={{ gridTemplateColumns: '1fr' }}><button className="pack" onClick={() => actions.openModal('myvotes')}><b>🗳 MY VOTES</b><span>Every leader you've supported</span></button>{supporter && supporter.active ? <div className="pack sel"><b>★ SUPPORTER</b><span>+{supporter.bonusFreeVotes} free votes/day{supporter.currentPeriodEnd ? ` · renews ${String(supporter.currentPeriodEnd).slice(0, 10)}` : ''}</span></div> : <button className="pack" onClick={() => actions.openModal('supporter')}><b>⭐ BECOME A SUPPORTER</b><span>5 votes a day, no ads — $4.99/month</span></button>}<button className="pack" onClick={out}><b>🚪 SIGN OUT</b><span>Your votes remain linked to this account</span></button></div></div>;
}

const MODALS = { vote: VoteModal, buyvotes: BuyVotesModal, supporter: SupporterModal, share: ShareModal, checkout: CheckoutModal, myvotes: MyVotesModal, signin: SignInModal, account: AccountModal, paymentStatus: PaymentStatusModal };