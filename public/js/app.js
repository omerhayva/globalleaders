/* GLOBAL LEADERS LIVE — vanilla katman (SSR yaşam desteği):
   canlılık (SSE), grafikler, harita, sayaçlar, form/oyin yönlendirmeleri.
   Etkileşim bileşenleri (modal, oy, ödeme, hesap) React adacıklarıdır
   (/js/react-app.js) ve window.GLUI köprüsü ile buradan çağrılır. */
(() => {
  const D = window.__DATA__ || {};
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const num = n => (n || 0).toLocaleString('en-US');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GLUI = () => window.GLUI || null; // react-app.js yüklenemezse sayfa yine okunur kalır
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- resilient session identity: cookie + localStorage-mirrored header ---
  let GLSID = null; try { GLSID = localStorage.getItem('gl_sid'); } catch {}
  const api = (url, opts) => {
    const headers = { ...(opts && opts.body ? { 'Content-Type': 'application/json' } : {}), ...(GLSID ? { 'X-GL-Session': GLSID } : {}) };
    return fetch(url, { ...(opts || {}), headers: { ...headers, ...(opts && opts.headers || {}) }, body: opts && opts.body ? JSON.stringify(opts.body) : undefined })
      .then(async r => {
        const sid = r.headers.get('X-GL-Session');
        if (sid && sid !== GLSID) { GLSID = sid; try { localStorage.setItem('gl_sid', sid); } catch {} }
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw j; return j;
      });
  };
  const toast = (msg, type = '', ms = 4200) => { const g = GLUI(); if (g) g.toast(msg, type, ms); };

  // ---------- animated number roll ----------
  function rollNumber(el, to) {
    const from = parseInt(String(el.textContent).replace(/[^\d]/g, ''), 10) || 0;
    if (reduceMotion || Math.abs(to - from) > 5000) { el.textContent = num(to); return; }
    const t0 = performance.now(), dur = 700;
    const step = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = num(Math.round(from + (to - from) * e));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    el.classList.remove('tick'); void el.offsetWidth; el.classList.add('tick');
  }

  // count-up on scroll for stat band
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { const el = e.target; io.unobserve(el); const v = +el.dataset.count || 0; el.textContent = '0'; rollNumber(el, v); }
  }));
  $$('[data-count]').forEach(el => io.observe(el));

  // ---------- "voted" rozetleri (yalnız vanilla kartlar; .lb-row React adacığı) ----------
  function markVoted(mv) {
    const voted = new Set((mv || []).map(v => v.slug));
    $$('.leader-card').forEach(el => {
      if (voted.has(el.dataset.slug) && !el.querySelector('.voted-chip')) {
        const host = el.querySelector('.lc-name, .lb-name');
        if (host) host.insertAdjacentHTML('afterend', ' <span class="voted-chip">✓ YOUR VOTE</span>');
      }
    });
  }
  // React mağazası oy listesini yüklediğinde / yenilediğinde haber verir.
  document.addEventListener('gl:myvotes', e => markVoted(e.detail || []));

  // ---------- realtime (SSE) ----------
  // Liderlik tablosu güncellemeleri React adacığına CustomEvent ile aktarılır;
  // profil sayfası, etkinlik akışı ve istatistik sayaçları burada (vanilla) kalır.
  function connectSSE() {
    const es = new EventSource('/api/stream');
    const forward = (event, data) => { try { document.dispatchEvent(new CustomEvent('gl:sse', { detail: { event, data } })); } catch {} };
    es.addEventListener('leader_vote_count_updated', e => {
      const d = JSON.parse(e.data);
      forward('leader_vote_count_updated', d);
      $$(`[data-slug="${d.slug}"]`).forEach(row => {
        if (row.closest('#leaderboard')) return; // React satırları kendi güncellemesini yapar
        const v = row.querySelector('[data-votes]'); if (v) rollNumber(v, d.totalVotes);
        row.classList.remove('flash'); void row.offsetWidth; row.classList.add('flash');
        setTimeout(() => row.classList.remove('flash'), 1400);
      });
      if (D.page === 'leader' && D.slug === d.slug) {
        const pv = $('#profVotes'); if (pv) rollNumber(pv, d.totalVotes);
        const pr = $('#profRank'); if (pr && d.rank) pr.textContent = '#' + d.rank;
      }
    });
    es.addEventListener('leader_rank_changed', e => {
      forward('leader_rank_changed', e.data ? JSON.parse(e.data) : {});
    });
    es.addEventListener('activity_created', e => {
      const d = JSON.parse(e.data);
      forward('activity_created', d); // React istatistik halkaları canlı artar
      const feed = $('#activityFeed');
      if (feed) {
        const li = document.createElement('li');
        li.className = 'new'; li.textContent = d.message;
        feed.prepend(li);
        while (feed.children.length > 14) feed.lastChild.remove();
      }
      const vt = $('[data-stat="votesToday"]');
      if (vt && d.type === 'vote') rollNumber(vt, (parseInt(vt.textContent.replace(/[^\d]/g, '')) || 0) + 1);
    });
    es.addEventListener('anthem_purchased', e => {
      const d = JSON.parse(e.data);
      toast(`🎵 ${esc(d.sponsor)}${d.sponsor_x ? ' (@' + esc(d.sponsor_x) + ')' : ''} just took over an anthem!`, '', 3500);
      if (D.page === 'home') setTimeout(() => location.reload(), 2500); // refresh to feature the new anthem
    });
    es.addEventListener('ad_purchased', e => { const d = JSON.parse(e.data); toast(`📢 ${esc(d.advertiser)} took over an ad space!`, '', 3500); });
    es.onerror = () => { es.close(); setTimeout(connectSSE, 4000); };
  }
  connectSSE();

  // ---------- world map ----------
  async function initMap() {
    const wrap = $('#worldmapWrap');
    if (!wrap) return;
    const [svgText, mapData] = await Promise.all([
      fetch('/map/world.svg').then(r => r.text()),
      D.mapData ? Promise.resolve(D.mapData) : api('/api/countries')
    ]);
    wrap.innerHTML = svgText;
    const byCode = Object.fromEntries(mapData.map(c => [c.code.toLowerCase(), c]));
    const tip = $('#mapTip');
    $$('path[id]', wrap).forEach(p => {
      const c = byCode[p.id];
      if (c) {
        const i = c.intensity;
        p.style.fill = `rgba(56, 189, 248, ${0.12 + i * 0.75})`;
        p.setAttribute('tabindex', '0');
        p.setAttribute('role', 'link');
        p.setAttribute('aria-label', `${c.name}: ${num(c.total_votes)} votes`);
      }
      p.addEventListener('mousemove', e => {
        if (!tip) return;
        const d = byCode[p.id];
        tip.hidden = false;
        tip.style.left = Math.min(innerWidth - 250, e.clientX + 14) + 'px';
        tip.style.top = (e.clientY + 14) + 'px';
        tip.innerHTML = d
          ? `<strong>${d.flag} ${esc(d.name)}</strong>${num(d.total_votes)} votes · #${d.globalRank} global<br><span class="muted small">Top: ${esc(d.top_leader || '—')}${d.top_rank ? ' (#' + d.top_rank + ')' : ''}</span><br><span class="small" style="color:var(--accent)">Click to open →</span>`
          : `<strong>${p.querySelector('title')?.textContent || p.id.toUpperCase()}</strong><span class="muted small">No leaders listed yet</span>`;
      });
      p.addEventListener('mouseleave', () => { if (tip) tip.hidden = true; });
      const go = () => { if (byCode[p.id]) location.href = '/country/' + p.id; };
      p.addEventListener('click', go);
      p.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    });
  }
  initMap();

  // ---------- charts (leader profile / country) ----------
  function lineChart(el, points, { yLabel = v => v, invert = false } = {}) {
    if (!el || !points.length) { if (el) el.innerHTML = '<p class="muted small">Not enough data yet.</p>'; return; }
    const w = 560, h = 190, pad = 30;
    const xs = points.map((_, i) => pad + i * (w - pad * 2) / Math.max(1, points.length - 1));
    let min = Math.min(...points.map(p => p.v)), max = Math.max(...points.map(p => p.v));
    if (min === max) { min -= 1; max += 1; }
    const y = v => invert
      ? pad + (v - min) / (max - min) * (h - pad * 2)
      : h - pad - (v - min) / (max - min) * (h - pad * 2);
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i].toFixed(1)},${y(p.v).toFixed(1)}`).join('');
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}">
      <path d="${path}" fill="none" stroke="url(#lg${invert})" stroke-width="2.5" stroke-linecap="round"/>
      <defs><linearGradient id="lg${invert}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#38bdf8"/><stop offset="1" stop-color="#f5b524"/></linearGradient></defs>
      ${points.map((p, i) => i % Math.ceil(points.length / 5) === 0 ? `<text x="${xs[i]}" y="${h - 6}" fill="#8b98af" font-size="9" text-anchor="middle">${p.label}</text>` : '').join('')}
      <text x="${pad}" y="14" fill="#8b98af" font-size="10">${invert ? 'Rank (lower = better)' : ''}</text>
      <circle cx="${xs[xs.length - 1]}" cy="${y(points[points.length - 1].v)}" r="4" fill="#f5b524"/>
      <text x="${xs[xs.length - 1] - 6}" y="${y(points[points.length - 1].v) - 8}" fill="#fff" font-size="11" font-weight="bold" text-anchor="end">${yLabel(points[points.length - 1].v)}</text>
    </svg>`;
  }
  function barChart(el, points) {
    if (!el || !points.length) { if (el) el.innerHTML = '<p class="muted small">Not enough data yet.</p>'; return; }
    const w = 560, h = 190, pad = 26;
    const max = Math.max(...points.map(p => p.v), 1);
    const bw = (w - pad * 2) / points.length;
    el.innerHTML = `<svg viewBox="0 0 ${w} ${h}">
      ${points.map((p, i) => `<rect x="${(pad + i * bw + 1).toFixed(1)}" y="${(h - pad - (p.v / max) * (h - pad * 2)).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${((p.v / max) * (h - pad * 2)).toFixed(1)}" rx="2" fill="rgba(56,189,248,${0.35 + 0.65 * p.v / max})"><title>${p.label}: ${num(p.v)} votes</title></rect>`).join('')}
      ${points.map((p, i) => i % Math.ceil(points.length / 5) === 0 ? `<text x="${pad + i * bw + bw / 2}" y="${h - 8}" fill="#8b98af" font-size="9" text-anchor="middle">${p.label}</text>` : '').join('')}
    </svg>`;
  }
  if (D.page === 'leader') {
    lineChart($('#rankChart'), (D.rankHistory || []).map(r => ({ v: r.rank, label: r.day.slice(5) })), { invert: true, yLabel: v => '#' + v });
    barChart($('#votesChart'), (D.dailyVotes || []).map(r => ({ v: r.votes, label: r.day.slice(5) })));
  }
  if (D.page === 'country') barChart($('#countryTrend'), (D.trend || []).map(r => ({ v: r.v, label: r.day.slice(5) })));

  // ---------- referral landing ----------
  const ref = new URLSearchParams(location.search).get('ref');
  if (ref && D.page === 'leader') {
    api('/api/referral', { method: 'POST', body: { shareId: ref, slug: D.slug } }).catch(() => {});
    toast('👋 A friend challenged you — your free daily vote is waiting. Make it count!', 'epic', 5000);
  }

  // ---------- load more (leaders grid) ----------
  const lm = $('#loadMore');
  if (lm) lm.onclick = async () => {
    lm.disabled = true; lm.textContent = 'LOADING…';
    const offset = +lm.dataset.offset;
    const r = await api(`/fragment/leaders?category=${lm.dataset.category}&offset=${offset}`).catch(() => null);
    lm.disabled = false; lm.textContent = 'LOAD MORE';
    if (!r) return;
    $('#cardsGrid').insertAdjacentHTML('beforeend', r.html);
    const g = GLUI(); if (g) g.getMyVotes().then(markVoted); else api('/api/my-votes').then(markVoted).catch(() => {});
    lm.dataset.offset = offset + 24;
    if (!r.hasMore) lm.hidden = true;
  };

  // ---------- global click delegation → React adacıkları (GLUI köprüsü) ----------
  document.addEventListener('click', e => {
    const v = e.target.closest('[data-vote]');
    if (v) { e.preventDefault(); return GLUI()?.openVote(v.dataset.vote); }
    const s = e.target.closest('[data-share]');
    if (s) { e.preventDefault(); return GLUI()?.openShare(s.dataset.share); }
    const ba = e.target.closest('[data-buy-ad]');
    if (ba) { e.preventDefault(); return GLUI()?.openAdPurchase(ba.dataset.buyAd); }
    const bn = e.target.closest('[data-buy-anthem]');
    if (bn) { e.preventDefault(); return GLUI()?.openAnthemPurchase(bn.dataset.buyAnthem); }
    const bv = e.target.closest('[data-buy-votes]');
    if (bv) { e.preventDefault(); return GLUI()?.openBuyVotes(); }
    const sc = e.target.closest('[data-share-country]');
    if (sc) {
      e.preventDefault();
      const txt = `${sc.dataset.countryName} is competing on Global Leaders Live. Is your country winning? ${location.origin}/country/${sc.dataset.shareCountry?.toLowerCase() || sc.dataset.shareCountry}`;
      if (navigator.share) navigator.share({ text: txt }).catch(() => {});
      else { navigator.clipboard.writeText(txt).catch(() => {}); toast('🔗 Link copied!', 'success'); }
    }
  });

  // ---------- community "add a leader" form ----------
  const sf = $('#suggestForm');
  if (sf) sf.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(sf);
    const body = Object.fromEntries(fd.entries());
    body.country_code = String(body.country_code || '').toUpperCase();
    const btn = sf.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = 'ADDING…';
    try {
      const r = await api('/api/suggest-leader', { method: 'POST', body });
      toast(`🆕 <b>${esc(body.name)}</b> is now on the ranking! Give them their first vote.`, 'epic', 5500);
      setTimeout(() => location.href = '/leader/' + r.slug, 1800);
    } catch (err) {
      const msgs = { already_exists: 'This leader is already on the ranking.', daily_limit: 'You can add 1 leader per day. Come back tomorrow!', invalid_country: 'Invalid country code — use ISO2 like TR, US, FR.', name_required: 'Please enter a name.', country_required: 'Please enter a 2-letter country code.' };
      toast(msgs[err.error] || 'Could not add leader.', 'error');
      btn.disabled = false; btn.textContent = 'ADD TO THE RANKING';
    }
  });

  // ---------- featured anthem: try to play on load (browsers may require a tap) ----------
  const ap = $('#anthemPlayer');
  if (ap && D.page === 'home') {
    ap.volume = 0.65;
    ap.play().catch(() => { /* autoplay blocked — user can press play */ });
  }

  // ---------- inline anthem player (leader profile) ----------
  let anthemAudio = null;
  document.addEventListener('click', e => {
    const pa = e.target.closest('[data-play-anthem]');
    if (!pa) return;
    e.preventDefault();
    const inline = $('#anthemInline');
    if (anthemAudio && !anthemAudio.paused) {
      anthemAudio.pause();
      pa.classList.remove('playing');
      pa.innerHTML = pa.innerHTML.replace('⏸ PAUSE', '🎵 PLAY');
      if (inline) inline.hidden = true;
      return;
    }
    if (!anthemAudio) {
      anthemAudio = new Audio(pa.dataset.playAnthem);
      anthemAudio.volume = 0.7;
      anthemAudio.onended = () => {
        pa.classList.remove('playing');
        pa.innerHTML = pa.innerHTML.replace('⏸ PAUSE', '🎵 PLAY');
        if (inline) inline.hidden = true;
      };
    }
    anthemAudio.play().then(() => {
      pa.classList.add('playing');
      pa.innerHTML = pa.innerHTML.replace('🎵 PLAY', '⏸ PAUSE');
      if (inline) {
        inline.hidden = false;
        $('#anthemInlineTitle').textContent = '♪ ' + (pa.dataset.anthemTitle || 'National Anthem');
      }
    }).catch(() => toast('Could not play audio', 'error'));
  });

  // ---------- mobile nav ----------
  const nt = $('#navToggle');
  if (nt) nt.onclick = () => {
    const nav = $('.main-nav');
    nav.classList.toggle('open');
    nt.setAttribute('aria-expanded', nav.classList.contains('open'));
  };
})();
