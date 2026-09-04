# GLOBAL LEADERS LIVE — Eksiklik & Tutarlılık Denetimi Raporu

**Tarih:** 03.09.2026 (2. tur) · **Kapsam:** İşlevsel kalite, veri tutarlılığı, metin/ekonomi çelişkileri, eksik medya ve dosyalar
**Yöntem:** Kod incelemesi + DB bütünlük sorguları + 313 URL'lik tam sayfa taraması + akış testleri

---

## 1. Bulunan ve Düzeltilen Eksikler

### 1.1 🔴 Ekonomi–metin çelişkisi: "5 bedava oy" iddiaları (5 yer)
Oy ekonomisi **1 bedava oy/gün + paylaşım ile günde 3 bonus**; ancak arayüz ve yasal metinler eski/yanlış "5 bedava oy" diyordu. Bu, kullanıcıyı yanıltan ve Ödeme/Hizmet koşullarıyla çelişen bir tutarsızlıktı.

| Konum | Önce | Sonra |
|---|---|---|
| Üst çubuk (tüm sayfalar) | `…/5 votes` | `…/1 vote` (ayardan dinamik) |
| Mobil oy çubuğu | `You have …/5 votes` | nötr + dinamik |
| `/about` | "**5 free votes per day**" | "**1 free vote per day**, up to 3 bonus by sharing" |
| `/legal` → Voting Rules | "5 free votes per day per person, up to 3 bonus" | ayarlardan dinamik |
| Referral karşılama toast'ı | "you have 5 free votes" | "your free daily vote is waiting" |

**Önemli:** About/Legal metinleri artık `free_votes_per_day` ve `max_bonus_per_day` ayarlarını okuyarak üretiliyor — admin ekonomiyi değiştirirse yasal metinler otomatik güncellenir.

### 1.2 🟠 8 ülkenin milli marş sesi eksikti
CD, JO, MN, JP, MY, PH, AR, MX, CU ülkelerinin `anthem_audio` alanı boştu — lider/ülke sayfalarında marş çalma düğmesi hiç görünmüyordu.

**Düzeltme:** Wikimedia Commons'taki serbest lisanslı kayıtlar indirildi, ses içerikleri magic-byte ile doğrulandı, yerel olarak sunuluyor:

| Ülke | Kaynak | Boyut |
|---|---|---|
| CD Kongo | Debout Congolais.ogg | 2.0 MB |
| JO Ürdün | National anthem of Jordan instrumental.ogg | 0.9 MB |
| JP Japonya | Kimigayo MIDI.ogg | 0.7 MB |
| MY Malezya | Negaraku instrumental.ogg | 1.3 MB |
| PH Filipinler | Lupang Hinirang, piano solo.ogg | 0.5 MB |
| AR Arjantin | Himno Nacional Argentino instrumental.ogg | 5.1 MB |
| MX Meksika | Himno Nacional Mexicano (Instrumental).ogg | 5.3 MB |
| CU Küba | US Navy Band – La Bayamesa.ogg | 1.6 MB |

Tümü `/anthems/*` altından HTTP 200 ile sunuluyor; ilgili lider sayfalarında marş düğmesi artık görünüyor (ör. emperor-meiji, benito-juarez, jose-de-san-martin ✓).

### 1.3 🟠 Wu Zetian portresi eksikti
Lider kartlarında harf monogramı (fallback) gösteriliyordu. Wikipedia'dan 500px portre indirildi (`/portraits/wu-zetian.png`, 940 KB, PNG doğrulandı) ve DB'ye bağlandı — sayfa HTTP 200 ✓.

### 1.4 🟡 robots.txt yoktu
Eklendi: herkese açık sayfalara izin, `/admin` ve `/api/` kapalı, sitemap bağlantısı içerir.

### 1.5 🟡 Test artıkları temizlendi
- Aktivite akışındaki 5 test mesajı (Regression/AUDIT/Evil/Zqx)
- Bugünkü 8 test ödemesi + 3 test reklam satın alması + 5 kaldırılmış test reklamı kaydı
- Silinmiş test liderlerine ait yetim istatistik satırları
- ⚠️ **Dokunulmadı:** "ömer" kullanıcısının TR/FR marş sponsorlukları ve önceki günlerin demo ödemeleri (gerçek kullanıcı demo verisi)

---

## 2. Doğrulanan Tutarlılıklar (sorun bulunamadı)

| Kontrol | Sonuç |
|---|---|
| `countries.total_votes` ↔ lider toplamları | ✅ tam eşleşme |
| `leaders.rank` dizisi | ✅ 1..136 kesintisiz |
| Lideri olmayan ülke / ülkesiz lider | ✅ yok |
| DB'de kayıtlı portre/marş/bayrak ↔ disk | ✅ hepsi var (59/59 bayrak dahil) |
| `/map/world.svg` (ülkeler haritası) | ✅ mevcut, yükleniyor |
| `hero.jpg` / `arena.jpg` | ✅ kullanımda, mevcut |
| Gizli lider sızıntısı | ✅ yok (visible=1 kontrolü) |
| Sayfalarda `undefined`/`NaN` kalıntısı | ✅ yok |
| TODO/FIXME/bırakılmış kod | ✅ yok |
| "Ranking based on community votes" ibaresi | ✅ anasayfa + leaders sayfasında mevcut |
| "Not scientific polling" ibaresi | ✅ footer + about + legal'de mevcut |

## 3. Doğrulama Testleri (düzeltme sonrası)

- **313 URL tarandı** (136 lider + 59 ülke + 59 marş sayfası + çekirdek sayfalar) → **0 hata**
- 8 yeni marş dosyası HTTP 200 ✓ · Wu Zetian portresi 200 ✓
- Oy akışı (yeni cihaz): bedava oy → `free_used=1, remaining=0` ✓
- `/api/session`: `freePerDay:1` ✓ · robotlar: `/robots.txt` 200 ✓
- Ekonomi metinleri: `…/1 vote`, "1 free vote per day" (about+legal) ✓

## 4. Bilinen sınırlar (bilinçli kararlar)

1. **MN Moğolistan marşı yok:** Wikimedia Commons'ta *güncel* Moğolistan marşının serbest lisanslı kaydı bulunamadı (yalnızca 1924–1950 arası eski marşlar var — yanlış içerik olurdu). Admin panelinden yasal izinli kayıt yüklenebilir (`/api/admin/countries/mn/anthem-audio`).
2. **PH marşı `.ogg` biçiminde:** Chrome/Firefox/Edge sorunsuz; çok eski Safari sürümleri çalamayabilir (diğer 58 ülke mp3).
3. **AR/MX marş dosyaları ~5 MB:** tam uzunlukta enstrümantal kayıtlar; sorun değil ama istenirse admin kısa sürümle değiştirebilir.
4. Marşlar ve portreler Commons'taki serbest lisanslı kayıtlardır; canlıya geçmeden önce lisans etiketlerinin legal sayfasında listelenmesi önerilir.

## 5. Değişen dosyalar

| Dosya | Değişiklik |
|---|---|
| `server/render.js` | 5 ekonomi metni ayarlardan dinamik üretim |
| `public/js/app.js` | Referral toast mesajı düzeltildi |
| `public/robots.txt` | **YENİ** |
| `public/anthems/{cd,jo,jp,my,ar,mx,cu}.mp3, ph.ogg` | **YENİ** (8 marş) |
| `public/portraits/wu-zetian.png` | **YENİ** |
| `var/globalleaders.db` | 8 ülke marş bağlantısı + Wu Zetian portresi + test artıklarının temizliği |
