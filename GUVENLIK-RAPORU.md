# GLOBAL LEADERS LIVE — Güvenlik Denetimi ve Eksik Giderme Raporu

**Tarih:** 03.09.2026 · **Kapsam:** Yetkili yerel denetim (localhost) + kod incelemesi + düzeltme + regresyon testleri
**Yöntem:** Tüm bulgular düzeltmeden ÖNCE çalışan saldırı testleriyle kanıtlandı, düzeltme sonrası aynı testler yeniden çalıştırıldı.

---

## 1. Denetim Sonucu (özet)

| # | Test | Önce | Sonra |
|---|------|------|-------|
| T1 | Başka oturumun ödeme niyetini (intent) onaylama | 🔴 AÇIK | 🟢 RED (wrong_session) |
| T2 | Oturum rotasyonuyla sınırsız bedava oy | 🔴 5/5 oy geçti | 🟢 1/5 (cihaz limiti) |
| T3 | Depolanmış XSS — JSON-LD `</script>` kaçırma | 🔴 AÇIK | 🟢 ESC'leniyor |
| T4 | Reklamveren adında ham HTML depolama | 🔴 AÇIK | 🟢 Sunucuda sanitizasyon |
| T5 | CSRF — yabancı Origin ile POST | 🔴 Kabul | 🟢 403 forbidden_origin |
| T6 | `javascript:` URL'li reklam (admin) | 🔴 AÇIK | 🟢 sanitizeUrl reddi |
| T7 | Hesap ele geçirme (e-posta sahiplenme + profil çalma) | 🔴 AÇIK | 🟡 Demo: birleştirme var, **profil adı değiştirilemiyor**; üretimde tamamen kapalı |
| T8 | IP sahteciliği (X-Forwarded-For spoof) | 🔴 AÇIK | 🟢 Gerçek IP ile limit |
| T9 | Admin kaba kuvvet (12 deneme) | 🔴 Kilitsiz | 🟢 4 deneme sonra 429 |
| T10 | Güvenlik başlıkları | 🔴 Yok | 🟢 CSP + nosniff + referrer + permissions |
| T11 | Kimlik doğrulama flood (25 deneme) | 🔴 Kilitsiz | 🟢 429 hız limiti |

**Önce: 10 açık/eksik → Sonra: 0 açık (1 bilinçli demo davranışı).**
Yeniden çalıştırma: `bash scripts/security-audit.sh`

---

## 2. Bulunan ve Düzeltilen Sorunlar

### 2.1 🔴 KRİTİK — Ödeme niyeti hırsızlığı (T1)
`/api/purchase/confirm` herhangi bir sahiplik kontrolü yapmadan intent'i onaylıyordu: **B oturumu, A oturumunun ödemesini onlayıp oyları/koltuğu kendine alabiliyordu.**
**Düzeltme:** Onay, `payments.confirm` çağrısından **önce** DB'den intent'in `session_id`'si istek oturumuyla eşleşiyor mu diye kontrol edilir; eşleşmezse `403 wrong_session` + `intent_takeover` sahtekârlık kaydı. (Sıralama önemli: eskiden önce onaylanıp sonra reddedilseydi ödeme "yanık" kalırdı.)

