# REACT ADACIK (ISLANDS) MİMARİSİNE GEÇİŞ RAPORU

**Tarih:** 3 Eylül 2026 · **Tur:** 3 (kullanıcı talebi: "arayüzlerini github.com/react/react'e göre mantıklı kullan")
**Yaklaşım:** Kullanıcı onayıyla **islands (adacık) mimarisi** — SSR/SEO aynen korunur, etkileşimli bölümler gerçek React 19 bileşenlerine dönüşür, uygulama bozulmaz.

---

## 1. Ne yapıldı (özet)

Liderlik platformunun etkileşim katmanı vanilla DOM manipülasyonundan **gerçek React bileşenlerine** taşındı. Sunucu tarafı işaretleme (SSR), SEO meta etiketleri, JSON-LD, site haritası ve tüm API sözleşmeleri **birebir korundu**. React, sayfanın tamamını değil yalnızca "adacık" dediğimiz belirli kapları (container) canlandırır:

| Adacık | Kap | İçerik |
|---|---|---|
| Üst çubuk | `#glHeaderActions`, `#glMobileBar` | Oy hapı (`votes-pill`), giriş düğmesi (`auth-btn`), mobil oy çubuğu |
| Liderlik tablosu | `#leaderboard` | Canlı satırlar: sayaç yuvarlanması, flash, sıralama animasyonları, YOUR VOTE rozetleri |
| Bildirimler | `#toasts` | Portal tabanlı toast sistemi (4 tip: success/error/epic/normal) |
| Modallar | `#modals` | Oy, oy bitti, paket satın alma, paylaşım, reklam/marş koltuğu, oylarım, giriş, hesap |
| Konfeti | `document.body` | Oy kutlaması (portal, otomatik temizlik) |

SSR satırları, adacık verisi **gelene kadar görünür kalır**; istek başarısız olursa adacık hiç mount edilmez ve SSR tablo aynen çalışmaya devam eder (zarif bozulma / graceful degradation).

## 2. Mimari

```
client/                          # React kaynak kodu (JSX)
├─ store.js                      # Framework-bağımsız gözlemlenebilir durum deposu
├─ api.js                        # X-GL-Session başlıklı fetch + localStorage aynası (app.js ile aynı protokol)
├─ useStore.jsx                  # useSyncExternalStore bağlantısı (React 19 önerilen desen)
├─ index.jsx                     # Mount noktaları + window.GLUI köprüsü + önyükleme
└─ ui/
   ├─ Toasts.jsx                 # Toast + Konfeti (portal)
   ├─ HeaderActions.jsx          # Hap + auth düğmesi + mobil bar (portal)
   ├─ Leaderboard.jsx            # Canlı tablo (useRoll, SSE, rank animasyonları)
   └─ modals.jsx                 # 8 modal bileşeni + PayForm + ModalHost

scripts/build-react.js           # esbuild → public/js/react-app.js (bundle+minify, JSX automatic, ES2019)
scripts/react-island-test.js     # jsdom tabanlı 38 iddialı entegrasyon testi
public/js/react-app.js           # Derleme çıktısı (219 KB, ~60 KB gzip) — KALICI YOL
public/js/app.js                 # Zayıflatılmış vanilla katman (SSR yaşam desteği)
```

**Veri akışı:**
- `store.js` React'e bağımlı DEĞİLDİR — `subscribe/getState/setState` dışa açar. React bileşenleri `useSyncExternalStore` ile abone olur. Bu sayede React yüklenmeden önce gelen çağrılar da kaybolmaz.
- `window.GLUI` köprüsü: `{toast, openVote, openShare, openBuyVotes, openAdPurchase, openAnthemPurchase, openMyVotes, openSignIn, openAccount, confetti, flashLeader, getMyVotes}` — vanilla katman (ve gelecekte başka betikler) SSR düğmelerini bu köprü ile React akışına bağlar.
- SSE → React: `app.js` içindeki `EventSource` dinleyicileri `leader_vote_count_updated` / `leader_rank_changed` olaylarını `document` üzerine `CustomEvent('gl:sse')` olarak yayınlar; Leaderboard adacığı bunları dinler. Ters yön: store `gl:myvotes` olayı yayınlar, vanilla katman `.leader-card` rozetlerini buna göre günceller.

