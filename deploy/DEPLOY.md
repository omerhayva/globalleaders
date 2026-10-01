# globalleaders.live — Kurulum ve Ödeme Sistemi Kılavuzu

Bu dosya, siteyi kendi VPS'inizde HTTPS ile yayına almak ve ödeme
sistemini (kripto + kart) çalıştırmak için gereken adımları içerir.
Yalnızca 1. bölümdeki **dört değeri** sizin doldurmanız yeterlidir; gerisi hazır.

---

## 1) Sadece sizin doldurabileceğiniz değerler (`.env`)

```bash
cp .env.example .env
nano .env
```

| Anahtar | Nereden alınır | Zorunlu mu |
|---|---|---|
| `CRYPTO_WALLET_ADDRESS` | USDT (TRC20) alım adresiniz — **sadece herkese açık adres**, seed/private key değil | Kripto için evet |
| `STRIPE_SECRET_KEY` | Stripe → Developers → API keys (`sk_live_...`) | Kart için evet |
| `STRIPE_WEBHOOK_SECRET` | Stripe → Developers → Webhooks → uç noktayı ekleyince verilen `whsec_...` | Kart için evet |
| `GL_ADMIN_SECRET`, `GL_ADMIN_PASSWORD`, `GL_FRAUD_SALT` | Rastgele uzun değerler (`openssl rand -hex 32`) | Evet |

Kart anahtarı boşsa sitede kart seçeneği hiç görünmez; kripto çalışmaya devam eder.
Cüzdan adresi boşsa satın alma başlatılamaz (kullanıcıya "yapılandırılmadı" hatası döner).

---

## 2) Yayına alma

```bash
docker compose up -d --build
```

Ardından HTTPS sertifikası (tek seferlik):

```bash
docker compose run --rm --entrypoint certbot certbot certonly --webroot \
  -w /var/www/certbot -d globalleaders.live -d www.globalleaders.live \
  --email siz@ornek.com --agree-tos --no-eff-email
docker compose restart nginx
```

Kontrol: `curl -I https://globalleaders.live` → `200`, `curl https://globalleaders.live/api/stats`.

Sertifika yenileme `certbot` konteyneri tarafından otomatik yapılır.

---

## 3) Stripe webhook (kart ödemesinin "para geldi" sinyali)

1. Stripe → Developers → Webhooks → **Add endpoint**
2. URL: `https://globalleaders.live/api/webhooks/stripe`
3. Olaylar:
   - `checkout.session.completed` (ödeme alındı → satın alma otomatik aktifleşir)
   - `checkout.session.expired`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
4. Uç noktayı kaydedin, verilen `whsec_...` değerini `.env` içindeki
   `STRIPE_WEBHOOK_SECRET` alanına yazın ve `docker compose up -d` ile yeniden başlatın.
5. Stripe panelinden **Send test webhook** ile doğrulayın; admin panelindeki
   “💳 Payments & On-chain” ekranında kart ödemesi `succeeded` olarak görünmelidir.

> Not: İmza doğrulaması olmadan gelen webhook çağrıları reddedilir (400).
> `STRIPE_WEBHOOK_SECRET` boşsa imza kontrolü atlanır — bu yalnızca yerel testler içindir,
> üretimde mutlaka doldurulmalıdır.

---

## 4) Kripto: "para geldi mi?" nasıl anlaşılır

1. Kullanıcı tutarı cüzdanınıza gönderir ve işlem hash'ini (txid) siteye yapıştırır.
2. Sunucu, TronGrid'den işlemi sorar ve şunları **kanıtlar**:
   - işlem blokzincirinde var mı ve onaylı mı,
   - transfer sizin cüzdan adresinize mi yapılmış,
   - sözleşme gerçekten USDT (TRC20) mı,
   - tutar sipariş tutarına **birebir** eşit mi (eksik ödeme kabul edilmez).
3. Hepsi tutuyorsa satın alma otomatik aktifleşir (`AUTO_ONCHAIN_VERIFY=1`).
   Tutmuyorsa admin panelinde neden görünür: “Zincirde bulunamadı”, “Yanlış cüzdan”,
   “Tutar eksik”, “Blok onayı bekliyor” vb.
4. Zincir kaydı yokken elle onay mümkündür ama **gerekçe zorunludur**; girilen
   tutar ve not denetim kaydına işlenir (`verified_by = admin_manual:<not>`).

TronGrid hız limiti için ücretsiz `TRON_API_KEY` almanız önerilir
(https://www.trongrid.io). Anahtar olmadan da çalışır, yalnızca yoğun trafikte
yavaşlayabilir.

---

## 5) Yedekleme

SQLite dosyası `gl-data` isimli Docker volume'ünde tutulur. Günlük yedek:

```bash
docker compose exec app node -e "const d=require('better-sqlite3')('/data/globalleaders.db');d.backup('/data/yedek-'+new Date().toISOString().slice(0,10)+'.db').then(()=>console.log('ok'))"
docker compose cp app:/data ./yedekler
```

`public/uploads` (reklam görselleri) için `gl-uploads` volume'ünü de kopyalayın.

---

## 6) Sağlık kontrolü

```bash
curl -s https://globalleaders.live/api/stats            # site ayakta mı
curl -s https://globalleaders.live/api/payment-methods  # ödeme yöntemleri açık mı
docker compose logs -f app                              # uygulama logları
docker compose logs -f nginx                            # erişim logları
```

`/api/payment-methods` yanıtındaki `crypto.enabled` ve `card.enabled` alanları,
iki ödeme yönteminin de doğru yapılandırıldığını gösterir.
