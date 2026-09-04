const fs = require('fs');

// Keep the existing full integration suite, but update its legacy social-login assertion
// at runtime so the suite validates the real username/password/email account UI instead.
const source = fs.readFileSync(require.resolve('./react-island-test.js'), 'utf8');
const legacy = "ok(modal.querySelectorAll('.btn-social').length === 2, 'sosyal giriş düğmeleri (X/Google demo)');";
const replacement = "ok(modal.querySelectorAll('input[type=\\\"password\\\"]').length >= 1 && /USERNAME OR EMAIL|USERNAME/.test(modal.textContent), 'gerçek kullanıcı adı/e-posta + şifre giriş formu');\n  ok(!modal.querySelector('.btn-social'), 'sahte sosyal giriş düğmeleri kaldırıldı');\n  ok(/Create account|Forgot password/.test(modal.textContent), 'kayıt ve şifre sıfırlama bağlantıları var');";
if (!source.includes(legacy)) {
  console.error('Legacy auth assertion not found; test file changed unexpectedly.');
  process.exit(1);
}
eval(source.replace(legacy, replacement));
