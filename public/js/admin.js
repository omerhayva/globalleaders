/* Admin panel SPA */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const api = (url, opts) => fetch('/api/admin' + url, opts ? { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined } : undefined).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw j; return j; });
  const num = n => (n || 0).toLocaleString('en-US');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast = (m, t = '') => { const el = document.createElement('div'); el.className = 'toast ' + t; el.innerHTML = m; $('#toasts').appendChild(el); setTimeout(() => el.remove(), 4000); };

  const SECTIONS = ['Dashboard','Leaders','Countries','Votes','Ads','Anthems','Payments','Shares & Referrals','Fraud','Sessions','Settings'];
  let current = 'Dashboard';

  async function boot() {
    const me = await api('/me').catch(() => ({ admin: false }));
    if (!me.admin) return renderLogin();
    renderShell();
    show(current);
  }

  function renderLogin() {
    app.innerHTML = `<div class="login-box panel">
      <h2 style="margin-bottom:1rem">🌍 GLOBAL LEADERS <em style="color:var(--accent);font-style:normal">LIVE</em> — ADMIN</h2>
      <div class="field"><label>ADMIN PASSWORD</label><input type="password" id="pw" autofocus></div>
      <button class="btn btn-vote" style="width:100%" id="go">SIGN IN</button>
      <p class="muted small" style="margin-top:0.8rem">Demo default password: <code>leaders2026</code> (change it in Settings)</p></div>`;
    const go = async () => {
      try { await api('/login', { method: 'POST', body: { password: $('#pw').value } }); boot(); }
      catch (e) { toast(e && e.error === 'rate_limited' ? 'Too many attempts — wait a few minutes.' : 'Wrong password', 'error'); }
    };
    $('#go').onclick = go;
    $('#pw').addEventListener('keydown', e => e.key === 'Enter' && go());
  }

  function renderShell() {
    app.innerHTML = `<div class="admin-shell">
      <aside class="admin-side">
        <h1>🌍 GLL <em>ADMIN</em></h1>
        ${SECTIONS.map(s => `<button class="navbtn" data-s="${s}">${s}</button>`).join('')}
        <button class="navbtn" onclick="location.href='/'">← Back to site</button>
        <button class="navbtn" id="logout">Log out</button>
      </aside>
      <main class="admin-main" id="main"></main></div>`;
    app.querySelectorAll('[data-s]').forEach(b => b.onclick = () => show(b.dataset.s));
    $('#logout').onclick = async () => { await api('/logout', { method: 'POST', body: {} }); location.reload(); };
  }

  async function show(section) {
    current = section;
    app.querySelectorAll('.navbtn').forEach(b => b.classList.toggle('active', b.dataset.s === section));
    const main = $('#main');
    main.innerHTML = '<p class="muted">Loading…</p>';
    try { await views[section](main); } catch (e) { main.innerHTML = `<p class="muted">Error: ${esc(e.error || e.message || 'failed')}</p>`; }
  }

  const table = (heads, rows) => `<table class="table"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${heads.length}" class="muted">Nothing yet.</td></tr>`}</tbody></table>`;

  const views = {
    async Dashboard(main) {
      const d = await api('/dashboard');
      main.innerHTML = `
        ${d.demoMode ? '<div class="demo-banner">DEMO MODE — all purchases are simulated · seeded votes are marked demo</div>' : ''}
        <div class="kpis">
          ${[['TOTAL VOTES', num(d.stats.totalVotes)],['VOTES TODAY', num(d.stats.votesToday)],['VOTES / HOUR', num(d.votesPerHour)],
             ['LEADERS', d.stats.leaders],['COUNTRIES', d.stats.countries],['SESSIONS', num(d.sessions)],['SESSIONS TODAY', num(d.sessionsToday)],
             ['SHARES', num(d.shares)],['REFERRAL CLICKS', num(d.referralClicks)],['LIVE VIEWERS (SSE)', d.sseClients],
             ['FRAUD EVENTS', num(d.fraudCount)],['REVENUE TOTAL', '$' + d.revenue.total.toFixed(2)],['REVENUE TODAY', '$' + d.revenue.today.toFixed(2)],
             ['REVENUE / WEEK', '$' + d.revenue.week.toFixed(2)],['AD REVENUE', '$' + d.revenue.ads.toFixed(2)],['ANTHEM REVENUE', '$' + d.revenue.anthems.toFixed(2)]]
            .map(([l, v]) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`).join('')}
        </div>
        <div class="grid2">
          <div class="panel"><h2>TOP VIRAL LEADERS</h2>${table(['Leader','Shares','Ref. clicks'], d.topViral.map(t => `<tr><td>${esc(t.name)}</td><td>${t.shares}</td><td>${t.clicks}</td></tr>`))}</div>
          <div class="panel"><h2>VOTES BY COUNTRY (7d)</h2>${table(['Country','Votes'], d.votesByCountry.map(c => `<tr><td>${esc(c.country || '—')}</td><td>${num(c.c)}</td></tr>`))}</div>
        </div>`;
    },

    async Leaders(main) {
      const rows = await api('/leaders');
      main.innerHTML = `
        <div style="display:flex;gap:0.6rem;margin-bottom:1rem;flex-wrap:wrap">
          <input id="q" placeholder="Search leaders…" style="flex:1;min-width:200px" class="fieldinput">
          <button class="btn btn-vote" id="addL">+ ADD LEADER</button>
        </div>
        <div class="panel" id="ltable"></div>`;
    styleInput($('#q'));
      const draw = list => $('#ltable').innerHTML = table(['#','Name','Country','Status','Votes','Vis','Feat','Actions'],
        list.map(l => `<tr>
          <td>${l.rank || '—'}</td><td><a href="/leader/${l.slug}" target="_blank" style="color:var(--accent)">${esc(l.name)}</a></td>
          <td>${l.country_code}</td><td>${l.status}</td><td>${num(l.total_votes)}</td>
          <td>${l.visible ? '✅' : '🚫'}</td><td>${l.featured ? '⭐' : ''}</td>
          <td class="rowbtns">
            <button class="btn btn-ghost small" data-edit="${l.id}">Edit</button>
            <button class="btn btn-ghost small" data-tog="${l.id}" data-v="${l.visible}">${l.visible ? 'Hide' : 'Show'}</button>
            <button class="btn btn-ghost small" data-del="${l.id}">Delete</button></td></tr>`));
      draw(rows);
      $('#q').oninput = () => draw(rows.filter(l => l.name.toLowerCase().includes($('#q').value.toLowerCase())));
      $('#addL').onclick = () => leaderForm();
      $('#ltable').onclick = async e => {
        const ed = e.target.closest('[data-edit]'); if (ed) return leaderForm(rows.find(l => l.id == ed.dataset.edit));
        const tg = e.target.closest('[data-tog]'); if (tg) { await api('/leaders/' + tg.dataset.tog, { method: 'PUT', body: { visible: tg.dataset.v == 1 ? 0 : 1 } }); show('Leaders'); }
        const dl = e.target.closest('[data-del]'); if (dl && confirm('Delete this leader?')) { await api('/leaders/' + dl.dataset.del, { method: 'DELETE' }); show('Leaders'); }
      };
    },

    async Countries(main) {
      const rows = await api('/countries');
      main.innerHTML = `<div class="panel">${table(['Code','Name','Anthem title','Audio','Votes','Actions'],
        rows.map(c => `<tr><td>${c.code}</td><td>${esc(c.name)}</td><td>${esc(c.anthem_title || '')}</td>
          <td>${c.anthem_audio ? '🎵' : '<span class="muted">none</span>'}</td><td>${num(c.total_votes)}</td>
          <td class="rowbtns"><button class="btn btn-ghost small" data-edit="${c.code}">Edit</button>
          <button class="btn btn-ghost small" data-audio="${c.code}">Upload audio</button></td></tr>`))}</div>
        <p class="muted small" style="margin-top:0.8rem">⚠️ Only upload legally cleared / licensed anthem recordings. Copyrighted audio is never bundled automatically.</p>
        <input type="file" id="audioFile" accept="audio/mpeg,audio/ogg,audio/wav" hidden>`;
      main.onclick = async e => {
        const ed = e.target.closest('[data-edit]');
        if (ed) {
          const c = rows.find(x => x.code === ed.dataset.edit);
          const name = prompt('Country name', c.name); if (name === null) return;
          const anthem_title = prompt('Anthem title', c.anthem_title || ''); if (anthem_title === null) return;
          await api('/countries/' + c.code, { method: 'PUT', body: { name, anthem_title } });
          show('Countries');
        }
        const au = e.target.closest('[data-audio]');
        if (au) {
          const f = $('#audioFile'); f.onchange = () => {
            const file = f.files[0]; if (!file) return;
            const rd = new FileReader();
            rd.onload = async () => {
              try { await api(`/countries/${au.dataset.audio}/anthem-audio`, { method: 'POST', body: { data: rd.result } }); toast('Audio uploaded ✅', 'success'); show('Countries'); }
              catch (err) { toast(err.error || 'Upload failed', 'error'); }
            };
            rd.readAsDataURL(file);
          };
          f.click();
        }
      };
    },

    async Votes(main) {
      const rows = await api('/votes');
      main.innerHTML = `<div class="panel"><h2>LATEST 100 VOTES</h2>${table(['ID','Leader','Type','Source','Country','Time'],
        rows.map(v => `<tr><td>${v.id}</td><td>${esc(v.leader)}</td><td>${v.type}</td><td>${v.source}</td><td>${v.country || ''}</td><td>${v.created_at}</td></tr>`))}</div>`;
    },

    async Ads(main) {
      const d = await api('/ads');
      main.innerHTML = `
        <div class="panel" style="margin-bottom:1rem"><h2>PLACE / OVERRIDE AD (admin)</h2>
          <div class="grid2">
            <div class="field"><label>SLOT</label><select id="aSlot">${d.slots.map(s => `<option value="${s.id}">${s.label} ($${s.price_usd})</option>`).join('')}</select></div>
            <div class="field"><label>ADVERTISER</label><input id="aName"></div>
            <div class="field"><label>TEXT</label><input id="aText"></div>
            <div class="field"><label>CTA</label><input id="aCta"></div>
            <div class="field"><label>URL</label><input id="aUrl"></div>
            <div class="field"><label>START (optional, ISO)</label><input id="aStart" placeholder="2026-09-02 00:00:00"></div>
            <div class="field"><label>END (optional, ISO)</label><input id="aEnd"></div>
            <div class="field"><label>IMAGE (JPG/PNG/WEBP ≤2MB)</label><input type="file" id="aImg" accept="image/png,image/jpeg,image/webp"></div>
          </div>
          <button class="btn btn-vote" id="aGo">PUBLISH AD</button></div>
        <div class="panel"><h2>ADS</h2>${table(['ID','Slot','Advertiser','Status','Created','Actions'],
          d.ads.map(a => `<tr><td>${a.id}</td><td>${a.slot_id}</td><td>${esc(a.advertiser)}</td><td>${a.status}</td><td>${a.created_at}</td>
            <td>${a.status === 'active' ? `<button class="btn btn-ghost small" data-rm="${a.id}">Remove</button>` : ''}</td></tr>`))}</div>
        <div class="panel" style="margin-top:1rem"><h2>AD PURCHASES</h2>${table(['Slot','Advertiser','Amount','Time'],
          d.purchases.map(p => `<tr><td>${p.slot_id}</td><td>${esc(p.advertiser)}</td><td>$${p.amount_usd}</td><td>${p.created_at}</td></tr>`))}</div>`;
      $('#aGo').onclick = () => {
        const publish = async image => {
          await api('/ads', { method: 'POST', body: { slot_id: $('#aSlot').value, advertiser: $('#aName').value, text: $('#aText').value, cta: $('#aCta').value, url: $('#aUrl').value, starts_at: $('#aStart').value || null, ends_at: $('#aEnd').value || null, image } });
          toast('Ad published ✅', 'success'); show('Ads');
        };
        const f = $('#aImg').files[0];
        if (!f) return publish(null);
        const rd = new FileReader();
        rd.onload = async () => {
          try { const r = await api('/ads/image', { method: 'POST', body: { data: rd.result } }); publish(r.path); }
          catch (err) { toast(err.error || 'Image rejected', 'error'); }
        };
        rd.readAsDataURL(f);
      };
      main.addEventListener('click', async e => {
        const rm = e.target.closest('[data-rm]');
        if (rm) { await api(`/ads/${rm.dataset.rm}/remove`, { method: 'POST', body: {} }); toast('Ad removed'); show('Ads'); }
      });
    },

    async Anthems(main) {
      const d = await api('/anthems');
      main.innerHTML = `
        <div class="panel"><h2>CURRENT ANTHEM SPONSORS</h2>${table(['Country','Sponsor','Since','Actions'],
          d.slots.map(s => `<tr><td>${s.country_code} ${esc(s.name)}</td><td>${esc(s.sponsor)}</td><td>${s.purchased_at}</td>
            <td><button class="btn btn-ghost small" data-clr="${s.country_code}">Clear</button></td></tr>`))}</div>
        <div class="panel" style="margin-top:1rem"><h2>ANTHEM PURCHASES</h2>${table(['Country','Sponsor','Amount','Time'],
          d.purchases.map(p => `<tr><td>${p.country_code}</td><td>${esc(p.sponsor)}</td><td>$${p.amount_usd}</td><td>${p.created_at}</td></tr>`))}</div>`;
      main.onclick = async e => {
        const c = e.target.closest('[data-clr]');
        if (c && confirm('Remove current sponsor?')) { await api(`/anthems/${c.dataset.clr}/clear`, { method: 'POST', body: {} }); show('Anthems'); }
      };
    },

    async Payments(main) {
      const rows = await api('/payments');
      main.innerHTML = `<div class="panel"><h2>PAYMENTS (${rows.length})</h2>${table(['ID','Provider','Kind','Ref','Amount','Status','Demo','Time'],
        rows.map(p => `<tr><td>${p.id}</td><td>${p.provider}</td><td>${p.kind}</td><td>${esc(p.reference)}</td><td>$${p.amount_usd}</td><td>${p.status}</td><td>${p.demo ? 'YES' : 'no'}</td><td>${p.created_at}</td></tr>`))}</div>
        <p class="muted small" style="margin-top:0.8rem">Provider architecture: PaymentProvider interface → MockPaymentProvider active. Register Stripe/PayPal/regional/crypto providers in <code>server/services/payments.js</code>.</p>`;
    },

    async 'Shares & Referrals'(main) {
      const d = await api('/share-analytics');
      main.innerHTML = `<div class="grid2">
        <div class="panel"><h2>BY PLATFORM</h2>${table(['Platform','Shares','Clicks'], d.byPlatform.map(p => `<tr><td>${esc(p.platform)}</td><td>${p.c}</td><td>${p.clicks || 0}</td></tr>`))}</div>
        <div class="panel"><h2>RECENT SHARES</h2>${table(['Leader','Platform','Clicks','Time'], d.recent.map(s => `<tr><td>${esc(s.leader)}</td><td>${s.platform}</td><td>${s.clicks}</td><td>${s.created_at}</td></tr>`))}</div></div>`;
    },

    async Fraud(main) {
      const rows = await api('/fraud');
      main.innerHTML = `<div class="panel"><h2>FRAUD / SUSPICIOUS EVENTS (${rows.length})</h2>${table(['Kind','Session','IP hash','Detail','Time'],
        rows.map(f => `<tr><td>${f.kind}</td><td class="muted">${(f.session_id || '').slice(0, 10)}…</td><td class="muted">${(f.ip_hash || '').slice(0, 10)}…</td><td>${esc(f.detail || '')}</td><td>${f.created_at}</td></tr>`))}</div>`;
    },

    async Sessions(main) {
      const rows = await api('/sessions');
      main.innerHTML = `<div class="panel"><h2>VOTE SESSIONS</h2>${table(['Session·Day','Free used','Bonus','Suspended','Actions'],
        rows.map(s => `<tr><td class="muted">${s.id.slice(0, 14)}…</td><td>${s.free_used}</td><td>${s.bonus_used}/${s.bonus_earned}</td><td>${s.suspended ? '⛔' : ''}</td>
          <td><button class="btn btn-ghost small" data-sus="${s.id}" data-v="${s.suspended}">${s.suspended ? 'Unsuspend' : 'Suspend'}</button></td></tr>`))}</div>`;
      main.onclick = async e => {
        const b = e.target.closest('[data-sus]');
        if (b) { await api(`/sessions/${encodeURIComponent(b.dataset.sus)}/suspend`, { method: 'POST', body: { suspended: b.dataset.v == 0 } }); show('Sessions'); }
      };
    },

    async Settings(main) {
      const s = await api('/settings');
      main.innerHTML = `
        ${s.demo_mode === '1' ? '<div class="demo-banner">DEMO MODE ACTIVE — all purchases are simulated</div>' : ''}
        <div class="grid2">
        <div class="panel"><h2>SETTINGS</h2>
          ${[['demo_mode','Demo mode (simulated payments)'],['simulator_enabled','Live vote simulator (demo votes)']].map(([k, l]) => `
            <div class="field" style="flex-direction:row;align-items:center;justify-content:space-between"><label>${l}</label>
            <button class="btn btn-ghost small" data-t="${k}" data-v="${s[k]}">${s[k] === '1' ? 'ON ✅' : 'OFF'}</button></div>`).join('')}
          <div class="field"><label>FREE VOTES / DAY</label><input id="sFree" value="${esc(s.free_votes_per_day)}"></div>
          <div class="field"><label>MAX BONUS VOTES / DAY</label><input id="sBonus" value="${esc(s.max_bonus_per_day)}"></div>
          <div class="field"><label>ADMIN PASSWORD</label><input id="sPw" value="${esc(s.admin_password)}"></div>
          <button class="btn btn-vote" id="save">SAVE SETTINGS</button></div>
        <div class="panel"><h2>DEMO DATA TOOLS</h2>
          <p class="muted small" style="margin-bottom:0.8rem">Seeded votes are marked <code>demo</code> internally and never represent real opinion. Remove them before production.</p>
          <div class="rowbtns" style="flex-direction:column;align-items:stretch;gap:0.5rem">
            <button class="btn btn-ghost" data-demo="seed-votes">🌱 Seed Demo Data</button>
            <button class="btn btn-ghost" data-demo="reset">♻️ Reset Demo Data</button>
            <button class="btn btn-ghost" data-demo="clear-votes">🧹 Clear Demo Votes</button>
            <button class="btn btn-ghost" data-demo="clear-purchases">💳 Clear Purchases</button>
          </div></div></div>`;
      main.onclick = async e => {
        const t = e.target.closest('[data-t]');
        if (t) { await api('/settings', { method: 'POST', body: { [t.dataset.t]: t.dataset.v === '1' ? '0' : '1' } }); show('Settings'); }
        const dm = e.target.closest('[data-demo]');
        if (dm && confirm('Are you sure?')) { await api('/demo/' + dm.dataset.demo, { method: 'POST', body: {} }); toast('Done ✅', 'success'); show('Settings'); }
        if (e.target.id === 'save') {
          await api('/settings', { method: 'POST', body: { free_votes_per_day: $('#sFree').value, max_bonus_per_day: $('#sBonus').value, admin_password: $('#sPw').value } });
          toast('Saved ✅', 'success');
        }
      };
    }
  };

  function leaderForm(l = {}) {
    const cats = ['presidents','prime-ministers','monarchs','revolutionaries','military','political','influential'];
    const lcats = l.categories ? JSON.parse(l.categories) : [];
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `<div class="modal" style="max-width:560px"><button class="close">×</button>
      <h3>${l.id ? 'Edit' : 'Add'} leader</h3>
      <div class="grid2">
        <div class="field"><label>NAME *</label><input id="fName" value="${esc(l.name || '')}"></div>
        <div class="field"><label>COUNTRY CODE (ISO2) *</label><input id="fCC" value="${esc(l.country_code || '')}" maxlength="2"></div>
        <div class="field"><label>STATUS</label><select id="fStatus"><option value="historical" ${l.status === 'historical' ? 'selected' : ''}>historical</option><option value="current" ${l.status === 'current' ? 'selected' : ''}>current</option></select></div>
        <div class="field"><label>ERA</label><input id="fEra" value="${esc(l.era || '')}"></div>
        <div class="field"><label>YEARS</label><input id="fYears" value="${esc(l.years || '')}"></div>
        <div class="field"><label>TITLE</label><input id="fTitle" value="${esc(l.title || '')}"></div>
      </div>
      <div class="field"><label>BIOGRAPHY (neutral wording)</label><textarea id="fBio" rows="3">${esc(l.bio || '')}</textarea></div>
      <div class="field"><label>CATEGORIES</label><div style="display:flex;flex-wrap:wrap;gap:0.4rem">${cats.map(c => `<label style="font-size:0.75rem"><input type="checkbox" value="${c}" ${lcats.includes(c) ? 'checked' : ''}> ${c}</label>`).join('')}</div></div>
      <div class="field" style="flex-direction:row;gap:1rem">
        <label><input type="checkbox" id="fFeat" ${l.featured ? 'checked' : ''}> Featured</label>
        <label><input type="checkbox" id="fVer" ${l.verified !== 0 ? 'checked' : ''}> Verified</label>
        <label><input type="checkbox" id="fVis" ${l.visible !== 0 ? 'checked' : ''}> Visible</label></div>
      ${l.id ? `<div class="field"><label>PORTRAIT (JPG/PNG/WEBP ≤2MB)</label><input type="file" id="fPortrait" accept="image/*"></div>` : ''}
      <button class="btn btn-vote" style="width:100%" id="fSave">SAVE</button></div>`;
    document.body.appendChild(bd);
    bd.querySelector('.close').onclick = () => bd.remove();
    bd.addEventListener('click', e => e.target === bd && bd.remove());
    $('#fSave', bd).onclick = async () => {
      const body = {
        name: $('#fName', bd).value.trim(), country_code: $('#fCC', bd).value.trim().toUpperCase(),
        status: $('#fStatus', bd).value, era: $('#fEra', bd).value, years: $('#fYears', bd).value,
        title: $('#fTitle', bd).value, bio: $('#fBio', bd).value,
        categories: [...bd.querySelectorAll('input[type=checkbox][value]')].filter(c => c.checked).map(c => c.value),
        featured: $('#fFeat', bd).checked ? 1 : 0, verified: $('#fVer', bd).checked ? 1 : 0, visible: $('#fVis', bd).checked ? 1 : 0
      };
      if (!body.name || !body.country_code) return toast('Name + country code required', 'error');
      try {
        if (l.id) {
          await api('/leaders/' + l.id, { method: 'PUT', body });
          const pf = $('#fPortrait', bd);
          if (pf && pf.files[0]) {
            const rd = new FileReader();
            await new Promise(res => { rd.onload = res; rd.readAsDataURL(pf.files[0]); });
            await api(`/leaders/${l.id}/portrait`, { method: 'POST', body: { data: rd.result } });
          }
        } else await api('/leaders', { method: 'POST', body });
        toast('Saved ✅', 'success'); bd.remove(); show('Leaders');
      } catch (err) { toast(err.error || 'Save failed', 'error'); }
    };
  }

  function styleInput(el) { if (el) { el.style.cssText = 'background:rgba(255,255,255,0.05);border:1px solid var(--panel-border);border-radius:9px;color:var(--text);font:inherit;padding:0.55rem 0.7rem'; } }

  boot();
})();
