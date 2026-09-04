// Server-side rendered pages: SEO meta + OG tags + initial content, hydrated by /js/app.js
const core = require('./core');
const db = require('./db');

const esc = s => String(s ?? '').replace(/[&<>\"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;', "'": '&#39;' }[c]));
const num = n => (n || 0).toLocaleString('en-US');
const fsMod = require('fs');
const flagLocal = (cc, size) => {
  const f = `/flags/w${size <= 40 ? 40 : 160}/${cc.toLowerCase()}.png`;
  return fsMod.existsSync(require('path').join(__dirname, '..', 'public', f)) ? f : `https://flagcdn.com/w${size}/${cc.toLowerCase()}.png`;
};
const flagImg = (cc, size = 40) => `<img class="flag" src="${flagLocal(cc, size)}" alt="${esc(cc)} flag" width="${size / 2 * 1}" loading="lazy" onerror="this.replaceWith(document.createTextNode('${core.FLAG(cc)}'))">`;

function layout({ title, description, path, og, body, data = {}, activeNav = '', jsonLd = null }) {
  const demoMode = core.getSetting('demo_mode') === '1';
  const freePerDay = parseInt(core.getSetting('free_votes_per_day') || '1', 10);
  const base = String(process.env.PUBLIC_BASE_URL || 'https://globalleaders.live').replace(/\/$/, '');
  const canonical = `${base}${path}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:site_name" content="Global Leaders Live">
<meta property="og:title" content="${esc(og?.title || title)}">
<meta property="og:description" content="${esc(og?.description || description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="website">
${og?.image ? `<meta property="og:image" content="${esc(og.image)}">` : ''}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(og?.title || title)}">
<meta name="twitter:description" content="${esc(og?.description || description)}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="%230b1220"/><text x="16" y="22" text-anchor="middle" font-size="16">🌍</text></svg>').replace(/%25/g,'%')}">
<link rel="stylesheet" href="/fonts/playfair.css">
<link rel="stylesheet" href="/css/style.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header" role="banner">
  <div class="header-inner">
    <a class="brand" href="/" aria-label="Global Leaders Live home"><span class="brand-globe" aria-hidden="true">🌍</span><span class="brand-text">GLOBAL LEADERS <em>LIVE</em></span><span class="live-badge" aria-label="Live updates active"><span class="live-dot"></span>LIVE</span></a>
    <nav class="main-nav" aria-label="Main navigation">${[['LIVE','/'],['LEADERS','/leaders'],['COUNTRIES','/countries'],['HISTORY','/history'],['TRENDING','/trending'],['ABOUT','/about']].map(([n,h]) => `<a href="${h}" ${activeNav===n?'class="active" aria-current="page"':''}>${n}</a>`).join('')}</nav>
    <div class="header-right"><div id="glHeaderActions" class="header-actions"></div><button class="nav-toggle" id="navToggle" aria-label="Open menu" aria-expanded="false">☰</button></div>
  </div>
</header>
<main id="main">${body}</main>
<footer class="site-footer"><div class="footer-grid"><div><div class="brand-text" style="font-size:1.1rem">GLOBAL LEADERS <em>LIVE</em></div><p class="muted">The World Votes. The Ranking Moves.</p><p class="muted small">This is a community voting platform for entertainment. It does not represent scientific polling or official public opinion.</p></div><div><h4>Explore</h4><a href="/leaders">Leaders</a><a href="/countries">Countries</a><a href="/trending">Trending</a><a href="/history">History</a></div><div><h4>Legal</h4><a href="/legal#terms">Terms</a><a href="/legal#privacy">Privacy Policy</a><a href="/legal#cookies">Cookie Policy</a><a href="/legal#community">Community Guidelines</a></div><div><h4>Rules</h4><a href="/legal#voting">Voting Rules</a><a href="/legal#ads">Advertising Rules</a><a href="/legal#payments">Payment Terms</a><a href="/legal#disclaimer">Disclaimer</a></div></div><div class="footer-bottom">© 2026 Global Leaders Live · Community ranking, not a scientific poll · <a href="/admin">Admin</a></div></footer>
<div class="mobile-votebar" id="mobileVotebar" aria-hidden="true"><div id="glMobileBar"></div></div><div id="modals"></div><div id="toasts" aria-live="polite"></div><div id="react-root"></div>
<script>window.__DATA__=${JSON.stringify(data).replace(/</g,'\\u003c')};</script><script src="/js/react-app.js" defer></script><script src="/js/app.js" defer></script>
</body></html>`;
}

// The remaining page/render helpers are intentionally unchanged in behavior.
// They are loaded from the existing module implementation below in the repository.
module.exports = require('./render-pages');
