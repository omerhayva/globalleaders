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

function ColdWalletForm({ intent, onSubmit, busy }) {
  const [txHash, setTxHash] = useState('');
  const wallet = intent.wallet || {};
  const copy = async () => {
    try { await navigator.clipboard.writeText(wallet.address || ''); actions.toast('Wallet address copied.', 'success'); }
    catch { actions.toast('Copy failed. Select the address manually.', 'error'); }
  };
  return (
    <div className="crypto-pay-form">
      <div className="crypto-pay-head"><span className="pay-chip"></span><div><b>CRYPTO CHECKOUT</b><span>Cold-wallet transfer</span></div><span className="pay-secure">🔒 Direct wallet</span></div>
      <div className="crypto-wallet-box">
        <div className="crypto-meta"><span>NETWORK</span><b>{wallet.network || '—'}</b><span>ASSET</span><b>{wallet.asset || '—'}</b></div>
        <div className="crypto-address-label">SEND TO THIS COLD-WALLET ADDRESS</div>
        <div className="crypto-address" title={wallet.address || ''}>{wallet.address || 'Wallet is not configured'}</div>
        <button type="button" className="btn btn-ghost crypto-copy" onClick={copy} disabled={!wallet.address}>📋 COPY ADDRESS</button>
      </div>
      <div className="crypto-amount"><span>EXACT AMOUNT TO SEND</span><strong>{intent.cryptoAmountDisplay || '—'}</strong><small>Order value: {intent.priceDisplay}. Send exactly this crypto amount.</small></div>
      <div className="crypto-warning">⚠️ Send only the exact asset on the <b>{wallet.network || 'specified network'}</b>. Another network or asset can result in permanent loss.</div>
      <div className="field"><label>TRANSACTION HASH *</label><input value={txHash} onChange={e => setTxHash(e.target.value.trim())} maxLength="180" placeholder="Paste your transaction hash" autoComplete="off" /></div>
      <button className="btn btn-gold big" style={{ width: '100%' }} disabled={busy || !txHash.trim()} onClick={() => onSubmit(txHash.trim())}>{busy ? 'SUBMITTING…' : 'SUBMIT PAYMENT FOR VERIFICATION'}</button>
      <p className="muted small center" style={{ marginTop: '.65rem' }}>Your purchase is activated only after the transfer is manually verified. Never send private keys or seed phrases.</p>
    </div>
  );
}

