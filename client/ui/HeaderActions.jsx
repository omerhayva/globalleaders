import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { useStore } from '../useStore.jsx';
import { actions } from '../store.js';
import { api } from '../api.js';

// Üst çubuktaki lider arama kutusu: yazarken sunucudan sonuç çeker,
// Enter ile sonuç sayfasına gider. Klavye ile gezinilebilir (↑ ↓ Enter Esc).
function SearchBox() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [idx, setIdx] = useState(-1);
  const boxRef = useRef(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setRows([]); setOpen(false); return; }
    let alive = true;
    const t = setTimeout(() => {
      api('/api/leaderboard?limit=6&q=' + encodeURIComponent(term))
        .then(r => { if (alive) { setRows(r.rows || []); setOpen(true); setIdx(-1); } })
        .catch(() => { if (alive) setRows([]); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q]);

  useEffect(() => {
    const onDoc = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, []);

  const go = row => { if (!row) return; location.href = '/leader/' + encodeURIComponent(row.slug); };
  const key = e => {
    if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur(); return; }
    if (!open || !rows.length) { if (e.key === 'Enter' && q.trim().length >= 2) location.href = '/leaders?q=' + encodeURIComponent(q.trim()); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(i => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(i => Math.max(-1, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); idx >= 0 ? go(rows[idx]) : (location.href = '/leaders?q=' + encodeURIComponent(q.trim())); }
  };

  return (
    <div className="search-box" ref={boxRef}>
      <input type="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={key}
        onFocus={() => rows.length && setOpen(true)} className="search-input"
        placeholder="Search leaders…" aria-label="Search leaders" autoComplete="off" />
      <span className="search-ico" aria-hidden="true">🔍</span>
      {open && q.trim().length >= 2 ? (
        <div className="search-results" role="listbox" aria-label="Search results">
          {rows.length ? rows.map((r, i) => (
            <button key={r.slug} role="option" aria-selected={i === idx} className={'search-row' + (i === idx ? ' sel' : '')}
              onMouseEnter={() => setIdx(i)} onClick={() => go(r)}>
              <span className="search-rank">#{r.rank}</span>
              <span className="search-name">{r.flag} {r.name}</span>
              <span className="muted small">{r.countryName || r.country_code}</span>
            </button>
          )) : <p className="muted small search-empty">No leader matches “{q.trim()}”.</p>}
          {rows.length ? <a className="search-all" href={'/leaders?q=' + encodeURIComponent(q.trim())}>See all results →</a> : null}
        </div>
      ) : null}
    </div>
  );
}

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
      <SearchBox />
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
