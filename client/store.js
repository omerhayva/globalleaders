// ----------------------------------------------------------------------------
// GL Store — framework-bağımsız gözlemlenebilir durum deposu.
// React bileşenleri useSyncExternalStore ile abone olur; vanilla katman (app.js)
// window.GLUI köprüsü üzerinden aynı depoyu kullanır. Bu sayede React
// bağlanmadan ÖNCE gelen çağrılar bile kaybolmaz.
// ----------------------------------------------------------------------------
let state = {
  session: { remaining: null, freePerDay: 1, bonus_earned: 0, bonus_used: 0, purchased: 0, purchased_used: 0, free_used: 0, demoMode: true },
  me: null,          // giriş yapan kullanıcı (pubUser) | null
  myVotes: null,     // null = yüklenmedi, [] = boş liste
  toasts: [],        // { id, html, type, leaving }
  modal: null,       // { type, props } | null
  confetti: []       // geçici konfeti stil objeleri
};

const listeners = new Set();
export const getState = () => state;
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const setState = patch => {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
  listeners.forEach(l => l());
};

let toastSeq = 0;
const reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export const actions = {
  // ---------- toasts ----------
  toast(html, type = '', ms = 4200) {
    const id = ++toastSeq;
    setState(s => ({ toasts: [...s.toasts, { id, html, type, leaving: false }] }));
    setTimeout(() => setState(s => ({ toasts: s.toasts.map(t => t.id === id ? { ...t, leaving: true } : t) })), ms);
    setTimeout(() => setState(s => ({ toasts: s.toasts.filter(t => t.id !== id) })), ms + 450);
  },
  // ---------- modals ----------
  openModal(type, props = {}) { setState({ modal: { type, props } }); },
  closeModal() { setState({ modal: null }); },
  // ---------- oturum / kullanıcı ----------
  setSession(sess) { if (sess) setState({ session: { ...state.session, ...sess } }); },
  setMe(me) { setState({ me }); },
  setMyVotes(list) {
    setState({ myVotes: list });
    // vanilla katman (.leader-card rozetleri) haberdar olsun
    try { document.dispatchEvent(new CustomEvent('gl:myvotes', { detail: list })); } catch { }
  },
  // ---------- konfeti ----------
  confetti() {
    if (reduceMotion) return;
    const colors = ['#38bdf8', '#f5b524', '#34d399', '#818cf8', '#f87171'];
    const batch = [];
    for (let i = 0; i < 26; i++) {
      batch.push({
        left: (8 + Math.random() * 84) + 'vw',
        background: colors[i % colors.length],
        animationDelay: (Math.random() * 0.35) + 's',
        animationDuration: (0.9 + Math.random() * 0.9) + 's',
        width: (5 + Math.random() * 6) + 'px',
        height: (8 + Math.random() * 8) + 'px'
      });
    }
    setState(s => ({ confetti: [...s.confetti, ...batch] }));
    setTimeout(() => setState(s => ({ confetti: s.confetti.slice(26) })), 2500);
  },
  // ---------- DOM yardımcıları (SSR öğeleri için) ----------
  flashLeader(slug) {
    try {
      document.querySelectorAll(`[data-slug="${slug}"]`).forEach(el => {
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      });
    } catch { }
  }
};
