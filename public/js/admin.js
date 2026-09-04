/* Admin panel SPA */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const app = $('#app');
  const api = (url, opts) => fetch('/api/admin' + url, opts ? { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined } : undefined).then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw j; return j; });
  const num = n => (n || 0).toLocaleString('en-US');
  const esc = s => String(s ?? '').replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]));
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
    </div>`;
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
      main.innerHTML = `<div style="display:flex;gap:0.6rem;margin-bottom:1rem;flex-wrap:wrap"><input id="q" placeholder="Search leaders…" style="flex:1;min-width:200px" class="fieldinput"><button class="btn btn-vote" id="addL">+ ADD LEADER</button></div><div class="panel" id="ltable"></div>`;
      styleInput($('#q'));
      const draw = list => $('#ltable').innerHTML = table(['#','Name','Country','Status','Votes','Vis','Feat','Actions'], list.map(l => `<tr><td>${l.rank || '—'}</td><td><a href="/leader/${l.slug}" target="_blank" style="color:var(--accent)">${esc(l.name)}</a></td><td>${l.country_code}</td><td>${l.status}</td><td>${num(l.total_votes)}</td><td>${l.visible ? '✅' : '🚫'}</td><td>${l.featured ? '⭐' : ''}</td><td class="rowbtns"><button class="btn btn-ghost small" data-edit="${l.id}">Edit</button><button class="btn btn-ghost small" data-tog="${l.id}" data-v="${l.visible}">${l.visible ? 'Hide' : 'Show'}</button><button class="btn btn-ghost small" data-del="${l.id}">Delete</button></td></tr>`));
      draw(rows);
      $('#q').oninput = () => draw(rows.filter(l => l.name.toLowerCase().includes($('#q').value.toLowerCase())));
      $('#addL').onclick = () => leaderForm();
      $('#ltable').onclick = async e => {
        const ed = e.target.closest('[data-edit]'); if (ed) return leaderForm(rows.find(l => l.id == ed.dataset.edit));
        const tg = e.target.closest('[data-tog]'); if (tg) { await api('/leaders/' + tg.dataset.tog, { method: 'PUT', body: { visible: tg.dataset.v == 1 ? 0 : 1 } }); show('Leaders'); }
        const dl = e.target.closest('[data-del]'); if (dl && confirm('Archive this leader?')) { await api('/leaders/' + dl.dataset.del, { method: 'DELETE' }); show('Leaders'); }
      };
    },

    async Countries(main) {
      const rows = await api('/countries');
      main.innerHTML = `<div class="panel">${table(['Code','Name','Anthem title','Audio','Votes','Actions'], rows.map(c => `<tr><td>${c.code}</td><td>${esc(c.name)}</td><td>${esc(c.anthem_title || '')}</td><td>${c.anthem_audio ? '🎵' : '<span class="muted">none</span>'}</td><td>${num(c.total_votes)}</td><td class="rowbtns"><button class="btn btn-ghost small" data-edit="${c.code}">Edit</button><button class="btn btn-ghost small" data-audio="${c.code}">Upload audio</button></td></tr>`))}</div><p class="muted small" style="margin-top:0.8rem">⚠️ Only upload legally cleared / licensed anthem recordings. Copyrighted audio is never bundled automatically.</p><input type="file" id="audioFile" accept="audio/mpeg,audio/ogg,audio/wav" hidden>`;
      main.onclick = async e => {
        const ed = e.target.closest('[data-edit]'); if (ed) { const c = rows.find(x => x.code === ed.dataset.edit); const name = prompt('Country name', c.name); if (name === null) return; const anthem_title = prompt('Anthem title', c.anthem_title || ''); if (anthem_title === null) return; await api('/countries/' + c.code, { method: 'PUT', body: { name, anthem_title } }); show('Countries'); }
        const au = e.target.closest('[data-audio]'); if (au) { const f = $('#audioFile'); f.onchange = () => { const file = f.files[0]; if (!file) return; const rd = new FileReader(); rd.onload = async () => { try { await api(`/countries/${au.dataset.audio}/anthem-audio`, { method: 'POST', body: { data: rd.result } }); toast('Audio uploaded ✅', 'success'); show('Countries'); } catch (err) { toast(err.error || 'Upload failed', 'error'); } }; rd.readAsDataURL(file); }; f.click(); }
      };
    },

    async Votes(main) { const rows = await api('/votes'); main.innerHTML = `<div class="panel"><h2>LATEST 100 VOTES</h2>${table(['ID','Leader','Type','Source','Country','Time'], rows.map(v => `<tr><td>${v.id}</td><td>${esc(v.leader)}</td><td>${v.type}</td><td>${v.source}</td><td>${v.country || ''}</td><td>${v.created_at}</td></tr>`))}</div>`; },

    async Ads(main) {
      const d = await api('/ads');
      main.innerHTML = `<div class="panel" style="margin-bottom:1rem"><h2>PLACE / OVERRIDE AD (admin)</h2><div class="grid2"><div class="field"><label>SLOT</label><select id="aSlot">${d.slots.map(s => `<option value="${s.id}">${s.label} ($${s.price_usd})</option>`).join('')}</select></div><div class="field"><label>ADVERTISER</label><input id="aName"></div><div class="field"><label>TEXT</label><input id="aText"></div><div class="field"><label>CTA</label><input id="aCta"></div><div class="field"><label>URL</label><input id="aUrl"></div><div class="field"><label>START (optional, ISO)</label><input id="aStart" placeholder="2026-09-02 00:00:00"></div><div class="field"><label>END (optional, ISO)</label><input id="aEnd"></div><div class="field"><label>IMAGE (JPG/PNG/WEBP ≤2MB)</label><input type="file" id="aImg" accept="image/png,image/jpeg,image/webp"></div></div><button class="btn btn-vote" id="aGo">PUBLISH AD</button></div><div class="panel"><h2>ADS</h2>${table(['ID','Slot','Advertiser','Status','Created','Actions'], d.ads.map(a => `<tr><td>${a.id}</td><td>${a.slot_id}</td><td>${esc(a.advertiser)}</td><td>${a.status}</td><td>${a.created_at}</td><td>${a.status === 'active' ? `<button class="btn btn-ghost small" data-rm="${a.id}">Remove</button>` : ''}</td></tr>`))}</div><div class="panel" style="margin-top:1rem"><h2>AD PURCHASES</h2>${table(['Slot','Advertiser','Amount','Time'], d.purchases.map(p => `<tr><td>${p.slot_id}</td><td>${esc(p.advertiser)}</td><td>$${p.amount_usd}</td><td>${p.created_at}</td></tr>`))}</div>`;
      $('#aGo').onclick = () => { const publish = async image => { await api('/ads', { method: 'POST', body: { slot_id: $('#aSlot').value, advertiser: $('#aName').value, text: $('#aText').value, cta: $('#aCta').value, url: $('#aUrl').value, starts_at: $('#aStart').value || null, ends_at: $('#aEnd').value || null, image } }); toast('Ad published ✅', 'success'); show('Ads'); }; const f = $('#aImg').files[0]; if (!f) return publish(null); const rd = new FileReader(); rd.onload = async () => { try { const r = await api('/ads/image', { method: 'POST', body: { data: rd.result } }); publish(r.path); } catch (err) { toast(err.error || 'Image rejected', 'error'); } }; rd.readAsDataURL(f); };
      main.addEventListener('click', async e => { const rm = e.target.closest('[data-rm]'); if (rm) { await api(`/ads/${rm.dataset.rm}/remove`, { method: 'POST', body: {} }); toast('Ad removed'); show('Ads'); } });
    },

    async Anthems(main) { const d = await api('/anthems'); main.innerHTML = `<div class="panel"><h2>ANTHEM SPONSORSHIPS</h2>${table(['Country','Sponsor','Price','Purchased','Actions'], d.slots.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.sponsor)}</td><td>$${a.price_usd}</td><td>${a.purchased_at || ''}</td><td><button class="btn btn-ghost small" data-clear="${a.country_code}">Clear</button></td></tr>`))}</div>`; main.onclick = async e => { const b = e.target.closest('[data-clear]'); if (b && confirm('Clear this anthem sponsor?')) { await api(`/anthems/${b.dataset.clear}/clear`, { method:'POST', body:{} }); show('Anthems'); } }; },

    async Payments(main) { const rows = await api('/payments'); main.innerHTML = `<div class="panel"><h2>PAYMENTS</h2>${table(['ID','Provider','Kind','Ref','Amount','Status','Created'], rows.map(p => `<tr><td>${p.id}</td><td>${esc(p.provider)}</td><td>${esc(p.kind)}</td><td>${esc(p.reference)}</td><td>$${Number(p.amount_usd || 0).toFixed(2)}</td><td>${esc(p.status)}</td><td>${p.created_at}</td></tr>`))}</div>`; },

    async ['Shares & Referrals'](main) { const d = await api('/share-analytics'); main.innerHTML = `<div class="grid2"><div class="panel"><h2>BY PLATFORM</h2>${table(['Platform','Shares','Clicks'], d.byPlatform.map(x => `<tr><td>${esc(x.platform)}</td><td>${x.c}</td><td>${x.clicks || 0}</td></tr>`))}</div><div class="panel"><h2>TOP VIRAL</h2>${table(['Leader','Shares','Clicks'], d.top.map(x => `<tr><td>${esc(x.name)}</td><td>${x.shares}</td><td>${x.clicks || 0}</td></tr>`))}</div></div>`; },

    async Fraud(main) { const rows = await api('/fraud'); main.innerHTML = `<div class="panel"><h2>FRAUD EVENTS</h2>${table(['ID','Kind','Session','IP hash','Detail','Time'], rows.map(f => `<tr><td>${f.id}</td><td>${esc(f.kind)}</td><td>${esc(f.session_id)}</td><td><code>${esc(f.ip_hash)}</code></td><td>${esc(f.detail)}</td><td>${f.created_at}</td></tr>`))}</div>`; },

    async Sessions(main) { const rows = await api('/sessions'); main.innerHTML = `<div class="panel"><h2>SESSIONS</h2>${table(['ID','Day','Free','Bonus earned','Bonus used','Suspended'], rows.map(s => `<tr><td><code>${s.id}</code></td><td>${s.day}</td><td>${s.free_used}</td><td>${s.bonus_earned}</td><td>${s.bonus_used}</td><td>${s.suspended ? 'YES' : 'NO'}</td></tr>`))}</div>`; },

    async Settings(main) {
      const s = await api('/settings');
      main.innerHTML = `<div class="panel"><h2>SETTINGS</h2><p class="muted small">Security-sensitive credentials and payment wallet configuration are environment variables and cannot be changed here.</p>${Object.entries(s).map(([k,v]) => `<div class="field"><label>${esc(k)}</label><input data-k="${esc(k)}" value="${esc(v)}"></div>`).join('')}<button class="btn btn-vote" id="saveSettings">SAVE</button></div>`;
      $('#saveSettings').onclick = async () => { const body = {}; main.querySelectorAll('[data-k]').forEach(i => body[i.dataset.k] = i.value); await api('/settings', { method:'POST', body }); toast('Settings saved ✅', 'success'); };
    }
  };

  function styleInput(el) { if (el) { el.style.padding = '.65rem .8rem'; el.style.border = '1px solid var(--panel-border)'; el.style.background = 'var(--panel)'; el.style.color = 'var(--text)'; el.style.borderRadius = '10px'; } }
  function leaderForm(l = null) { const m = document.createElement('div'); m.className = 'modal-backdrop'; m.innerHTML = `<div class="modal"><button class="close" aria-label="Close">×</button><h2>${l ? 'EDIT LEADER' : 'ADD LEADER'}</h2><div class="grid2"><div class="field"><label>NAME</label><input id="fName" value="${esc(l?.name)}"></div><div class="field"><label>COUNTRY CODE</label><input id="fCc" maxlength="2" value="${esc(l?.country_code)}"></div><div class="field"><label>STATUS</label><select id="fStatus"><option ${l?.status==='current'?'selected':''}>current</option><option ${l?.status==='historical'?'selected':''}>historical</option></select></div><div class="field"><label>TITLE</label><input id="fTitle" value="${esc(l?.title)}"></div><div class="field"><label>ERA</label><input id="fEra" value="${esc(l?.era)}"></div><div class="field"><label>YEARS</label><input id="fYears" value="${esc(l?.years)}"></div><div class="field"><label>PORTRAIT PATH</label><input id="fPortrait" value="${esc(l?.portrait)}"></div><div class="field"><label>CATEGORIES (comma separated)</label><input id="fCats" value="${esc(Array.isArray(l?.categories) ? l.categories.join(',') : '')}"></div><div class="field" style="grid-column:1/-1"><label>BIO</label><textarea id="fBio" rows="5">${esc(l?.bio)}</textarea></div></div><button class="btn btn-vote" id="fSave">SAVE</button></div>`; $('#modals').appendChild(m); m.querySelector('.close').onclick = () => m.remove(); m.querySelector('#fSave').onclick = async () => { const body = { name: $('#fName',m).value, country_code: $('#fCc',m).value, status: $('#fStatus',m).value, title: $('#fTitle',m).value, era: $('#fEra',m).value, years: $('#fYears',m).value, portrait: $('#fPortrait',m).value, categories: $('#fCats',m).value.split(',').map(x=>x.trim()).filter(Boolean), bio: $('#fBio',m).value }; if (l) await api('/leaders/'+l.id,{method:'PUT',body}); else await api('/leaders',{method:'POST',body}); m.remove(); show('Leaders'); };
  }

  boot();
})();
