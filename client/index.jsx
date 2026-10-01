import { createRoot } from 'react-dom/client';
import { actions, getState } from './store.js';
import { api } from './api.js';
import { Toasts, Confetti } from './ui/Toasts.jsx';
import { ModalHost, PaymentReturnWatcher } from './ui/modals.jsx';
import { initDevice } from './device.js';
import { HeaderActions } from './ui/HeaderActions.jsx';
import { Leaderboard } from './ui/Leaderboard.jsx';
import { StatsRings } from './ui/StatsRings.jsx';
import { StrictMode } from 'react';
import { esc } from './api.js';

// Vanilla katman (app.js) SSR butonlarını bu köprü ile React akışına bağlar.
window.GLUI = {
  toast: (html, type, ms) => actions.toast(html, type, ms),
  confetti: () => actions.confetti(),
  flashLeader: slug => actions.flashLeader(slug),
  openVote: slug => actions.openModal('vote', { slug }),
  openShare: (slug, wantBonus, afterVote) => actions.openModal('share', { slug, wantBonus, afterVote }),
  openBuyVotes: () => actions.openModal('buyvotes'),
  openAdPurchase: slotId => actions.openModal('checkout', { kind: 'ad', reference: slotId }),
  openAnthemPurchase: cc => actions.openModal('checkout', { kind: 'anthem', reference: cc }),
  openMyVotes: () => actions.openModal('myvotes'),
  openSignIn: afterMsg => actions.openModal('signin', { afterMsg }),
  openAccount: () => actions.openModal('account'),
  getMyVotes() {
    if (getState().myVotes !== null) return Promise.resolve(getState().myVotes);
    return api('/api/my-votes').then(l => { actions.setMyVotes(l); return l; }).catch(() => []);
  }
};

// Mount noktaları — sayfada hangi kaplar varsa o adacıklar canlanır (SSR boş kalırsa
// adacık hiç render vermez, sayfa statik haliyle çalışmaya devam eder).
initDevice(); // cihaz imzası ilk oy isteğinden önce hazır olsun

// Google girişinden dönüş: sunucu ?signed_in=1 ya da ?google_error=<sebep>
// ile geri yönlendirir. Adres çubuğunu temizleyip durumu tazeliyoruz.
(() => {
  try {
    const q = new URLSearchParams(location.search);
    const err = q.get('google_error');
    if (!q.get('signed_in') && !err) return;
    const clean = new URL(location.href);
    clean.searchParams.delete('signed_in'); clean.searchParams.delete('google_error');
    history.replaceState({}, '', clean.pathname + (clean.search ? clean.search : '') + clean.hash);
    if (err) {
      const msg = { not_configured: 'Google sign-in is not enabled on this server yet.', no_email: 'Your Google account did not share an email address.', cancelled: 'Google sign-in was cancelled.', state: 'Sign-in link expired — please try again.', failed: 'Google sign-in failed. Please try again.' };
      actions.toast('⚠ ' + (msg[err] || msg.failed), 'error', 6500);
      return;
    }
    api('/api/auth/me').then(r => { if (r && r.user) { actions.setMe(r.user); actions.toast(`👑 <b>Welcome, ${esc(r.user.name)}!</b> Signed in with Google — your votes and purchases now follow this account.`, 'epic', 6500); } }).catch(() => { });
    api('/api/session').then(actions.setSession).catch(() => { });
    api('/api/my-votes').then(actions.setMyVotes).catch(() => { });
  } catch { /* adres çubuğu okunamadıysa sorun değil */ }
})();

const reactRoot = createRoot(document.getElementById('react-root') || document.createElement('div'));
reactRoot.render(
  <StrictMode>
    <Toasts />
    <Confetti />
    <ModalHost />
    <PaymentReturnWatcher />
    <HeaderActions />
  </StrictMode>
);

const lbHost = document.getElementById('leaderboard');
if (lbHost) {
  // SSR satırları fetch tamamlanana kadar görünür kalsın: önce veri, sonra mount.
  // Fetch başarısız olursa adacık hiç mount edilmez ve SSR tablo aynen kalır.
  const D2 = window.__DATA__ || {};
  const limit = Math.max(10, lbHost.children.length || 10);
  const qs = `limit=${limit}` + (D2.page === 'country' && D2.code ? `&country=${D2.code}` : '');
  api(`/api/leaderboard?${qs}`)
    .then(r => createRoot(lbHost).render(
      <StrictMode>
        <Leaderboard initialRows={r.rows} qs={qs} />
      </StrictMode>
    ))
    .catch(() => { });
}

// İstatistik halkaları adası: SSR sayıları veri gelene kadar yerinde kalır.
const sbHost = document.getElementById('statsBand');
if (sbHost) {
  api('/api/stats')
    .then(s => createRoot(sbHost).render(
      <StrictMode>
        <StatsRings initial={s} />
      </StrictMode>
    ))
    .catch(() => { });
}

// Önyükleme: oturum + kullanıcı + oy listesi; ardından "hoş geldin" bildirimi.
(async () => {
  try {
    const [sess, me] = await Promise.all([
      api('/api/session').catch(() => null),
      api('/api/auth/me').catch(() => null)
    ]);
    if (sess) actions.setSession(sess);
    actions.setMe(me && me.user ? me.user : null);
    const mv = await api('/api/my-votes').catch(() => null);
    actions.setMyVotes(mv || []);
    try {
      if ((mv || []).length && !sessionStorage.getItem('gl_welcomed')) {
        sessionStorage.setItem('gl_welcomed', '1');
        const s = getState();
        actions.toast(`👋 Welcome back${s.me ? ', ' + esc(s.me.name.split(' ')[0]) : ''}! You have <b>${s.session.remaining}/${(s.session.freePerDay || 0) + (s.session.bonus_earned || 0) + (s.session.purchased || 0)} votes</b> today.`, '', 5000);
      }
    } catch { }
  } catch { /* sessiz kal — SSR hâlâ işlevsel */ }
})();