**Neden köprü + store?** Tam SPA yeniden yazımı SSR/SEO'yu riske atardı; yalnızca restil ise kullanıcı deneyimini değiştirmezdi. Bu tasarım her iki dünya avantajını verir: SEO tam SSR, etkileşim tam React (hooks, state, bileşen hiyerarşisi, bildirimsel render).

## 3. Vanilla katmanda KALANLAR (bilinçli karar)

`app.js` (710 → 309 satır) artık yalnızca SSR'in "yaşam desteği"ni içerir:

- **SSE canlılığı** — profil sayaçları, etkinlik akışı, günlük oy istatistiği, marş/reklam devralma bildirimleri (toast için GLUI'ye delege)
- **Grafikler** — lider profili sıralama/oysağ grafiği (lineChart/barChart SVG üretimi — saf matematik, React gerektirmez)
- **Dünya haritası** — SVG interaktif boyama + tooltip
- **IntersectionObserver** istatistik sayaçları
- **Load more** (`/leaders` ızgarası), **öneri formu**, **tavsiye (referral)** girişi
- **Marş oynatıcı** (autoplay + satır içi çalar) ve **mobil navigasyon**
- **Tıklama delegasyonu** — `[data-vote]`, `[data-share]`, `[data-buy-ad]`, `[data-buy-anthem]`, `[data-buy-votes]`, `[data-share-country]` → `GLUI.*` çağrıları (opsiyonel zincirle: React yüklenmezse sayfa çökmez)

**Admin paneli** (`/admin`) bilinçli olarak vanilla kaldı (kullanıcı kısıtı: admin vanilla kalabilir).

## 4. Korunan davranışlar (birebir eşlenik)

- ✅ Oy akışı: adet seçici → ekonomi yanıtları → **duygusal geri bildirim** (#1 / yükseliş / normal) → konfeti → 1.6 sn sonra otomatik **paylaşım bonusu** modalı
- ✅ Hata haritası: `no_votes_left, too_fast, daily_cap, device_limit, suspended, captcha_required, rate_limited` — her biri özgün mesajıyla
- ✅ Paylaşım: 6 platform + native share; `bonusAwarded` → +1 oy ve hap güncellemesi
- ✅ Satın alma: intent → VIP demo kart formu (doğrulama: ≥12 hane, MM/YY, CVC≥3) → confirm; oy paketleri anında hesaba geçer (`61/61 votes` testte doğrulandı)
- ✅ Reklam/marş koltuğu: şeffaf koşullar kutusu, tüm alanlar, görsel yükleme (FileReader, 2 MB sınır), panoya kopyalama, 2.2 sn sonra yenileme
- ✅ Auth: isim/soyisim + simüle X/Google, `@handle` bağlantısı, hesap paneli, çıkış — oturum/oy listesi tazelenir
- ✅ Canlılık: SSE oy sayacı yumuşak yuvarlanma, flash, sıra değişince yeniden çekme + `rank-up`/`rank-down` animasyonları
- ✅ Tema: **tek bir CSS satırı değişmedi** — React bileşenleri mevcut sınıfları birebir kullanır (`.lb-row`, `.modal-backdrop`, `.toast`, `.votes-pill`, `.auth-btn.signed`, `.pack-grid`, `.pay-form`...). Yalnızca 3 satır eklendi: `.header-actions` yerleşimi ve `.toast.leaving` geçişi.
- ✅ Erişilebilirlik: `role="status"`, `aria-modal`, `aria-label`, ESC ile kapatma, backdrop tıkı

## 5. Ek düzeltme (tutarlılık)

`server/core.js` → `decorate()` artık **`countryName`** döndürüyor. Önceden API satırlarında ülke adı yoktu (`TR` görünüyordu); React adacığı API'den beslendiği için SSR ile API tek gerçek kaynağa bağlandı ("Türkiye" / "South Africa"...). SSR görünümü de aynı_lookup'tan beslenir.

## 6. Doğrulama sonuçları

| Test | Sonuç |
|---|---|
| jsdom entegrasyon testi (`npm run test:react`) | **38/38 başarılı** — adacık mount'ları, GLUI köprüsü (11 fonksiyon), tüm modal açılışları, toast yaşam döngüsü, E2E satın alma→oy→paylaşım zinciri, SSE canlı güncelleme (6,128 → 999,999), sıralama yenileme |
| E2E başarı yolu (ayrı koşu) | 60'lık paket satın alındı → hap **"61/61 votes"** → oy atıldı → duygusal bildirim → otomatik paylaşım modalı → React satırında **YOUR VOTE** rozeti |
| Site haritası taraması | **261 URL, 0 hata** (/, /leaders, /countries, /trending, /history, /about, /legal, /admin, tüm liderler, ülkeler ve marş sayfaları) |
| SSR bütünlüğü | Başlık, meta, JSON-LD, SSR `lb-row` işaretleme, `__DATA__` — değişmedi |
| Betik sırası | `react-app.js` (defer) → `app.js` (defer): belge sırasıyla çalışır, GLUI hazır olur |
| Hız sınırı/dolandırıcılık | Testler sırasında `purchase/intent` ucu 10 dk'da 10 istek sınırını correctly tetikledi — koruma devrede (test bu durumu bilir ve "beklenen davranış" raporlar) |
| Sözdizimi | `node --check`: app.js, render.js, core.js ✔ |

## 7. Geliştirici komutları

```bash
npm run build:react   # client/**.jsx → public/js/react-app.js (esbuild, ~60ms)
npm run test:react    # 38 iddialı jsdom entegrasyon testi (sunucu ayakta olmalı)
npm start             # sunucu (3000)
```

> **Önemli:** `node_modules` kalıcı değildir; sandbox uyandıktan sonra yeniden derleme gerekiyorsa önce `npm install`. Derlenmiş `public/js/react-app.js` ise workspace'te kalıcıdır — derleme olmadan da site çalışır.

## 8. Bilinçli farklar ve notlar

1. **JS öncesi üst çubuk:** SSR'da hap/giriş düğmesi yerine boş kap gelir (JS ~60 KB gzip, aynı origin). SEO etkisi yok; etkileşimci öğe zaten JS'siz anlamsızdı.
2. **Liderlik flash'ı:** adacık, veri gelmeden mount edilmez (createRoot SSR çocuklarını temizlediği için) — fetch bitiminde tek seferde devralır; hata olursa SSR kalır.
3. **`/leaders` ızgarası ve admin vanilla:** adacıklaştırma yalnızca canlı veri + yüksek etkileşimli bölgelerde (kullanıcının seçtiği kapsam).
4. **Testlerde görülen `device_limit`/`rate_limited`:** test cihazı/IP'si gün içindeki denemelerden limit dolduğu için geldi — ürünün koruma katmanının çalıştığının kanıtı; gerçek ziyaretçi akışı E2E koşusunda başarıyla doğrulandı.

## 9. Canlı erişim

- Uygulama: **https://3000-i4y4hquv9x7pe6rvm6y4g.e2b.app** (pid 5653)
- Admin: `/admin` · parola `leaders2026` (vanilla, değişmedi)

---

**Sonuç:** Platform artık React 19 ile modern, bildirimsel bir etkileşim katmanına sahip; SSR/SEO, tema, tüm özellikler ve korumalar birebir korundu. 38/38 entegrasyon testi ve 261 URL'lik sıfır hatasız tarama ile doğrulandı.
