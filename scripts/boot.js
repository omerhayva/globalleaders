const fs = require('fs');
const path = require('path');

const renderPath = path.join(__dirname, '..', 'server', 'render.js');
const publicPath = path.join(__dirname, '..', 'public');

function repairRender() {
  let source = fs.readFileSync(renderPath, 'utf8');
  let changed = false;

  try {
    new Function(source);
  } catch (_) {
    const start = source.indexOf('function trendingPage(){');
    const end = source.indexOf('function aboutPage(){', start);
    if (start < 0 || end < 0) throw new Error('Cannot locate trendingPage boundaries');

    const replacement = `function trendingPage(){
  const t=core.trending();
  const sec=(title,rows,fmt,badge='')=>\`<section class="panel"><div class="panel-head"><h2>\${title} \${badge}</h2></div>\${rows.length?rows.map(fmt).join(''):'<p class="muted small">Nothing here yet — check back soon.</p>'}</section>\`;
  const row=(l,extra)=>\`<a class="trend-row big" href="/leader/\${esc(l.slug)}"><span class="tr-rank">#\${l.rank}</span>\${flagImg(l.country_code,20)} <span>\${esc(l.name)}</span>\${extra}</a>\`;
  const body=\`<section class="page-head"><h1>🔥 TRENDING</h1><p class="muted">Momentum across the last 24 hours and 7 days · updates live</p></section><div class="trending-grid">
    \${sec('↑ FASTEST RISING',t.risers,l=>row(l,\`<b class="up">↑ +\${l.extra}</b>\`),'<span class="tag hot">HOT</span>')}
    \${sec('↓ BIGGEST FALLERS',t.fallers,l=>row(l,\`<b class="down">↓ \${l.extra}</b>\`))}
    \${sec('⚡ MOST VOTED TODAY',t.today,l=>row(l,\`<b>+\${num(l.extra)}</b>\`),'<span class="tag new">LIVE</span>')}
    \${sec('📅 MOST VOTED THIS WEEK',t.week,l=>row(l,\`<b>+\${num(l.extra)}</b>\`))}
    \${sec('📣 MOST SHARED',t.shared,l=>row(l,\`<b>\${num(l.extra)} shares</b>\`),'<span class="tag viral">VIRAL</span>')}
    \${sec('🌍 MOST ACTIVE COUNTRIES',t.activeCountries,c=>\`<a class="trend-row big" href="/country/\${c.code.toLowerCase()}">\${flagImg(c.code,20)} <span>\${esc(c.name)}</span><b>\${num(c.v)} votes</b></a>\`)}
  </div>\`;
  return layout({title:'Trending — Global Leaders Live',path:'/trending',activeNav:'TRENDING',description:'Fastest rising leaders, biggest fallers, most voted today and most viral leaders on Global Leaders Live.',data:{page:'trending'},body});
}
`;
    source = source.slice(0, start) + replacement + source.slice(end);
    new Function(source);
    changed = true;
    console.log('Production boot repaired server/render.js syntax.');
  }

  // Prefer the real portrait asset already shipped in /public/portraits.
  // This keeps SSR image URLs local and only falls back to the generated SVG when
  // a particular leader does not have a matching asset.
  const portraitStart = source.indexOf('function portraitHtml(l, size = 56) {');
  const portraitEnd = source.indexOf('function movementHtml(', portraitStart);
  if (portraitStart >= 0 && portraitEnd > portraitStart) {
    const replacement = `function portraitHtml(l, size = 56) {
  const base = String(l.slug || '').trim();
  const candidates = base ? [
    \\`/portraits/\${base}.jpg\`,
    \\`/portraits/\${base}.jpeg\`,
    \\`/portraits/\${base}.png\`,
    \\`/portraits/\${base}.webp\`
  ] : [];
  const local = candidates.find(src => fsMod.existsSync(require('path').join(__dirname, '..', 'public', src.replace(/^\\//, ''))));
  const src = l.portrait || local || \\`/portrait/\${esc(l.slug)}.svg\`;
  return \\`<img class="portrait" src="\${esc(src)}" alt="Portrait of \${esc(l.name)}" width="\${size}" height="\${size}" loading="lazy">\`;
}
`;
    const current = source.slice(portraitStart, portraitEnd);
    if (current !== replacement) {
      source = source.slice(0, portraitStart) + replacement + source.slice(portraitEnd);
      changed = true;
      console.log('Production boot restored local leader portrait mapping.');
    }
  }

  if (changed) fs.writeFileSync(renderPath, source, 'utf8');
}

repairRender();
require('../server/index.js');
