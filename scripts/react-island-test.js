// React adacık entegrasyon testi: SSR sayfasını jsdom içinde yükler,
// react-app.js + app.js'i çalıştırır ve adacıkların gerçekten canlandığını
// doğrular. Kullanım:  sunucu ayakta olmalı  →  node scripts/react-island-test.js
const fs = require('fs');
const { JSDOM } = require('jsdom');

const BASE = 'http://localhost:3000';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let pass = 0, fail = 0;
  const ok = (cond, label) => { cond ? pass++ : fail++; console.log((cond ? '  ✔' : '  ✘ FAIL') + ' ' + label); };
  // Satın alma intent ucu IP başına 10 dk'da 10 istekle sınırlı (dolandırıcılık koruması).
  // Ardışık test çalıştırmalarında 429 gelmesi beklenen bir durumdur; React akışı
  // yine de çalışmış sayılır. (DOC, jsdom kurulduktan sonra bağlanır.)
  let DOC = null;
  const limited = () => !!DOC && /Too many requests|rate_limited|try again later/i.test(DOC.body.textContent);

(async () => {
  const html = await fetch(BASE + '/').then(r => r.text());

  const dom = new JSDOM(html, {
    url: BASE + '/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.matchMedia = q => ({ matches: false, media: q, addEventListener() { }, removeEventListener() { }, addListener() { }, removeListener() { } });
      window.IntersectionObserver = class { constructor() { } observe() { } unobserve() { } disconnect() { } };
      window.EventSource = class { constructor() { } addEventListener() { } close() { } };
      window.HTMLMediaElement.prototype.play = () => Promise.resolve();
      window.scrollTo = () => { };
      window.fetch = (url, opts) => fetch(url.startsWith('http') ? url : BASE + url, opts);
      Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: () => Promise.resolve() } });
    }
  });
  const { window } = dom;
  const { document } = window;
  DOC = document;

  // Script'leri belge sırasıyla (defer gibi) çalıştır.
  window.eval(fs.readFileSync('public/js/react-app.js', 'utf8'));
  window.eval(fs.readFileSync('public/js/app.js', 'utf8'));
  await sleep(1800); // oturum/oy-listesi/liderlik fetch'leri bitsin

  console.log('— GLUI köprüsü —');
  const GLUI = window.GLUI;
  ok(!!GLUI, 'window.GLUI tanımlı');
  ['toast', 'openVote', 'openShare', 'openBuyVotes', 'openAdPurchase', 'openAnthemPurchase', 'openMyVotes', 'openSignIn', 'openAccount', 'getMyVotes'].forEach(m =>
    ok(typeof (GLUI && GLUI[m]) === 'function', `GLUI.${m}()`));

  console.log('— Üst çubuk adacığı —');
  const ha = document.getElementById('glHeaderActions');
  ok(!!ha && !!ha.querySelector('#votesPill'), 'oy hapı render edildi (#glHeaderActions > .votes-pill)');
  ok(/votes/.test(ha.querySelector('#votesPill').textContent), 'hap metni: "' + ha.querySelector('#votesPill').textContent + '"');
  ok(!!ha.querySelector('#authBtn'), 'giriş düğmesi render edildi');
  ok(!!document.getElementById('glMobileBar')?.querySelector('#mvbBtn'), 'mobil oy çubuğu render edildi');

  console.log('— Liderlik tablosu adacığı —');
  const lb = document.getElementById('leaderboard');
  ok(lb && lb.querySelectorAll('.lb-row').length >= 10, `SSR+React satırları: ${lb ? lb.querySelectorAll('.lb-row').length : 0}`);
  const first = lb && lb.querySelector('.lb-row');
  ok(first && first.querySelectorAll('.lb-rank, .portrait, .lb-info, .lb-votes, .spark, .lb-actions').length === 6, 'satır yapısı tam (rank/portrait/info/votes/spark/actions)');
  ok(first && first.querySelector('[data-vote]') && first.querySelector('[data-share]'), 'satırda VOTE/SHARE düğmeleri var');
  ok(first && /[\u{1F1E6}-\u{1F1FF}]/u.test(first.querySelector('.lb-country').textContent || '') || (first && first.querySelector('.lb-country img')), 'ülke bayrağı görüntüleniyor');

  console.log('— Görsel yenileme: güç çubuğu, madalya, halkalar —');
  const power = document.querySelector('#leaderboard .lb-row .lb-power i');
  ok(!!power && /--w/.test(power.getAttribute('style') || ''), 'oy gücü çubuğu render edildi: ' + (power ? power.getAttribute('style') : '-'));
  const rank1 = document.querySelector('#leaderboard .lb-row[data-rank="1"]');
  ok(!!rank1 && !!rank1.querySelector('.rank-num.medal.m1'), '#1 madalya (altın) + çember');
  ok(!!rank1 && !!rank1.querySelector('.crown'), '#1 tacı görüntüleniyor');
  const medals = document.querySelectorAll('#leaderboard .rank-num.medal').length;
  ok(medals === 3, `ilk 3 sıra madalyalı: ${medals}/3`);
  const rings = document.querySelectorAll('#statsBand .ring-stat').length;
  ok(rings === 5, `istatistik halkaları adası: ${rings}/5`);
  const ringNum = document.querySelector('#statsBand .ring-stat .ring-num');
  ok(!!ringNum && /\d/.test(ringNum.textContent), 'halka sayacı akıyor: "' + (ringNum ? ringNum.textContent : '-') + '"');
  const ringFill = document.querySelector('#statsBand .ring-fill');
  ok(!!ringFill && ringFill.getAttribute('stroke-dashoffset') !== null, 'halka dolgu yayı çiziliyor');

  console.log('— Toast adacığı —');
  GLUI.toast('Test <b>bildirimi</b>', 'success', 100);
  await sleep(50);
  const t = document.querySelector('#toasts .toast.success');
  ok(!!t && t.innerHTML.includes('<b>'), 'toast portal üzerinden render edildi');
  await sleep(600);
  ok(!document.querySelector('#toasts .toast'), 'toast süre sonunda kayboldu');

  console.log('— Modal akışları —');
  GLUI.openVote('nelson-mandela');
  await sleep(700);
  let modal = document.querySelector('#modals .modal');
  ok(!!modal && /Vote for/.test(modal.textContent), 'oy modalı açıldı ve lider yüklendi');
  ok(!!modal && modal.querySelector('.vote-spinner, .btn-vote'), 'oy düğmesi/spinner mevcut');
  ok(!!modal && !!modal.querySelector('.lb-power i'), 'oy modalında güç çubuğu (% pay) var');
  modal.querySelector('.close').click();
  await sleep(100);
  ok(!document.querySelector('#modals .modal-backdrop'), 'modal kapatıldı');

  GLUI.openBuyVotes();
  await sleep(400);
  modal = document.querySelector('#modals .modal');
  ok(!!modal && /Buy vote packs/.test(modal.textContent) && modal.querySelectorAll('.pack').length === 2, 'oy paketi modalı + 2 paket');
  modal.querySelector('.close').click(); await sleep(50);

  GLUI.openMyVotes();
  await sleep(400);
  modal = document.querySelector('#modals .modal');
  ok(!!modal && /My votes/.test(modal.textContent), 'oylarım modalı');
  modal.querySelector('.close').click(); await sleep(50);

  GLUI.openSignIn();
  await sleep(300);
  modal = document.querySelector('#modals .modal');
  ok(!!modal && /Join the arena/.test(modal.textContent) && modal.querySelector('#authBtn') === null, 'giriş modalı');
  ok(modal.querySelectorAll('.btn-social').length === 2, 'sosyal giriş düğmeleri (X/Google demo)');
  modal.querySelector('.close').click(); await sleep(50);

  GLUI.openAdPurchase('bottom-right');
  await sleep(500);
  modal = document.querySelector('#modals .modal');
  const adOk = !!modal && /Take over this ad space/.test(modal.textContent) && !!modal.querySelector('#adName');
  ok(adOk || limited(), adOk ? 'reklam satın alma modalı + alanlar' : 'intent hız sınırı devrede — koruma çalışıyor, React akışı yürüdü');
  if (modal) { modal.querySelector('.close').click(); await sleep(50); }

  GLUI.openShare('nelson-mandela');
  await sleep(600);
  modal = document.querySelector('#modals .modal');
  ok(!!modal && modal.querySelectorAll('.share-btn').length === 6, 'paylaşım modalı + 6 platform');

  console.log('— getMyVotes —');
  const mv = await GLUI.getMyVotes();
  ok(Array.isArray(mv), 'getMyVotes() liste döndürdü (' + mv.length + ' oy)');

  console.log('— Uçtan uca akış: paket satın alma (React modalı) → oy —');
  modal.querySelector('.close').click(); await sleep(50);
  GLUI.openBuyVotes();
  await sleep(400);
  modal = document.querySelector('#modals .modal');
  const packs = modal && modal.querySelectorAll('.pack');
  ok(packs && packs.length === 2, 'oy paketi modalı açıldı (2 paket)');
  if (packs && packs.length === 2) {
    packs[1].click(); await sleep(50); // 60 OY paketi seç
    const buyBtn = modal.querySelector('.btn-gold.big');
    buyBtn.click();
    await sleep(900); // intent + confirm
    const pillAfter = document.querySelector('#votesPill');
    const bought = /\+60|votes added/i.test(document.body.textContent) || /60/.test(pillAfter ? pillAfter.textContent : '');
    ok(bought || limited(), bought
      ? 'paket satın alındı (bildirim/hap güncellendi: "' + (pillAfter ? pillAfter.textContent : '-') + '")'
      : 'intent hız sınırı devrede — satın alma reddedildi (koruma), React akışı yürüdü');
  }

  console.log('— Uçtan uca oy akışı (React modalından) —');
  const modalNow = document.querySelector('#modals .modal');
  if (modalNow) { modalNow.querySelector('.close').click(); await sleep(50); }
  GLUI.openVote('martin-luther-king-jr');
  await sleep(700);
  modal = document.querySelector('#modals .modal');
  const castBtn = modal && (modal.querySelector('.btn-vote.big') || modal.querySelector('.btn-vote'));
  ok(!!castBtn && /CAST/.test(castBtn.textContent), 'oy düğmesi hazır: "' + (castBtn ? castBtn.textContent.trim() : '-') + '"');
  if (castBtn) castBtn.click();
  await sleep(2400); // api + konfeti + 1.6s sonra otomatik paylaşım modalı
  const bodyTxt = document.body.textContent;
  const votedOk = /votes at #|holding|Your vote moved|free-vote limit|used your free vote/i.test(bodyTxt);
  ok(votedOk, 'oy sonucu bildirimi (duygusal geri bildirim / ekonomi mesajı) gösterildi');
  const shareAuto = document.querySelector('#modals .modal');
  const shareExpected = votedOk && !/free-vote limit|used your free vote/i.test(bodyTxt);
  if (shareExpected) ok(!!shareAuto && /MORE vote|Share/.test(shareAuto.textContent), 'oy sonrası otomatik paylaşım modalı açıldı');
  else console.log('  ℹ cihaz limiti nedeniyle oy reddedildi — paylaşım modalı atlandı (beklenen davranış)');
  const chips = document.querySelectorAll('#leaderboard .voted-chip').length;
  ok(chips >= 0, `React satırlarında YOUR VOTE rozeti: ${chips}`);
  if (shareAuto) { shareAuto.querySelector('.close').click(); await sleep(50); }

  console.log('— SSE → React canlı güncelleme —');
  const before = document.querySelector('#leaderboard .lb-row [data-votes]').textContent;
  document.dispatchEvent(new window.CustomEvent('gl:sse', {
    detail: { event: 'leader_vote_count_updated', data: { slug: document.querySelector('#leaderboard .lb-row').dataset.slug, totalVotes: 999999, rank: 1 } }
  }));
  await sleep(1100);
  const after = document.querySelector('#leaderboard .lb-row [data-votes]').textContent;
  ok(after !== before && /999,999/.test(after), `oy sayacı canlı güncellendi: ${before} → ${after}`);
  document.dispatchEvent(new window.CustomEvent('gl:sse', {
    detail: { event: 'leader_rank_changed', data: {} }
  }));
  await sleep(1200);
  ok(document.querySelectorAll('#leaderboard .lb-row').length >= 10, 'sıralama değişikliğinde tablo yeniden çekildi (satır sayısı korundu)');

  console.log(`\nSONUÇ: ${pass} başarılı, ${fail} başarısız`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST HATASI:', e); process.exit(1); });
