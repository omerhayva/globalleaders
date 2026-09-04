import { useEffect, useState } from 'react';
import { useRoll, useEnter } from '../hooks.js';
import { num } from '../api.js';

// İstatistik bandı adası: SSR'daki düz sayıların yerini animasyonlu halkalar alır.
// Veri: /api/stats · Canlılık: app.js'in ilettiği 'gl:sse' (activity_created) olayları.
// SSR sayıları, veri gelene kadar yerinde kalır (SEO + JS'siz görünüm korunur).

function Ring({ pct, label, value, max, colors = ['#f5b524', '#38bdf8'], size = 86, sw = 7 }) {
  const shown = useRoll(value);
  const on = useEnter(80);
  const r = (size - sw) / 2, C = 2 * Math.PI * r;
  const gid = 'rg' + label.replace(/\W/g, '');
  const frac = Math.max(0.06, Math.min(1, pct / 100));
  return (
    <div className="ring-stat" role="img" aria-label={`${label}: ${num(value)}`}>
      <div className="ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={colors[0]} /><stop offset="1" stopColor={colors[1]} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth={sw} />
          <circle className="ring-fill" cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke={`url(#${gid})`} strokeWidth={sw} strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={on ? C * (1 - frac) : C}
            transform={`rotate(-90 ${size / 2} ${size / 2})`} />
        </svg>
        <div className="ring-num">{num(shown)}</div>
      </div>
      <span className="ring-label">{label}</span>
      {max ? <span className="ring-sub">goal {num(max)}</span> : null}
    </div>
  );
}

export function StatsRings({ initial }) {
  const [st, setSt] = useState(initial);
  useEffect(() => {
    const onSse = e => {
      const { event, data } = e.detail || {};
      if (event !== 'activity_created') return;
      if (data.type === 'vote') setSt(s => ({ ...s, votesToday: (s.votesToday || 0) + 1, totalVotes: (s.totalVotes || 0) + 1 }));
      else if (data.type === 'share') setSt(s => ({ ...s, sharesToday: (s.sharesToday || 0) + 1 }));
    };
    document.addEventListener('gl:sse', onSse);
    return () => document.removeEventListener('gl:sse', onSse);
  }, []);
  const DAILY_GOAL = 1000;
  return (
    <>
      <Ring label="TOTAL VOTES" value={st.totalVotes} pct={82} colors={['#f5b524', '#f97316']} size={96} />
      <Ring label="VOTES TODAY" value={st.votesToday} max={DAILY_GOAL} pct={Math.min(100, 100 * (st.votesToday || 0) / DAILY_GOAL)} colors={['#38bdf8', '#818cf8']} />
      <Ring label="LEADERS" value={st.leaders} pct={64} colors={['#34d399', '#38bdf8']} />
      <Ring label="COUNTRIES" value={st.countries} pct={30} colors={['#a78bfa', '#f472b6']} />
      <Ring label="SHARES TODAY" value={st.sharesToday} pct={Math.min(100, 100 * (st.sharesToday || 0) / 50)} colors={['#f5b524', '#34d399']} />
    </>
  );
}