const VOTE_ERR = { no_votes_left: 'You used your free vote today. Share for +1 or buy a pack!', too_fast: 'Whoa — slow down a little ⏱', daily_cap: 'Daily voting limit reached for your network.', device_limit: 'Daily free-vote limit reached for this device. Share for +1 or buy a pack!', suspended: 'Voting temporarily suspended for suspicious activity.', captcha_required: 'Too much activity — please try again later.', rate_limited: 'Too many requests — please slow down.' };
function emotionalToast(leader, r) { if (r.oldRank && r.newRank < r.oldRank) actions.toast(`🔥 Your vote moved <b>${esc(leader.name)}</b> from #${r.oldRank} → <b>#${r.newRank}</b>!`, 'epic', 5200); else if (r.newRank === 1) actions.toast(`👑 <b>${esc(leader.name)}</b> is holding <b>#1</b> — powered by your vote!`, 'epic', 5000); else actions.toast(`✅ +${r.count} for <b>${esc(leader.name)}</b> · now ${num(r.totalVotes)} votes at #${r.newRank}. ${r.remaining > 0 ? `You have ${r.remaining} vote${r.remaining > 1 ? 's' : ''} left.` : 'Out of votes — share for +1 or grab a pack!'}`, 'success', 5000); }
function OutOfVotesBody({ slug }) { return <><h3>You're out of votes 😱</h3><p className="muted small">You get <b>1 free vote per day</b>. Get more right now:</p><div className="pack-grid" style={{ gridTemplateColumns: '1fr' }}><button className="pack" onClick={() => actions.openModal('share', { slug, wantBonus: true })}><b>🎁 +1 VOTE</b><span>Share a leader (max 3/day)</span><span className="price">FREE</span></button><button className="pack" onClick={() => actions.openModal('buyvotes')}><b>⚡ VOTE PACKS</b><span>10 votes or 60 votes</span><span className="price">from $1</span></button></div></>; }

export function VoteModal({ slug }) {
  const st = useStore(); const [leader, setLeader] = useState(null); const [n, setN] = useState(1); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/api/leader/' + slug).then(setLeader).catch(() => { actions.toast('Leader not found', 'error'); actions.closeModal(); }); }, [slug]);
  if (!leader) return <p className="muted small center">Loading…</p>;
  const max = Math.max(0, st.session.remaining ?? 1); if (max === 0) return <OutOfVotesBody slug={slug} />;
  const go = async () => { setBusy(true); try { const r = await api('/api/vote', { method: 'POST', body: { slug, count: n } }); actions.setSession(r); api('/api/my-votes').then(actions.setMyVotes).catch(() => { }); actions.closeModal(); actions.confetti(); emotionalToast(leader, r); actions.flashLeader(slug); setTimeout(() => actions.openModal('share', { slug, wantBonus: st.session.remaining === 0, afterVote: true }), 1600); } catch (err) { actions.closeModal(); actions.toast(VOTE_ERR[err.error] || 'Vote failed. Try again.', 'error'); if (err.error === 'no_votes_left') actions.openModal('vote', { slug }); } };
  return <div><h3>Vote for {leader.flag} {leader.name}</h3><p className="muted small">#{leader.rank} · {num(leader.total_votes)} votes · You have {max} vote{max > 1 ? 's' : ''} available</p><div className="lb-power" aria-hidden="true"><i style={{ '--w': Math.max(5, leader.pct) + '%' }}></i></div><p className="muted small center" style={{ margin: '.2rem 0 .6rem' }}>{leader.pct}% of all community votes</p>{max > 1 ? <div className="vote-spinner"><button aria-label="Fewer votes" onClick={() => setN(v => Math.max(1, v - 1))}>−</button><span className="vote-count">{n}</span><button aria-label="More votes" onClick={() => setN(v => Math.min(max, v + 1))}>+</button></div> : <div style={{ height: '0.8rem' }}></div>}<button className="btn btn-vote big" style={{ width: '100%' }} disabled={busy} onClick={go}>CAST {n} VOTE{n > 1 ? 'S' : ''}</button><p className="muted small center" style={{ marginTop: '.6rem' }}>1 free vote per day · earn more by sharing (+1) or <button className="x-link" style={{ background: 'none', border: 'none', cursor: 'pointer', font: 'inherit' }} onClick={() => actions.openModal('buyvotes')}>buy vote packs</button></p></div>;
}

export function BuyVotesModal() {
  const [pack, setPack] = useState('votes-10'); const [intent, setIntent] = useState(null); const [busy, setBusy] = useState(false); const [submitted, setSubmitted] = useState(false);
  const go = async txHash => { setBusy(true); try { const r = await api('/api/purchase/confirm', { method: 'POST', body: { intentId: intent.intentId, details: { txHash } } }); if (r.status === 'pending_verification') { setSubmitted(true); return; } const st0 = getState(); actions.setSession({ remaining: r.remaining, purchased: (st0.session.purchased || 0) + r.votesAdded }); actions.closeModal(); actions.toast(`⚡ <b>+${r.votesAdded} votes</b> added!`, 'epic', 5500); } catch (e) { actions.toast(e.error || 'Payment submission failed', 'error'); setBusy(false); } };
  useEffect(() => { setIntent(null); setSubmitted(false); api('/api/purchase/intent', { method: 'POST', body: { kind: 'votes', reference: pack } }).then(setIntent).catch(e => { actions.toast(e.error || 'Could not start crypto checkout', 'error'); actions.closeModal(); }); }, [pack]);
  if (submitted) return <div className="center"><h3>⏳ Payment submitted</h3><p className="muted small">We received your transaction hash. Your vote pack will be credited after the transfer is verified.</p><button className="btn btn-ghost" onClick={() => actions.closeModal()}>DONE</button></div>;
  if (!intent) return <p className="muted small center">Preparing crypto checkout…</p>;
  return <div><h3>⚡ Buy vote packs</h3><p className="muted small">Choose a pack, send crypto to the cold wallet, then submit the transaction hash.</p><div className="pack-grid"><button className={'pack' + (pack === 'votes-10' ? ' sel' : '')} onClick={() => setPack('votes-10')}><b>10</b><span>VOTES</span><span className="price">$1.00</span></button><button className={'pack' + (pack === 'votes-60' ? ' sel' : '')} onClick={() => setPack('votes-60')}><b>60</b><span>VOTES</span><span className="price">$5.00</span></button></div><ColdWalletForm intent={intent} onSubmit={go} busy={busy} /></div>;
}

export function ShareModal({ slug, wantBonus = false, afterVote = false }) {
  const [leader, setLeader] = useState(null); useEffect(() => { api('/api/leader/' + slug).then(setLeader).catch(() => actions.closeModal()); }, [slug]); if (!leader) return <p className="muted small center">Loading…</p>;
  const text = `${leader.flag} ${leader.name} is currently #${leader.rank} in Global Leaders Live with ${num(leader.total_votes)} votes. Do you agree? Vote now.`;
  const platforms = [['whatsapp', '💬', 'WhatsApp', u => `https://wa.me/?text=${encodeURIComponent(text + ' ' + u)}`],['x', '𝕏', 'X', u => `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(u)}`],['facebook', '📘', 'Facebook', u => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(u)}`],['telegram', '✈️', 'Telegram', u => `https://t.me/share/url?url=${encodeURIComponent(u)}&text=${encodeURIComponent(text)}`],['reddit', '🤖', 'Reddit', u => `https://www.reddit.com/submit?url=${encodeURIComponent(u)}&title=${encodeURIComponent(text)}`],['copy', '🔗', 'Copy Link', null]];
  const doShare = async platform => { try { const r = await api('/api/share', { method: 'POST', body: { slug, platform } }); const url = location.origin + r.shareUrl; if (platform === 'copy') { await navigator.clipboard.writeText(text + ' ' + url).catch(() => { }); actions.toast('🔗 Link copied!', 'success'); } else if (platform === 'native' && navigator.share) navigator.share({ title: 'Global Leaders Live', text, url }).catch(() => { }); else { const p = platforms.find(x => x[0] === platform); if (p && p[3]) window.open(p[3](url), '_blank', 'noopener,width=640,height=560'); } if (r.bonusAwarded) { actions.setSession(r); setTimeout(() => actions.toast('🎁 <b>+1 BONUS VOTE</b> earned for sharing!', 'epic'), 700); } else setTimeout(() => actions.toast('Thanks for sharing! (Daily bonus limit reached)', ''), 700); actions.closeModal(); } catch { actions.toast('Share failed, try again', 'error'); } };
  return <div>{afterVote || wantBonus ? <><h3>Want 1 MORE vote? 🎁</h3><p className="muted small">Share {leader.name} and get <b>+1 bonus vote</b> instantly (max 3/day).</p></> : <><h3>Share {leader.name}</h3><p className="muted small">Every share can earn you +1 bonus vote.</p></>}<div className="terms-box" style={{ textAlign: 'center' }}><div style={{ fontSize: '1.6rem' }}>{leader.flag}</div><b>{leader.name}</b> · #{leader.rank} · {num(leader.total_votes)} votes<br /><span className="muted">"Do you agree? Vote now."</span></div><div className="share-grid">{platforms.map(([id, ico, label]) => <button key={id} className="share-btn" onClick={() => doShare(id)}><span className="ico">{ico}</span>{label}</button>)}</div>{navigator.share ? <button className="btn btn-ghost" style={{ width: '100%' }} onClick={() => doShare('native')}>📲 More share options…</button> : null}</div>;
}

export function CheckoutModal({ kind, reference }) {
  const [intent, setIntent] = useState(null); const [busy, setBusy] = useState(false); const [submitted, setSubmitted] = useState(false); const rootRef = useRef(null);
  useEffect(() => { api('/api/purchase/intent', { method: 'POST', body: { kind, reference } }).then(setIntent).catch(e => { actions.toast(e.error || 'Could not start crypto checkout', 'error'); actions.closeModal(); }); }, [kind, reference]);
  if (!intent) return <p className="muted small center">Preparing crypto checkout…</p>;
  const t = intent.terms;
  const go = async txHash => {
    let details;
    if (kind === 'ad') { const name = rootRef.current.querySelector('#adName').value.trim(); if (!name) return actions.toast('Advertiser name is required', 'error'); details = { advertiser: name, x_handle: rootRef.current.querySelector('#adX').value, text: rootRef.current.querySelector('#adText').value, cta: rootRef.current.querySelector('#adCta').value, url: rootRef.current.querySelector('#adUrl').value }; const f = rootRef.current.querySelector('#adImg').files[0]; if (f) { if (f.size > 2 * 1024 * 1024) return actions.toast('Image too large (max 2MB)', 'error'); details.image = await new Promise(res => { const rd = new FileReader(); rd.onload = () => res(rd.result); rd.readAsDataURL(f); }); } }
    else { const sponsor = rootRef.current.querySelector('#anName').value.trim(); if (!sponsor) return actions.toast('Sponsor name is required', 'error'); details = { sponsor, x_handle: rootRef.current.querySelector('#anX').value }; }
    details.payment = { txHash }; setBusy(true);
    try { const r = await api('/api/purchase/confirm', { method: 'POST', body: { intentId: intent.intentId, details } }); if (r.status === 'pending_verification') { setSubmitted(true); return; } actions.closeModal(); actions.toast(`🏆 <b>Purchase complete!</b> ${esc(r.shareText || '')}`, 'epic', 6000); if (r.shareText && navigator.clipboard) navigator.clipboard.writeText(r.shareText + ' ' + location.origin).catch(() => { }); setTimeout(() => location.reload(), 2200); }
    catch (e) { actions.toast(e.error || 'Payment submission failed', 'error'); setBusy(false); }
  };
  if (submitted) return <div className="center"><h3>⏳ Payment submitted</h3><p className="muted small">Your transaction hash was received. The purchase will activate after manual verification.</p><button className="btn btn-ghost" onClick={() => actions.closeModal()}>DONE</button></div>;
  return <div ref={rootRef}><h3>{kind === 'ad' ? '📢 Take over this ad space' : '🎵 Take over this anthem'}</h3><div className="terms-box"><b>Item:</b> {t.item}<br /><b>Price:</b> {t.price}<br /><b>Crypto:</b> {t.crypto || intent.cryptoAmountDisplay}<br /><b>Ownership:</b> {t.duration}<br /><b>You receive:</b> {t.receives}<br /><b>Refunds:</b> {t.refunds}</div>{kind === 'ad' ? <><div className="field"><label>COMPANY / ADVERTISER NAME *</label><input id="adName" maxLength="60" placeholder="Acme Inc." /></div><div className="field"><label>𝕏 HANDLE</label><input id="adX" maxLength="16" placeholder="@acme" /></div><div className="field"><label>SHORT TEXT</label><input id="adText" maxLength="120" placeholder="The best rockets in the galaxy 🚀" /></div><div className="field"><label>CTA BUTTON</label><input id="adCta" maxLength="30" placeholder="Learn more" /></div><div className="field"><label>DESTINATION URL</label><input id="adUrl" type="url" placeholder="https://example.com" /></div><div className="field"><label>IMAGE (JPG/PNG/WEBP, max 2MB — optional)</label><input id="adImg" type="file" accept="image/png,image/jpeg,image/webp" /></div></> : <><div className="field"><label>YOUR NAME OR COMPANY *</label><input id="anName" maxLength="60" placeholder="John Doe" /></div><div className="field"><label>𝕏 HANDLE</label><input id="anX" maxLength="16" placeholder="@johndoe" /></div></>}<ColdWalletForm intent={intent} onSubmit={go} busy={busy} /></div>;
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
      <div className="auth-links"><button type="button" className="x-link" onClick={() => setMode('forgot')}>Forgot password?</button><button type="button" className="x-link" onClick={() => setMode('register')}>Create account</button></div>
    </> : mode === 'register' ? <>
      <div className="field"><label>USERNAME *</label><input value={username} onChange={e => setUsername(e.target.value.toLowerCase())} maxLength="32" autoComplete="username" placeholder="mehmet_yilmaz" autoFocus /></div>
      <div className="field"><label>EMAIL *</label><input value={email} onChange={e => setEmail(e.target.value)} type="email" maxLength="160" autoComplete="email" placeholder="you@mail.com" /></div>
      <div className="field"><label>NAME — optional</label><input value={name} onChange={e => setName(e.target.value)} maxLength="60" autoComplete="name" placeholder="Mehmet Yılmaz" /></div>
      <div className="field"><label>PASSWORD *</label><input value={password} onChange={e => setPassword(e.target.value)} type="password" maxLength="128" autoComplete="new-password" placeholder="At least 8 characters" /></div>
      <div className="field"><label>REPEAT PASSWORD *</label><input value={confirm} onChange={e => setConfirm(e.target.value)} type="password" maxLength="128" autoComplete="new-password" placeholder="Repeat password" onKeyDown={e => { if (e.key === 'Enter') register(); }} /></div>
      <button className="btn btn-gold big" style={{ width: '100%' }} disabled={busy} onClick={register}>{busy ? 'CREATING ACCOUNT…' : 'CREATE ACCOUNT'}</button>
      <p className="muted small center">A verification email is required. We never need your X/Google/Facebook password.</p>
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
  return <div><h3><span className="avatar big" style={{ background: me.color }}>{me.initials}</span> {me.name}</h3><p className="muted small">@{me.username} · {me.email}{me.email_verified ? ' · ✓ Email verified' : ' · ⚠ Email not verified'}</p>{!me.email_verified ? <p className="muted small">Verify your email to keep the account fully secured and recoverable.</p> : null}<div className="pack-grid" style={{ gridTemplateColumns: '1fr' }}><button className="pack" onClick={() => actions.openModal('myvotes')}><b>🗳 MY VOTES</b><span>Every leader you've supported</span></button><button className="pack" onClick={out}><b>🚪 SIGN OUT</b><span>Your votes remain linked to this account</span></button></div></div>;
}

const MODALS = { vote: VoteModal, buyvotes: BuyVotesModal, share: ShareModal, checkout: CheckoutModal, myvotes: MyVotesModal, signin: SignInModal, account: AccountModal };