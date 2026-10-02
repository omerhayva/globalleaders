// Google ile giriş — OAuth 2.0 Authorization Code akışı + OpenID Connect.
//
// Neden sunucu tarafı yönlendirme (redirect) yöntemi?
//   • Tarayıcıya Google'ın JS kitaplığını yüklemeye gerek yok → sayfadaki
//     Content-Security-Policy (script-src 'self') olduğu gibi kalır.
//   • Client secret yalnızca sunucuda durur, tarayıcıya asla sızmaz.
//   • Çerez tabanlı oturumumuz (gl_session) korunur; oy bakiyesi Google
//     hesabına bağlanır.
//
// Gerekli ortam değişkenleri:
//   GOOGLE_CLIENT_ID      — Google Cloud Console → OAuth istemci kimliği
//   GOOGLE_CLIENT_SECRET  — aynı ekrandaki istemci sırrı
//   GOOGLE_REDIRECT_URI   — (isteğe bağlı) tam yönlendirme adresi; boşsa
//                           PUBLIC_BASE_URL + /api/auth/google/callback
//   GOOGLE_AUTH_URL / GOOGLE_TOKEN_URL / GOOGLE_USERINFO_URL
//                         — (isteğe bağlı) yalnızca testlerde sahte Google
const crypto = require('crypto');

const clientId = () => String(process.env.GOOGLE_CLIENT_ID || '').trim();
const clientSecret = () => String(process.env.GOOGLE_CLIENT_SECRET || '').trim();

// Anahtarlar tanımlı değilse arayüzde Google düğmesi hiç gösterilmez.
const configured = () => !!(clientId() && clientSecret());

const authorizeEndpoint = () => process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const tokenEndpoint = () => process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const userinfoEndpoint = () => process.env.GOOGLE_USERINFO_URL || 'https://www.googleapis.com/oauth2/v3/userinfo';

// Google'a bildirilecek dönüş adresi. Google Cloud Console'da BİREBİR aynı
// adresin "Authorized redirect URI" olarak eklenmiş olması gerekir.
function redirectUri(req) {
  const explicit = String(process.env.GOOGLE_REDIRECT_URI || '').trim();
  if (explicit) return explicit;
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  if (base) return `${base}/api/auth/google/callback`;
  const proto = String(req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http')).split(',')[0].trim();
  return `${proto}://${req.headers.host}/api/auth/google/callback`;
}

const newState = () => crypto.randomBytes(24).toString('hex');

// CSRF koruması: state değeri hem Google'a gider hem httpOnly çereze yazılır;
// dönüşte ikisi eşleşmezse giriş iptal edilir.
function stateMatches(a, b) {
  const x = String(a || ''), y = String(b || '');
  if (!x || !y || x.length !== y.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(y)); } catch { return false; }
}

function authUrl({ state, redirectUri: ru, loginHint }) {
  const p = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: ru,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'select_account'
  });
  if (loginHint) p.set('login_hint', String(loginHint).slice(0, 160));
  return `${authorizeEndpoint()}?${p.toString()}`;
}

async function exchangeCode({ code, redirectUri: ru }) {
  const body = new URLSearchParams({
    code: String(code),
    client_id: clientId(),
    client_secret: clientSecret(),
    redirect_uri: ru,
    grant_type: 'authorization_code'
  });
  const r = await fetch(tokenEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.access_token) throw new Error(`google_token_exchange_failed:${json.error || r.status}`);
  return json;
}

async function userInfo(accessToken) {
  const r = await fetch(userinfoEndpoint(), {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || !json.sub) throw new Error(`google_userinfo_failed:${json.error || r.status}`);
  return json;
}

module.exports = { configured, redirectUri, newState, stateMatches, authUrl, exchangeCode, userInfo, clientId };
