# 🌍 GLOBAL LEADERS LIVE

**The World Votes. The Ranking Moves.**

A complete, production-style interactive voting platform: a live global ranking of 136
historical and current world leaders, moved in real time by community votes.

## 🚀 VS Code ile çalıştırma (önerilen)

**Gereksinimler:** [Node.js 20+](https://nodejs.org) · VS Code

1. **Projeyi açın:** VS Code → `File ▸ Open Folder` → bu klasör
   *(Eklenti önerileri çıkarsa yükleyin: Prettier, REST Client, SQLite Viewer)*
2. **Terminalde kurulum:**
   ```bash
   npm install
   npm run build:react   # React adacık paketini derler (public/js/react-app.js)
   ```
3. **Çalıştırın (2 yoldan biri):**
   - **F5'e basın** → "🌍 Sunucuyu Başlat (Debug + Kesme Noktası)" — kesme noktalarıyla hata ayıklama
   - veya terminalde: `npm run dev` → dosya kaydedince sunucu otomatik yeniden başlar
4. Tarayıcıda **http://localhost:3000** açın 🎉

**Günlük geliştirme akışı:**

| Komut / Kısayol | Ne yapar |
|---|---|
| `npm run dev` | Sunucu + otomatik yeniden başlatma (`node --watch`) |
| `npm run watch:react` | `client/**` değiştikçe React paketini yeniden derler |
| `npm test` | 47 iddialı React adacık entegrasyon testi (sunucu açıkken) |
| `npm run db:reset` | Demo verilerini sıfırlar ve yeniden oluşturur |
| `F5` | VS Code hata ayıklayıcısıyla sunucu (kesme noktası destekli) |
| `Ctrl+Shift+B` | React derleme görevi (tasks.json) |

**İpuçları:**
- `api.http` dosyası: VS Code REST Client ile tek tıkla API testi (oy, satın alma, admin...)
- `var/globalleaders.db` dosyasını SQLite Viewer eklentisiyle doğrudan inceleyebilirsiniz
- Windows'ta `better-sqlite3` kurulum hatası alırsanız: `npm install --global windows-build-tools` veya [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) kurun (çoğu sistemde ön-derlenmiş ikili dosyalarla gerekmez)
- Port/secret ayarları için `.env.example` → `.env` kopyalayın

<details>
<summary>Klasör yapısı (tıklayın)</summary>

```
server/            → Express SSR sunucusu (render.js = sayfalar, api.js = REST, admin.js = panel)
client/            → React adacık kaynak kodu (JSX) → npm run build:react → public/js/react-app.js
public/            → Statik dosyalar + js/app.js (vanilla katman) + css + portre/bayrak/marş
scripts/           → Derleme ve test betikleri
var/               → SQLite veritabanı (ilk açılışta otomatik seed edilir)
.vscode/           → Hata ayıklama + görev + ayar dosyaları
api.http           → REST Client API koleksiyonu
```
</details>

## Hızlı başlangıç (VS Code'suz)

```bash
npm install
npm run build:react
npm start                # → http://localhost:3000
```

The database (SQLite, WAL mode) auto-seeds on first boot with 135 seed + community-added leaders across 59
countries and ~6.5M **demo-marked** votes spread over 30 days of daily stats + rank history.

**Admin panel:** `/admin` — default password `leaders2026` (change in Settings).

## What's implemented

| Area | Details |
|---|---|
| **Voting** | 1 free vote/day/session by default (admin-adjustable: `free_votes_per_day` setting), extras via share bonus or purchased packs. Server-side enforced. |
| **Share = +1 vote** | Share modal (WhatsApp, X, Facebook, Telegram, Reddit, copy, native) → +1 bonus vote (max 3/day, 30s cooldown, self-referral blocked). Unique share URLs `/vote/{slug}?ref={id}` with referral click tracking. |
| **Real-time** | Server-Sent Events bus: `vote_created`, `leader_vote_count_updated`, `leader_rank_changed`, `ad_purchased`, `anthem_purchased`, `activity_created`. Leaderboard FLIP-animates rank swaps, vote counters roll, activity slides in. |
| **Anti-abuse** | IP hashing, per-IP cooldown (1.2s), daily IP cap (80), velocity detection → captcha flag, temp suspensions, self-referral + duplicate-referral detection, fraud event log + admin dashboard. |
| **Pages (SSR + SEO)** | `/`, `/leaders` (+categories), `/leader/{slug}`, `/countries`, `/country/{code}`, `/country/{code}/anthem`, `/trending`, `/history`, `/about`, `/legal`, `/admin`, `sitemap.xml`. Each page has title/description/OG/Twitter/canonical + JSON-LD; leader pages get dynamic SVG share cards at `/og/leader/{slug}.svg`. |
| **World map** | Interactive SVG choropleth (vote intensity), hover tooltips, click → country page, keyboard accessible. |
| **4 ad slots** | top-left / top-right / bottom-left / bottom-right surround the homepage ranking. $5 takeover flow with image upload (JPG/PNG/WEBP ≤2MB, magic-byte validated), text, CTA, URL, "Sponsored by". Owned until outbought; admin can override/remove/schedule. |
| **Anthem takeover** | $5 per country; winner keeps it until replaced. Purchase history, sponsor credit, share card. **No copyrighted audio bundled** — admins upload legally cleared recordings only. |
| **Payments** | `PaymentProvider` interface → `MockPaymentProvider` (DEMO MODE, clearly labeled). Pre-checkout shows item/price/ownership rule/refunds. Stripe/PayPal/regional/crypto plug in via `server/services/payments.js`; webhook endpoint stubbed. |
| **Currency** | USD base + `CurrencyService` with locale detection and approximate conversion (`$5.00 ≈ ₺…`); live FX API pluggable. |
| **Admin panel** | Dashboard KPIs (votes/hr, sessions, revenue total/today/week/month, ads vs anthems), Leaders CRUD + portrait upload + feature/verify/hide, Countries + anthem metadata/audio, Votes, Ads, Anthems, Payments, Share/Referral analytics, Fraud, Sessions (suspend), Settings + demo tools (Reset / Seed / Clear votes / Clear purchases). |
| **Demo mode** | All seeded/simulated votes are `type='demo'`; a background simulator (admin-toggleable) keeps the ranking alive. One click removes all demo data before production. |
| **Design** | Dark-first, glassmorphism, big type, pulsing LIVE badges, rank up/down animations, count-up stats, sticky mobile vote bar, reduced-motion support, ARIA labels/focus states, empty/error/loading states. |

## Architecture

**Islands (adacık) mimarisi:** sayfalar sunucuda render edilir (SSR + SEO); etkileşimli
bölümler gerçek React 19 bileşenleridir. Vanilla katman (`app.js`) SSR'in yaşam desteğini
taşır (SSE, harita, grafikler) ve `window.GLUI` köprüsü üzerinden React adacıklarını çağırır.

```
server/
  index.js            Express app, SSR routes, demo simulator
  db.js               SQLite schema (22 tables incl. votes, sessions, referrals,
                      rank history, ads, anthem slots, payments, fraud_events…)
  seed.js             135-leader seed, demo votes, rank recompute, demo tools
  core.js             Vote engine, ranking, trending, stats, activity
  api.js              Public JSON API + purchase endpoints
  admin.js            Admin API (HMAC cookie auth, validated uploads)
  render.js           SSR templates + OG/portrait SVG generators
  services/           payments.js · currency.js · fraud.js · sse.js
client/               React island sources (JSX)
  store.js            Framework-agnostic observable store (useSyncExternalStore)
  ui/                 Leaderboard · StatsRings · modals · HeaderActions · Toasts
  index.jsx           Mount points + window.GLUI bridge
scripts/
  build-react.js      esbuild → public/js/react-app.js (npm run build:react)
  react-island-test.js  jsdom integration tests (npm test)
public/
  css/style.css       Design system + VIP visual layer
  js/app.js           Vanilla layer: SSE, map, charts, delegation → GLUI
  js/react-app.js     Compiled React bundle (tracked so it runs without a build)
  js/admin.js         Admin SPA (vanilla by design)
  map/world.svg       ISO-coded world map
.vscode/              launch.json (F5 debug) · tasks.json · settings.json
api.http              REST Client API collection
```

**Ranking:** primary = total valid votes; ties broken by recency; 30-day rank history
logged per leader. Publicly labeled *"Ranking based on community votes"* — never
presented as scientific polling.

## Production notes

- Swap SQLite for PostgreSQL/Supabase by porting `db.js` queries (schema maps 1:1);
  SSE bus can be replaced by Supabase Realtime.
- Move in-memory throttles (`services/fraud.js`) to Redis when scaling horizontally.
- Register a real `PaymentProvider`, set `demo_mode=0`, run **Clear Demo Votes**.
- Add a real captcha where `captcha_required` is raised.