### 2.2 🔴 KRİTİK — Oturum rotasyonu = sınırsız bedava oy (T2)
`X-GL-Session` başlığı 32-hex HER değeri kabul ediyordu; yeni kimlik = yeni `vote_sessions` satırı = taze bedava oy. Tek cihazdan 5/5 bedava oy kabul edildi (ekonomi kuralı 1/kişi/gün).
**Düzeltme:** `votes` tablosuna `device_hash` sütunu eklendi (migration + index). `castVotes` artık **cihaz parmak izi** (IP+UA hash'i) bazında günün bedava oy harcamasını TÜM oturumlar üzerinden sayar: `free` hakkı cihaz başına 1, `bonus` hakkı cihaz başına 3 ile sınırlı; **satın alınan oylar sınırsız** (ödendiği için). Limit aşılırsa `429 device_limit`.

### 2.3 🔴 KRİTİK — Depolanmış XSS, herkese açık sayfada (T3)
Topluluk biosu `JSON.stringify` ile `<script type="application/ld+json">` bloğuna ham yazılıyordu. Bio'daki `</script><img src=x onerror=...>` payload'ı **her ziyaretçinin lider sayfasında çalışıyordu** (kanıtlandı).
**Düzeltme:** JSON-LD çıktısındaki tüm `<` karakterleri `\u003c` olarak kodlanır (standart uygulama).

### 2.4 🔴 YÜKSEK — XSS: kullanıcı verisi toast/modal/tooltip'e kaçırılmadan basılıyordu (T4 + kod incelemesi)
`innerHTML` kullanan noktalarda kaçırılmayan dinamik değerler: lider adları (welcome-back toast, oy başarılı toast'ları, oy modalı, "oylarım" modalı, harita tooltip'i), SSE ile yayımlanan sponsor/reklamveren adları (tüm bağlı istemcilerde!), `shareText`, öneri formu adı.
**Düzeltme:** app.js'e global `esc()` eklendi; **13 kullanım noktası** düzeltildi. Sunucu tarafında da isim alanları `cleanText` ile sanitizelendi (katmanlı savunma).

### 2.5 🔴 YÜKSEK — CSRF koruması yoktu (T5)
Oturum çerezi `SameSite=None; Secure` (iframe/preview gereği) → çapraz site istekleri çerez taşır. Origin kontrolü yoktu: `Origin: https://evil.example` ile POST işleniyordu.
**Düzeltme:** Tüm mutating isteklerde (POST/PUT/PATCH/DELETE) Origin/Referer host'u istek host'uyla eşleşmelidir; eşleşmezse `403 forbidden_origin`. Origin yoksa (curl/native) geçer — tarayıcılar çapraz origin POST'ta her zaman Origin gönderir.

### 2.6 🔴 YÜKSEK — IP sahteciliği tüm limitleri atlatıyordu (T8)
`ip()` yardımcısı `X-Forwarded-For` başlığının **ilk** değerini alıyordu. İstemci sahte `X-Forwarded-For: 6.6.6.6` gönderince proxy zinciri `6.6.6.6, gerçekIP` haline gelir ve ilk değer = sahte IP → hız limiti, günlük tavan, cihaz parmak izi hepsi atlatılırdı.
**Düzeltme:** `req.ip` kullanılıyor (`trust proxy=1` ile proxy zincirinin güvenilir ucundan doğru istemci IP'si çözülür).

### 2.7 🔴 YÜKSEK — Admin paneli zayıflıkları (T6, T9)
- Kaba kuvvet kilidi yoktu: 12/12 yanlış parola denemesi işlendi.
- Parola karşılaştırması timing-safe değildi (yan kanal sızıntısı).
- HMAC gizli anahtarı kodda sabitti (`gl-admin-secret-v1`) → token'lar süresiz geçerliydi.
- Admin reklam URL'i `javascript:` şemasını kabul ediyordu; görsel ham data-uri olarak DB'ye giriyordu.
**Düzeltme:** Girişte 5 deneme/10 dk hız limiti; SHA-256 hash üzerinden `timingSafeEqual`; gizli anahtar process başına rastgele (`GL_ADMIN_SECRET` env ile sabitlenebilir); token 12 saat TTL + timing-safe imza; `sanitizeUrl` + sunucu tarafı görsel doğrulama; çerez `secure` (https'te) + `httpOnly`.

### 2.8 🟠 ORTA — Hız limitleri yoktu (T11 + genel)
Kimlik doğrulama, satın alma, öneri ve genel API uçlarında flood koruması yoktu (25/25 istek işlendi; DB doldurulabilirdi).
**Düzeltme:** Yeni `server/services/ratelimit.js` (sabit pencere, IP bazlı): genel `/api` 240/dk; `auth/login` 10/10dk; `purchase/intent` 10/10dk; `purchase/confirm` 15/10dk; `suggest-leader` 3/saat; `admin/login` 5/10dk. Yanıtlara `Retry-After` başlığı eklenir.

### 2.9 🟠 ORTA — Güvenlik başlıkları eksikti (T10)
**Düzeltme:** `Content-Security-Policy` (self + data: görsel; `object-src 'none'`; `base-uri`/`form-action 'self'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`. (Not: `frame-ancestors` bilinçli olarak konmadı — platform önizlemesi iframe'de çalışıyor; canlıya geçerken eklenmeli.)

### 2.10 🟠 ORTA — Reklam görseli sunucuda doğrulanmıyordu (T4/6 ile ilgili)
Genel satın alma akışında görsel, istemciden gelen ham data-uri olarak DB'ye yazılıyordu (16MB'a kadar her şey).
**Düzeltme:** Ortak `services/uploads.js`: MIME + **magic byte** kontrolü + 2MB tavan; dosya `/uploads/` altına yazılır, DB'ye yol kaydedilir. Admin ve genel akış aynı doğrulamayı kullanır. Kanıt: `data:text/html;base64,<script>...` → `400 bad_image`.

### 2.11 🟡 DEMO SINIRLARI — kimlik ve ödeme (T7)
- **Kimlik:** Demo modda e-posta sahiplenerek hesaba "girilebiliyor" (tasarım gereği — gerçek OAuth yok). Düzeltmeler: (1) mevcut kullanıcının **profili artık değiştirilemez** (ad override kaldırıldı), (2) **üretim modunda** (`demo_mode=0`) simüle sosyal giriş `503 oauth_not_configured`, mevcut e-postayı sahiplenme `409 email_taken` ile reddedilir.
- **Ödeme:** Mock sağlayıcı üretim modunda çalışmaz: `demo_mode=0` iken `503 payment_provider_not_configured`. Gerçek para alınmadan önce gerçek sağlayıcı (Stripe/PayPal) + imzalı webhook zorunlu.

### 2.12 🟢 Küçük düzeltmeler
- `my-votes` sıralaması güvenli hale getirildi (`localeCompare`).
- Gizli liderler `/api/leader/:slug` üzerinden sızdırılıyordu → `visible=1` kontrolü eklendi.
- Hesap baş harfleri (avatar) kullanıcı adından türetilırken HTML güvenli karakterlere indiriliyor (`safeInitials`).
- X kullanıcı adları her yerde katı `^[A-Za-z0-9_]{1,15}$` doğrulamasından geçiyor.
- Öneri formundaki tüm alanlar kontrol karakterlerinden arındırılıyor; `years/title` HTML zemini karakterleri temizleniyor.

---

## 3. Değişen/eklenen dosyalar

| Dosya | Değişiklik |
|---|---|
| `server/index.js` | Güvenlik başlıkları, CSRF/Origin guard, genel API hız limiti |
| `server/api.js` | req.ip, uç nokta hız limitleri, ödeme sahiplik + üretim guard'ları, sanitizasyon, görsel doğrulama, device_limit haritası |
| `server/core.js` | Cihaz bazlı bedava/bonus oy limiti, `device_hash`, gizli lider sızıntısı fix'i |
| `server/admin.js` | Rastgele gizli anahtar, token TTL, timing-safe parola, giriş hız limiti, sanitizeUrl, ortak yükleme doğrulaması |
| `server/render.js` | JSON-LD `<` → `\u003c` kodlaması |
| `server/db.js` | `votes.device_hash` migration + index |
| `server/services/ratelimit.js` | **YENİ** — hız limiti altyapısı |
| `server/services/sanitize.js` | **YENİ** — cleanText/cleanLong/sanitizeUrl/cleanX/safeInitials |
| `server/services/uploads.js` | **YENİ** — magic-byte görsel/ses doğrulama |
| `public/js/app.js` | Global `esc()` + 13 XSS noktası + yeni hata mesajları |
| `public/js/admin.js` | Hız limiti bilgilendirmesi |
| `scripts/security-audit.sh` | **YENİ** — 11 senaryolu, tekrar çalıştırılabilir denetim testi |

## 4. Regresyon testleri (düzeltme sonrası) — TÜMÜ GEÇTİ

- 11 sayfa 200 (`/`, `/leaders`, lider/ülke/marş sayfaları, `/admin`…)
- Statik varlıklar 200 (CSS/JS/font/portre/marş/bayrak)
- Oy akışı: yeni cihaz → bedava oy ✅; aynı cihaz yeni oturum → red ✅
- Paylaşım bonusu: +1 bonus ✅ → bonus oyu harcandı ✅
- Oy paketi: satın al → 10 oy ✅ → oylar harcandı ✅ (free 1 + purchased 2 = 3)
- Reklam satın alma: geçerli PNG → `/uploads/…` kaydedildi ve sunuldu ✅; sahte `text/html` → red ✅
- Kimlik: login → me → my-votes → logout ✅
- Admin: login → dashboard → settings ✅
- SSE akışı ✅, `/fragment`, `/og/*.svg`, `/sitemap.xml`, yönlendirme ✅
- Test artefaktları temizlendi (lideler/ülkeler 136/59, aktif test reklamı 0)

## 5. Canlıya geçmeden önce YAPILMASI GEREKENLER (öneri)

1. **Gerçek kimlik doğrulama:** OAuth (X/Google) veya magic-link e-posta bağlayın; demo auth yalnızca `demo_mode=1`'de çalışır.
2. **Gerçek ödeme sağlayıcısı:** Stripe/PayPal implementasyonu + **imzalı webhook doğrulaması** (`/api/webhooks/:provider` şu an stub). Mock üretimde otomatik kilitlenir.
3. **Admin parolası:** Varsayılan `leaders2026`'yı Settings'ten değiştirin; idealde `GL_ADMIN_SECRET` + parola env'e taşınır.
4. **CSP sıkılaştırma:** `unsafe-inline` yerine nonce/hash; `frame-ancestors` ekleyin (platform önizlemesi bitince).
5. **Çoklu sunucu:** Hız limitleri ve fraud sayaçları process içi — yatay ölçeklemede Redis'e taşınmalı.
6. **Bilinen sınır:** Cihaz limiti IP+UA'ya bağlı; UA rotasyonu yapan kararlı bir saldırgan günlük IP tavanına (80 oy/IP/gün + hız limitleri) kadar sızmaya çalışabilir. Kurallı captcha/telefone doğrulama sonraki adım olabilir.
7. **HSTS + TLS:** Gerçek domain arkasında zorunlu.
