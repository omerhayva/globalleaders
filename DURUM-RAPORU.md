# GLOBAL LEADERS LIVE — DURUM RAPORU

**Tarih:** 1 Ekim 2026 · **Dal:** `arena/01a0f804-globalleaders` · **Kapsam:** Projenin bırakıldığı noktanın tespiti + kritik eksiklerin tamamlanması

---

## 1. Tek cümlelik özet

Proje **bitmiş sayılmaz ama iskeleti sağlam**: 135 dünyaca ünlü lider, 59 ülke, canlı sıralama, oy ekonomisi, admin paneli, ödeme ve üyelik altyapısı yazılmış durumda — ancak **sitede oy vermek tamamen bozuktu** (düzeltildi), **portre ve marş dosyaları veritabanına bağlı değildi** (düzeltildi), **testler ve CI kırmızıydı** (düzeltildi). Yayına çıkmak için kalan işler ağırlıklı olarak **yapılandırma** (cüzdan, e-posta, sunucu) ve **hukuki/lisans kontrolü**.

---

## 2. Şu an hazır olanlar

| Alan | Durum |
|---|---|
| **İçerik** | 135 lider (28 güncel + 107 tarihi), 59 ülke, 10 kategori; hepsi özgün kısa/nesnel biyografi ile |
| **Medya** | 136 portre fotoğrafı, 59 ülke bayrağı (40/160 px), 58 milli marş kaydı, dünya haritası SVG |
| **Oylama** | Günde 1 ücretsiz oy + paylaşımla günde 3'e kadar bonus + satın alınabilir paketler (10 oy/$1, 60 oy/$5) |
| **Sıralama** | Sunucu tarafında anlık sıralama, sıra değişimi (↑/↓), 7 günlük trend, ülke/global kırılımlar |
| **Sahtekârlık koruması** | Idempotency (aynı oy iki kez sayılmaz), oy başına bekleme, IP/gün limiti, şüpheli aktivitede askıya alma, fraud kaydı |
| **Canlı akış** | SSE ile anlık sayaç/sıralama güncellemesi (sayfa yenilemeden) |
| **Sayfalar** | Ana sayfa, /leaders, /history, /countries, /country/:kod, /country/:kod/anthem, /leader/:slug, /trending, /about, /legal, /admin — **tüm lider ve ülke sayfaları 200** |
| **SEO** | SSR + meta/OG/JSON-LD, sitemap.xml (260 URL), robots.txt, lider paylaşım kartları (SVG) |
| **Üyelik** | Gerçek kayıt/giriş (kullanıcı adı + e-posta + şifre), e-posta doğrulama, şifre sıfırlama, brute-force kilidi |
| **Ödeme** | USDT/TRC20 soğuk cüzdan akışı: niyet → transfer → işlem hash'i → **manuel doğrulama** → oy/reklam/marş hakkı |
| **Admin** | Lider yönetimi, ülke/marş, reklam alanları, ödeme doğrulama, fraud kayıtları, oturumlar, paylaşım analitiği, site ayarları (HMAC oturum, .env'den şifre) |
| **Güvenlik** | CSP, origin kontrolü, oturum çerezi, hız sınırlama, girdi temizleme, doğrulanmış yükleme, üretim sır zorunlulukları |

---

## 3. Bu turda bulunan ve düzeltilen kritik hatalar

### 🔴 1. Sitede oy verme tamamen çalışmıyordu
API `/api/vote` uç noktası `Idempotency-Key` başlığını zorunlu tutuyor (aynı oyun iki kez sayılmaması için). Ancak **istemci tarafında bu başlığı gönderen tek bir satır kod yoktu** — hem React modalı hem eski katman. Sonuç: her "VOTE" tıklaması `idempotency_key_required` (400) hatasıyla düşüyor, kullanıcı "Vote failed. Try again." görüyordu. Yani **projenin ana özelliği olan oylama, tarayıcıdan hiç çalışmıyordu.**
→ `client/ui/modals.jsx` artık her oy isteğinde benzersiz bir anahtar üretip gönderiyor. Doğrulandı: oy sayıldı, sıralama değişti, aynı anahtarın tekrarı oyu ikinci kez saymadı.

### 🟠 2. Portre fotoğrafları ve milli marşlar hiç görünmüyordu
136 portre (30 MB) ve 58 marş kaydı (58 MB) depoda duruyordu ama veritabanındaki `leaders.portrait` / `countries.anthem_audio` alanları **boş** doğuyordu (bu alanları yalnızca elle çalıştırılan indirme betikleri dolduruyordu). Temiz kurulumda site **harf avatarları** gösteriyor, marş çalar hiç çıkmıyordu.
→ Açılışta çalışan `linkLocalMedia()` eklendi: yerel dosyaları yalnızca boş alanlara yazar (admin yüklemelerini ve uzak URL'leri asla ezmez). Doğrulandı: 135 portre + 58 marş bağlandı, sayfalarda gerçek fotoğraflar ve `<audio>` oynatıcı var.

### 🟠 3. `.env` dosyası hiç okunmuyordu
README "`.env.example`'ı `.env` olarak kopyalayın" diyor; ancak sunucuda ne `dotenv` ne bir yükleyici vardı — yani yazdığınız hiçbir ayar uygulanmıyordu (özellikle üretimde sırlar).
→ Bağımlılıksız `server/env.js` eklendi. Sistem ortam değişkenleri her zaman kazanır; `.env` yalnızca boşlukları doldurur.

### 🟠 4. Testler ve CI kırmızıydı
`npm test` 2 iddiada düşüyordu (bayrak render'ı, oy paketi modalı) ve ana dalda son CI koşusu başarısızdı. Sebepler: (a) test koşum aracında eksik bir sınıf eşlemesi, (b) giriş modalı gerçek hesap formuna dönüşmüşken testin eski başlığı araması, (c) satın alma testinin manuel doğrulamaya geçen ödeme akışına göre güncellenmemiş olması, (d) CI'da cüzdan adresi tanımlı olmadığı için ödeme modalının kapanması.
→ Test ve koşum aracı güncellendi; satın alma testi artık gerçek soğuk cüzdan akışını (hash gir → "doğrulama bekliyor") uçtan uca sürüyor. **Sonuç: 51/51 başarılı.**

---

## 4. Doğrulama özeti

| Test | Sonuç |
|---|---|
| React adacık + uçtan uca entegrasyon testi (`npm test`) | **51/51 başarılı, 0 başarısız** |
| Tüm lider sayfaları (135) + ülke sayfaları (59) + marş sayfaları (59) | **0 hata** (hepsi 200) |
| Ana rotalar ve JSON API'ler | 200 |
| Oy akışı (canlı API) | Ücretsiz oy → sıralama değişti; aynı anahtarla tekrar → **ikinci kez sayılmadı** |
| Paylaşım → bonus oy | +1 bonus verildi, oturum güncellendi |
| Ödeme akışı | Niyet → işlem hash'i → `pending_verification` (doğru davranış) |
| Admin girişi | Başarılı (HMAC oturum) |
| Sunucu sözdizimi kontrolleri (CI) | Tamam |

> Not: Önizlemedeki yerel veritabanında **3 adet test oyu** var (Mandela, Atatürk, M. L. King). Sıfırdan başlamak için `var/` klasörünü silip sunucuyu yeniden başlatmak yeterli.

---

## 5. Yayına çıkmadan önce kalanlar (öncelik sırasıyla)

### 🔴 Zorunlu yapılandırma
1. **Kripto cüzdanı:** `CRYPTO_WALLET_ADDRESS`, `PAYMENT_PROVIDER=cold_wallet`, `CRYPTO_ASSET=USDT`, `CRYPTO_NETWORK=TRC20`. Aksi halde oy paketi, reklam ve marş satın alma **kapalı** (kullanıcı "checkout yapılandırılmadı" bildirimi görüyor) — bu bilinçli bir güvenlik davranışı.
2. **E-posta gönderimi:** `RESEND_API_KEY` + `AUTH_FROM_EMAIL`. Aksi halde kayıt 503 döner (e-posta doğrulaması gönderilemiyor), şifre sıfırlama çalışmaz.
3. **Üretim sırları ve altyapı:** `GL_ADMIN_SECRET`, `GL_ADMIN_PASSWORD`, `GL_FRAUD_SALT` (32+ karakter), `PUBLIC_BASE_URL` (HTTPS), HTTPS zorlaması, veritabanı yedeği. Üretimde eksikse sunucu bilinçli olarak açılmaz.

### 🟠 İş kararı gerekenler
4. **Otomatik blokzincir doğrulaması yok:** şu an her ödeme elle onaylanıyor (`pending_verification`). Hacim artarsa TRC20 sorgulayıcı/entegrasyon gerekir.
5. **CAPTCHA yok:** README'nin kontrol listesinde "yüksek riskli istekler için CAPTCHA" maddesi hâlâ açık.
6. **Hukuki/lisans:** portre fotoğrafları ve marş kayıtları için hak/lisans doğrulaması yapılmalı; ayrıca "bilimsel anket değildir" ibaresinin hedef ülkeler için hukuken gözden geçirilmesi gerekiyor.
7. **Ölçekleme:** sistem tek süreçli SQLite üzerine kurulu; hız limitleri/SSE süreç-yerel. Yatay ölçekleme için Postgres + Redis + paylaşımlı pub/sub planı README'de tarif edilmiş ama uygulanmamış.

### 🟡 Küçük eksikler / temizlik
8. **Moğolistan (MN) marş kaydı yok** — 59 ülkeden 58'inde kayıt var; MN sayfası "kayıt yok" gösteriyor.
9. **Topluluk önerileri için özel moderasyon kuyruğu yok:** öneriler `visible=0` olarak geliyor; admin "Leaders" listesinden göster/gizle ile onaylanıyor (çalışıyor ama ayrı bir kuyruk ekranı yok).
10. **Sosyal giriş sahte/demo:** X/Google girişi yalnızca `demo_mode` açıkken çalışıyor; gerçek OAuth entegrasyonu yok, düğmeler gerçek hesap formuna dönüştürüldü.
11. **Depo temizliği:** `client/ui/Leaderboard.jsx.bak`, `public/css/style.css.bak` artık dosyaları; ayrıca `render.js`'i yamalayan geçici "Production syntax guard" CI iş akışı (artık gereksiz).
12. **`.github/workflows/ci.yml`** üretilen React paketini ana dala geri commit'liyor — tercih meselesi; gözden geçirilebilir.

---

## 6. Nasıl çalıştırılır

```bash
npm install
npm run build:react
cp .env.example .env      # artık gerçekten okunuyor
npm start                 # http://localhost:3000
npm test                  # 51/51
```

---

## 7. Önerilen sonraki adım

Kısa vadede yayın için: (1) cüzdan + e-posta ayarlarını girmek, (2) üretim sırlarını ve HTTPS'i kurmak, (3) lisans kontrolünü tamamlamak. Orta vadede: CAPTCHA, moderasyon kuyruğu ve ödeme doğrulama otomasyonu.
