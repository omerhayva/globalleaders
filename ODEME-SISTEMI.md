# Ödeme Sistemi — "Para geldi mi, nasıl anlarız?"

Bu belge, sorduğunuz iki sorunun cevabını ve kurulum için sizden gereken
tek şeyleri anlatır. Özetle: **para geldi mi sorusu artık insan gözüne
bırakılmıyor**; kripto tarafında blokzincirden kanıt alınıyor, kart tarafında
Stripe'ın imzalı bildirimi (webhook) bekleniyor. Elle onay ise yalnızca
denetimli bir yedek yol olarak duruyor.

---

## 1) Kripto (USDT · TRC20): kanıt zincirden gelir

Kullanıcı parayı gönderip **işlem hash'ini (txid)** siteye yapıştırdığında
sunucu, TronGrid API'sine sorup dört şeyi doğrular:

| Kontrol | Sağlanmazsa gösterilen neden |
|---|---|
| İşlem blokzincirinde var mı? | `not_found` — "zincirde bulunamadı" |
| Blok onayı almış mı? | `pending_confirmation` — "onay bekliyor, 1 dk sonra tekrar" |
| Transfer **bizim cüzdana** mı yapılmış? | `wrong_recipient` — "yanlış cüzdan" |
| Sözleşme gerçekten **USDT (TRC20)** mi? | `wrong_asset` — "yanlış token/ağ" |
| Tutar siparişe **birebir** eşit mi? | `amount_too_low` — "tutar eksik" |

Hepsi tutuyorsa satın alma **otomatik** aktifleşir (oy paketi hesaba eklenir,
reklam/sponsorluk yayına girer). Ağ erişilemezse `network_error` yazılır ve
admin isterse elle onaylayabilir.

**Zincir kontrolü nerede görünür?**
- Alıcı tarafı: ödeme penceresi "Ödeme bildirildi → doğrulanıyor → aktifleşti"
  durumunu 6 saniyede bir yoklar; doğrulanınca kendiliğinden kapanır.
- Admin paneli: **💳 Payments & On-chain** ekranında her ödemenin yanında
  "✅ Zincirde doğrulandı / ⏳ Henüz kontrol edilmedi / ⛔ Yanlış cüzdan …"
  etiketi, zaman damgası ve işlem için **explorer bağlantısı** bulunur.

**Elle onay (yedek yol):** "ELLE ONAYLA" düğmesi cüzdanda görülen tutarı ve
**yazılı bir gerekçe** ister; gerekçe denetim kaydına `admin_manual:<not>`
olarak işlenir. Gerekçesiz onay reddedilir (HTTP 422). Bu sayede "para geldi"
diyen bir kayıt ya zincire ya da imzalı bir nota dayanır.

---

## 2) Kart (Visa / Mastercard): Stripe Checkout + imzalı webhook

Kullanıcı "💳 Credit / debit card" seçeneğini seçtiğinde:

1. Sunucu Stripe'ta bir Checkout oturumu açar, tarayıcı Stripe'ın **kendi
   güvenli sayfasına** gider (kart bilgisi sunucumuza hiç dokunmaz).
2. Ödeme alındığında Stripe, `/api/webhooks/stripe` adresine imzalı bir
   bildirim gönderir; imza `STRIPE_WEBHOOK_SECRET` ile doğrulanmadan
   hiçbir şeye güvenilmez (geçersiz/tekrar/eski imzalar reddedilir).
3. `checkout.session.completed` → satın alma **otomatik ve tek kez** aktifleşir.
   Aynı webhook tekrar gelse bile ikinci kez kupon/reklam yazılmaz (test edildi).

Kart seçeneği kullanıcıya yalnızca `STRIPE_SECRET_KEY` tanımlıysa gösterilir;
tanımlı değilse akış eskisi gibi yalnızca kriptoyla çalışır ve arayüz sade kalır
(ekstra adım yok).

---

## 3) Sadece sizin doldurabileceğiniz 4 şey

Bunlar güvenlik gereği koda gömülmez; sunucudaki `.env` dosyasına yazılır.

| Ne | Nereden | Not |
|---|---|---|
| `CRYPTO_WALLET_ADDRESS` | USDT (TRC20) alım adresiniz | Yalnızca **herkese açık adres**; seed/private key asla |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Webhooks → uç nokta ekleyince | `whsec_...` |
| `GL_ADMIN_SECRET`, `GL_ADMIN_PASSWORD`, `GL_FRAUD_SALT` | `openssl rand -hex 32` | Admin paneli güvenliği |

**Önemli:** Cüzdan adresi `T` ile başlayan 34 karakterlik geçerli bir TRC20 adresi
değilse site kripto ödemeyi **güvenlik gereği kapatır** (yanlış adrese para
gitmesin diye) ve admin ekranında "GEÇERSİZ ADRES" uyarısı gösterir.

Önerilen (zorunlu değil): `TRON_API_KEY` — TronGrid ücretsiz anahtarı; yoğun
trafikte hız limiti için. `AUTO_ONCHAIN_VERIFY=1` — hash girilir girilmez
zincir kontrolü yapılsın (varsayılan olarak açmanız önerilir).

Kurulum adımlarının tamamı: **`deploy/DEPLOY.md`** (Docker + HTTPS +
`docker compose up -d --build` + Stripe webhook uç noktası).

---

## 4) Yayına alırken kontrol listesi

1. `.env` dolduruldu mu? → `curl https://globalleaders.live/api/payment-methods`
   çıktısında `crypto.enabled` ve `card.enabled` **true** olmalı.
2. Stripe webhook uç noktası eklendi mi? → Stripe panelinden
   "Send test webhook" gönderin; admin ekranında ödeme `succeeded` görünmeli.
3. Gerçek küçük bir USDT transferi deneyin → admin ekranında
   "🔗 ZİNCİRDE KONTROL ET" → satın alma aktifleşmeli.
4. `docker compose logs -f app` ile hata var mı bakın.

---

## 5) Testler

```bash
npm run test:payments   # 38 kontrol: zincir doğrulama, imza, otomatik aktivasyon
npm test                # 51 kontrol: React arayüzü + uçtan uca oy/kripto akışı
```

Ödeme testleri dış ağa çıkmaz; sahte TronGrid ve Stripe yanıtlarıyla gerçek HTTP
akışını çalıştırır. Kapsananlar: doğru transfer → otomatik aktivasyon, yanlış
cüzdan, eksik tutar, onaysız işlem, gerekçesiz elle onayın reddi, kart
yönlendirmesi, imzalı webhook ile aktivasyon, tekrar eden webhook, eski
zaman damgalı (replay) imza, çift kupon yazılmaması.
