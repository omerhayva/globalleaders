# Google ile Giriş — Kurulum Kılavuzu

Siteye **"Continue with Google"** düğmesi eklendi. Tek yapmanız gereken Google'dan
iki anahtar alıp sunucuya yazmak; gerisi hazır.

---

## 1) Google Cloud Console'da uygulama oluşturun

1. <https://console.cloud.google.com/> → sağ üstten **yeni proje** oluşturun
   (ad: `Global Leaders Live`).
2. Sol menü: **APIs & Services → OAuth consent screen**
   - User type: **External** → Create
   - App name: `Global Leaders Live`
   - User support email: kendi e-postanız
   - Developer contact: kendi e-postanız
   - Kaydedin. (Yayına almadığınız sürece yalnızca "Test users" listesindeki
     hesaplar giriş yapabilir — kendi Gmail adresinizi ekleyin.)
3. Sol menü: **APIs & Services → Credentials → + Create credentials → OAuth client ID**
   - Application type: **Web application**
   - Name: `web`
   - **Authorized JavaScript origins** (gerekli değil ama zararsız):
     `https://globalleaders.live`
   - **Authorized redirect URIs** — buraya BİREBİR şu adresleri ekleyin:
     ```
     https://globalleaders.live/api/auth/google/callback
     http://localhost:3000/api/auth/google/callback
     ```
     (Yerel test için ikincisi; alan adınız farklıysa kendi adresinizi yazın.)
4. **Create** → açılan pencerede **Client ID** ve **Client secret** görünür.

## 2) Anahtarları sunucuya yazın

`.env` dosyasına ekleyin (`.env.example` içinde örnek satırlar hazır):

```env
GOOGLE_CLIENT_ID=1234567890-abcdefg.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxx
```

Sunucuyu yeniden başlatın. Bu kadar.

> Yönlendirme adresi yanlış üretilirse (proxy/VPN arkasında) sabitleyebilirsiniz:
> ```env
> GOOGLE_REDIRECT_URI=https://globalleaders.live/api/auth/google/callback
> ```

---

## Nasıl çalışıyor?

1. Kullanıcı **Continue with Google** düğmesine basar → tarayıcı
   `/api/auth/google/start` adresine gider.
2. Sunucu rastgele bir **state** üretip httpOnly çereze koyar ve Google'ın
   onay ekranına yönlendirir (CSRF koruması).
3. Google, kullanıcıyı `/api/auth/google/callback?code=...&state=...` adresine geri
   gönderir; sunucu state'i doğrular, kodu **client secret ile** tokene çevirir ve
   `userinfo` ucundan ad/e-posta/fotoğrafı alır.
4. Hesap eşleştirme:
   - Daha önce Google ile girmiş → aynı hesap (`google_sub` eşleşmesi)
   - Aynı e-posta ile kayıtlı hesap var → **hesaplar birleşir**, şifreyle giriş de
     çalışmaya devam eder
   - Yeni → otomatik üye kaydı (kullanıcı adı üretilir, e-posta Google tarafından
     doğrulanmış sayılır, ayrıca doğrulama e-postası gerekmez)
5. Oy bakiyesi (satın alınan oylar dahil) cihazdan hesaba taşınır; kullanıcı başka
   cihazdan girdiğinde oyları yerinde durur.
6. Tüm girişler admin panelinde **Members** ve **Sessions → SIGN-IN RECORDS**
   ekranlarında görünür (`login_google` olayı).

## Güvenlik notları

- Client secret **yalnızca sunucuda** durur; tarayıcıya hiç gitmez.
- `state` çerezi eşleşmezse giriş reddedilir (açık yönlendirme denemeleri dahil).
- Yalnızca site içi `next` yolları kabul edilir (`//evil.com` gibi girdiler `/`'a düşer).
- Kullanıcının Google şifresi asla görülmez/saklanmaz; yalnızca ad, e-posta ve
  profil fotoğrafı bağlantısı saklanır.
- Profil fotoğrafı sayfada gösterilebilsin diye CSP'ye
  `https://*.googleusercontent.com` eklendi.

## Sorun giderme

| Belirti | Sebep / çözüm |
|---|---|
| Düğmeye basınca "not enabled on this server yet" | `.env` içinde anahtarlar yok ya da sunucu yeniden başlatılmadı |
| Google "redirect_uri_mismatch" diyor | Console'daki adres ile `GOOGLE_REDIRECT_URI`/`PUBLIC_BASE_URL` birebir aynı olmalı (https/http, sonda `/` olmadan) |
| "Access blocked: app not verified" | Yayına almadan önce yalnızca **Test users** listesindeki hesaplar girebilir; kendi adresinizi ekleyin |
| Giriş sonrası "Sign-in link expired" | 10 dakikalık state süresi doldu; tekrar deneyin |
| Profil fotoğrafı görünmüyor | Tarayıcı önbelleği ya da CSP; sunucuyu yeniden başlatın |
