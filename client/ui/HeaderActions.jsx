import { createPortal } from 'react-dom';
import { useStore } from '../useStore.jsx';
import { actions } from '../store.js';

const D = () => (window.__DATA__ || {});

// Üst çubuk adacığı: oy hapı + giriş düğmesi + mobil oy çubuğu.
// SSR'daki #votesPill / #authBtn / #mvbBtn yerini alır (aynı id ve sınıflar,
// böylece mevcut CSS teması aynen çalışır).
export function HeaderActions() {
  const st = useStore();
  const headerHost = document.getElementById('glHeaderActions');
  const mobileHost = document.getElementById('glMobileBar');

  const total = (st.session.freePerDay || 0) + (st.session.bonus_earned || 0) + (st.session.purchased || 0);
  const pillTxt = st.session.remaining === null ? '… votes' : `${st.session.remaining}/${total} votes`;

  const voteNow = () => {
    const d = D();
    if (d.page === 'leader' && d.slug) return actions.openModal('vote', { slug: d.slug });
    const first = document.querySelector('.lb-row, .leader-card');
    if (first) return actions.openModal('vote', { slug: first.dataset.slug });
    location.href = '/#ranking';
  };

  const header = headerHost && createPortal(
    <>
      <span className={'votes-pill' + (st.session.remaining === 0 ? ' empty' : '')} id="votesPill"
        role="status" style={{ cursor: 'pointer' }} title="See my votes"
        onClick={() => actions.openModal('myvotes')}>{pillTxt}</span>
      <button className={'auth-btn' + (st.me ? ' signed' : '')} id="authBtn" aria-label="Sign in"
        onClick={() => st.me ? actions.openModal('account') : actions.openModal('signin')}>
        {st.me
          ? <><span className="avatar" style={{ background: st.me.color }}>{st.me.initials}</span>
            <span className="auth-name">{st.me.name.split(' ')[0]}</span></>
          : 'SIGN\u00A0IN'}
      </button>
    </>,
    headerHost
  );

  const mobile = mobileHost && createPortal(
    <>
      <span id="mvbText">{st.session.remaining === 0 ? 'Out of votes — share or buy!'
        : `You have ${st.session.remaining === null ? '…' : pillTxt} left`}</span>
      <button className="btn btn-vote" id="mvbBtn" onClick={voteNow}>VOTE NOW</button>
    </>,
    mobileHost
  );

  return <>{header}{mobile}</>;
}
