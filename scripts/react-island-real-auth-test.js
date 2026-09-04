const fs = require('fs');
const { spawn } = require('child_process');

const source = fs.readFileSync(require.resolve('./react-island-test.js'), 'utf8');
const legacy = "ok(modal.querySelectorAll('.btn-social').length === 2, 'sosyal giriş düğmeleri (X/Google demo)');";
const replacement = "ok(modal.querySelectorAll('input[type=\\\"password\\\"]').length >= 1 && /USERNAME OR EMAIL|USERNAME/.test(modal.textContent), 'gerçek kullanıcı adı/e-posta + şifre giriş formu');\n  ok(!modal.querySelector('.btn-social'), 'sahte sosyal giriş düğmeleri kaldırıldı');\n  ok(/Create account|Forgot password/.test(modal.textContent), 'kayıt ve şifre sıfırlama bağlantıları var');";
if (!source.includes(legacy)) { console.error('Legacy auth assertion not found; test file changed unexpectedly.'); process.exit(1); }

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BASE = 'http://127.0.0.1:3000';
async function waitForServer() { for (let i = 0; i < 60; i++) { try { const res = await fetch(BASE + '/'); if (res.ok) return; } catch (_) {} await sleep(250); } throw new Error('Local test server did not become ready on port 3000.'); }

(async () => {
  const child = spawn(process.execPath, ['server/index.js'], { cwd: require('path').resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'test', PORT: '3000', PUBLIC_BASE_URL: BASE }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));
  try {
    await waitForServer();
    let runnable = source.replace("const BASE = 'http://localhost:3000';", `const BASE = '${BASE}';`).replace(legacy, replacement);
    const reps = [
      ["lb.querySelectorAll('.lb-row').length >= 10", "lb.querySelectorAll('.new-lb-row').length >= 10"],
      ["lb ? lb.querySelectorAll('.lb-row').length : 0", "lb ? lb.querySelectorAll('.new-lb-row').length : 0"],
      ["lb.querySelector('.lb-row')", "lb.querySelector('.new-lb-row')"],
      ["first.querySelectorAll('.lb-rank, .portrait, .lb-info, .lb-votes, .spark, .lb-actions').length === 6", "first.querySelectorAll('.new-rank-column, .new-portrait-wrap, .new-lb-info, .new-vote-stat, .new-trend, .new-actions').length === 6"],
      ["first.querySelector('.lb-country')", "first.querySelector('.new-lb-country')"],
      ["document.querySelector('#leaderboard .lb-row .lb-power i')", "document.querySelector('#leaderboard .new-lb-row .new-power-fill')"],
      ["document.querySelector('#leaderboard .lb-row[data-rank=\"1\"]')", "document.querySelector('#leaderboard .new-lb-row[data-rank=\"1\"]')"],
      ["rank1.querySelector('.rank-num.medal.m1')", "rank1.querySelector('.new-rank.gold, .champion-ring')"],
      ["rank1.querySelector('.crown')", "rank1.querySelector('.new-crown')"],
      ["document.querySelectorAll('#leaderboard .rank-num.medal').length", "document.querySelectorAll('#leaderboard .new-rank.gold, #leaderboard .new-rank.silver, #leaderboard .new-rank.bronze').length"],
      ["document.querySelectorAll('#leaderboard .voted-chip').length", "document.querySelectorAll('#leaderboard .new-voted').length"],
      ["document.querySelector('#leaderboard .lb-row [data-votes]').textContent", "document.querySelector('#leaderboard .new-lb-row .new-vote-number').textContent"],
      ["document.querySelector('#leaderboard .lb-row').dataset.slug", "document.querySelector('#leaderboard .new-lb-row').dataset.slug"],
      ["document.querySelectorAll('#leaderboard .lb-row').length >= 10", "document.querySelectorAll('#leaderboard .new-lb-row').length >= 10"]
    ];
    for (const [a,b] of reps) runnable = runnable.split(a).join(b);
    runnable = runnable.replaceAll('GLUI.openBuyVotes();\n  await sleep(400);', 'GLUI.openBuyVotes();\n  await sleep(1000);');
    runnable = runnable.replace('process.exit(fail ? 1 : 0);', 'global.__REACT_TEST_EXIT_CODE__ = fail ? 1 : 0; return;').replace('process.exit(1);', 'global.__REACT_TEST_EXIT_CODE__ = 1; return;');
    await eval(runnable);
    process.exitCode = global.__REACT_TEST_EXIT_CODE__ || 0;
  } catch (err) { console.error('TEST HATASI:', err); process.exitCode = 1; }
  finally { child.kill('SIGTERM'); await sleep(100); if (!child.killed) child.kill('SIGKILL'); }
})();
