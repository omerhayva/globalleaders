# Arayüz Denetimi — Bulunanlar ve Yapılan Düzeltmeler

Siteyi gerçek bir ziyaretçi gibi baştan sona gezdim (ana sayfa, liderler,
tarih, ülkeler, ülke sayfası, marş sayfası, lider profili, ödeme ekranları,
yönetim paneli), taze bir veritabanıyla yeniden kurdum ve şunları bulup
düzelttim.

---

## 🔴 Kritik — düzeltildi: Sıralar "null" görünüyordu

**Bulgu:** Taze kurulumda (henüz hiç oy yokken) liderlerin `rank` alanı boş
kalıyordu; liderlik tablosunda, lider kartlarında, ülke sayfasında ve paylaşım
önizlemelerinde **"null"** yazıyordu. Yani site ilk açıldığında "1., 2., 3."
yerine "null" görüyordunuz.

**Düzeltme:** Açılışta sıralar bir kez hesaplanıyor; ayrıca `core.decorate`
sırasız kayıtlar için sıralamayı yerinde hesaplıyor (eski veritabanları da
düzelir). Artık her liderin sırası var.

---

## 🟠 Eksikti — eklendi: Lider arama

**Bulgu:** 135 liderin olduğu sitede **arama yoktu**. İsmiyle lider bulmak
isteyen ziyaretçi /leaders sayfasında elle geziyordu.

**Düzeltme:**
- Üst çubukta arama kutusu: yazarken açılır sonuç listesi, ↑ ↓ ile gezinme,
  Enter ile gitme, Esc ile kapatma.
- Aksan/harf katlaması: **"erdogan" yazan "Recep Tayyip Erdoğan"ı bulur**,
  "sanchez" → "Sánchez", "walesa" → "Wałęsa", "ataturk" → "Atatürk".
- `/leaders?q=...` sayfası JavaScript olmadan da çalışır (SSR form), mobilde
  menüye "🔍 SEARCH LEADERS" bağlantısı eklendi.
- Sonuç yoksa "No leader matches ... See all leaders →" mesajı.

---

## 🟠 Eksikti — düzeltildi: Paylaşılan bağlantılarda görsel çıkmıyordu

**Bulgu:** `og:image` etiketi **SVG** dosyasına işaret ediyordu. WhatsApp, X,
Telegram ve Facebook SVG göstermez; lider paylaşıldığında önizlemede görsel
yerine boş kutu çıkıyordu — oysa paylaşım bu sitenin ana büyüme kanalı.

**Düzeltme:** Paylaşım kartları artık **1200×630 PNG** olarak üretiliyor
(lider portresi + sıra + canlı oy sayısı + "Do you agree?" + site adresi).
Kartlar `var/og-cache/` altında önbelleklenir; oy sayısı değişince yeni kart
üretilir. `sharp` kurulu değilse sistem sessizce SVG'ye döner (site bozulmaz).
Ayrıca `og:image:width/height/type/alt` ve `twitter:image` etiketleri eklendi.

---

## 🟡 Bulundu — düzeltildi: Türkçe ülke adları bozuk yazılıyordu

**Bulgu:** Sayfa ülke adını `toUpperCase()` ile büyütüyordu; bu Türkçe
harfleri bozuyor: **"Türkiye" → "TÜRKIYE"** (İ yerine I), aynı durum
İstiklal Marşı sayfasında da vardı.

**Düzeltme:** Ülke adı olduğu gibi yazılıyor, büyük görünüm CSS ile
sağlanıyor. Artık "Türkiye" ve "İstiklal Marşı" doğru görünüyor.

---

## 🟡 Bulundu — düzeltildi: Boş paneller ve donan ekranlar

- Ana sayfada "⚡ MOST VOTED TODAY" ve "MOST ACTIVE COUNTRIES" panelleri hiç
  içerik olmadan boş duruyordu → artık "No votes yet today — be the first."
  ve "Voting opens the map — cast the first vote…" mesajları var.
- Ödeme modalı açılırken paketler/form bir an görünmüyordu (ilk yüklemede
  boş kutu) → iskelet artık hemen görünüyor, "Preparing checkout…" yalnızca
  ödeme alanında beliriyor.
- Ödeme başlatılamazsa (örn. cüzdan/anahtar tanımlı değil) modal kapanıp
  kullanıcıyı kaybediyordu → artık **satır içi uyarı + "TRY AGAIN"** düğmesi
  gösteriliyor, modal açık kalıyor.
- `matchMedia` bulunmayan ortamlarda site tamamen çökebiliyordu → korumalı
  hale getirildi (eski tarayıcılar ve test ortamları).

---

## 🟢 Zaten iyi olanlar (dokunulmadı)

- Her görselde `alt`, her düğmede etiket/`aria-label` var; sayfa başına
  tek `<h1>`; `:focus-visible` stilleri tanımlı.
- `robots.txt` + 260 adresli `sitemap.xml` doğru; canonical ve description
  etiketleri tüm sayfalarda mevcut.
- Grafiklerde veri yokken "Not enough data yet." mesajı çıkıyor.

---

## ⏳ Hâlâ sizden bekleyenler (arayüzle ilgisi yok, ayar işi)

| Konu | Durum |
|---|---|
| `CRYPTO_WALLET_ADDRESS` | Geçersiz yer tutucu duruyor → kripto ödeme kapalı. Gerçek USDT-TRC20 adresinizi yazınca açılır. |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | Tanımlanınca kart seçeneği arayüzde görünür. |
| `AUTO_ONCHAIN_VERIFY=1` | Önerilir: işlem hash'i girilir girilmez zincir kontrolü yapılır. |
| E-posta anahtarı (Resend) | Şifre sıfırlama e-postası için; anahtar yoksa bağlantı ekranda gösterilir. |

## Sonraki adımlar (isteğe bağlı, söyleyin yeter)

1. **iyzico / PayTR** gibi yerel kart sağlayıcısı (Türkiye'de Stripe yerine)
   — sağlayıcı soyutlaması buna hazır, tek sınıf ekleniyor.
2. Marş sayfalarına "öne çıkan sponsor" vitrini ve ülke sayfasında sponsor
   rozeti (şu an yalnızca marş sayfasında görünüyor).
3. Çoklu para birimiyle ödeme (şu an yalnızca USD tahsilat, TL gösterimi).

## Testler

```bash
npm run test:site      # 31 kontrol — sıralar, arama, og kartı, sayfa bütünlüğü
npm run test:payments  # 44 kontrol — zincir doğrulama + Stripe webhook
npm test               # 51 kontrol — React arayüzü uçtan uca
```
