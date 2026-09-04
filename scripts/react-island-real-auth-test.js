const fs = require('fs');
const { spawn } = require('child_process');

// Keep the existing full integration suite, but update its legacy social-login assertion
// at runtime so the suite validates the real username/password/email account UI instead.
const source = fs.readFileSync(require.resolve('./react-island-test.js'), 'utf8');
const legacy = "ok(modal.querySelectorAll('.btn-social').length === 2, 'sosyal giriş düğmeleri (X/Google demo)');";
const replacement = "ok(modal.querySelectorAll('input[type=\\\"password\\\"]').length >= 1 && /USERNAME OR EMAIL|USERNAME/.test(modal.textContent), 'gerçek kullanıcı adı/e-posta + şifre giriş formu');\n  ok(!modal.querySelector('.btn-social'), 'sahte sosyal giriş düğmeleri kaldırıldı');\n  ok(/Create account|Forgot password/.test(modal.textContent), 'kayıt ve şifre sıfırlama bağlantıları var');";
if (!source.includes(legacy)) {
  console.error('Legacy auth assertion not found; test file changed unexpectedly.');
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const BASE = 'http://127.0.0.1:3000';

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(BASE + '/');
      if (res.ok) return;
    } catch (_) { /* server still starting */ }
    await sleep(250);
  }
  throw new Error('Local test server did not become ready on port 3000.');
}

(async () => {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: require('path').resolve(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: '3000',
      PUBLIC_BASE_URL: BASE
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  child.stdout.on('data', data => process.stdout.write(`[server] ${data}`));
  child.stderr.on('data', data => process.stderr.write(`[server] ${data}`));

  try {
    await waitForServer();

    // The original suite calls process.exit() itself. Replace those exits so this
    // wrapper can always terminate the child server in finally and return the test code.
    const runnable = source
      .replace('const BASE = \'http://localhost:3000\';', `const BASE = '${BASE}';`)
      .replace(legacy, replacement)
      .replace('process.exit(fail ? 1 : 0);', 'global.__REACT_TEST_EXIT_CODE__ = fail ? 1 : 0; return;')
      .replace('process.exit(1);', 'global.__REACT_TEST_EXIT_CODE__ = 1; return;');

    await eval(runnable);
    process.exitCode = global.__REACT_TEST_EXIT_CODE__ || 0;
  } catch (err) {
    console.error('TEST HATASI:', err);
    process.exitCode = 1;
  } finally {
    child.kill('SIGTERM');
    await sleep(100);
    if (!child.killed) child.kill('SIGKILL');
  }
})();
