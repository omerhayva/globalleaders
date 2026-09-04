// Girdi sanitizasyon yardımcıları — sunucu tarafı zorunlu doğrulama.
// (Frontend kısıtları kozmetiktir; gerçek kontrol burada yapılır.)

// Kontrol karakterlerini ve açı parantezlerini temizler (isim/başlık alanları).
// Unicode harf/rakamlara dokunmaz — "Mustafa Kemal Atatürk" gibi isimler korunur.
function cleanText(v, max = 60) {
  return String(v ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')   // kontrol karakterleri
    .replace(/[<>]/g, '')                      // HTML enjeksiyon zemini
    .trim()
    .slice(0, max);
}

// Uzun serbest metin (bio): kontrol karakteri temizliği + uzunluk sınırı.
// (< > render'da esc'lenir ve JSON-LD'de \u003c olarak kodlanır.)
function cleanLong(v, max = 300) {
  return String(v ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max);
}

// Sadece http/https URL'lerine izin verir (javascript:, data:, vbscript: vb. reddedilir).
function sanitizeUrl(u) {
  try {
    const url = new URL(String(u || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

// X (Twitter) kullanıcı adı: 1-15 karakter, [A-Za-z0-9_]
function cleanX(h) {
  const m = String(h || '').trim().replace(/^@+/, '').match(/^[A-Za-z0-9_]{1,15}$/);
  return m ? m[0] : null;
}

// Hesap baş harfleri — kullanıcı adından türetilir, HTML'e girer → sadece alfanümerik.
function safeInitials(name) {
  const s = String(name || '?').replace(/[^\p{L}\p{N}\s]/gu, '').trim();
  const ini = s.split(/\s+/).filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return ini || '?';
}

module.exports = { cleanText, cleanLong, sanitizeUrl, cleanX, safeInitials };
