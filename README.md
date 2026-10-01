# 🌍 GLOBAL LEADERS LIVE

**The World Votes. The Ranking Moves.**

Global Leaders Live is an interactive community voting platform for historical and current world leaders. Rankings move from real community votes and are explicitly presented as a community ranking, not a scientific poll.

## Quick start

**Requirements:** Node.js 20+

```bash
npm install
npm run build:react
npm start
```

Open `http://localhost:3000`.

For development:

```bash
npm run dev
npm run watch:react
npm test
```

## Environment

Copy `.env.example` to `.env` and replace all placeholders.

Production requires the admin/fraud secrets plus a public receiving wallet:

- `NODE_ENV=production`
- `GL_ADMIN_SECRET` — random, high-entropy secret, at least 32 characters
- `GL_ADMIN_PASSWORD` — strong admin password, at least 12 characters
- `GL_FRAUD_SALT` — random secret used to hash abuse identifiers, at least 32 characters
- `FREE_VOTES_PER_SUBNET_PER_DAY` — optional; free votes allowed per /24 network per day (default 40, `0` disables). Purchased votes are never capped.
- `PUBLIC_BASE_URL` — canonical public HTTPS origin
- `PAYMENT_PROVIDER=cold_wallet`
- `CRYPTO_ASSET=USDT`
- `CRYPTO_NETWORK=TRC20`
- `CRYPTO_WALLET_ADDRESS` — public receiving address of the cold wallet
- `AUTO_ONCHAIN_VERIFY=1` — verify submitted transaction hashes against the chain automatically
- `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` — optional, enables card payments (Stripe Checkout)

See `deploy/DEPLOY.md` for the full production guide (Docker, HTTPS, webhook setup).

Never commit `.env`, database files, credentials, seed phrases, private keys, or wallet backups.

## First boot and data

The first boot seeds the leader/country/category catalogue without synthetic votes. The SQLite database is created under `var/` and is intentionally ignored by Git.

There is no production vote simulator and no default admin password. Do not reset or replace the production database with seed data.

## Core functionality

- Community voting with server-side daily/free, bonus and purchased-vote accounting.
- Idempotency protection for vote requests.
- Device/IP abuse controls, cooldowns, velocity detection and fraud logging.
- Real-time updates through Server-Sent Events with connection caps.
- Leader, country, history and trending pages with SSR/SEO metadata.
- Interactive world map and dynamic leader share cards.
- Community leader suggestions enter moderation rather than becoming immediately visible.
- Advertising and national-anthem sponsorship data models with controlled uploads.
- Payments: direct cold-wallet USDT/TRC20 transfers **verified on-chain** (existence, confirmation, recipient, asset and exact amount) plus optional Stripe Checkout card payments activated by signed webhooks.
- Manual approval stays available as an audited fallback: it requires the observed amount and a written reason.
- Leader search from the header: accent-insensitive ("erdogan" finds "Erdoğan") and keyboard navigable; `/leaders?q=` works without JavaScript.
- Social share cards are generated as 1200×630 PNGs (portrait + rank + live vote count) so WhatsApp/X/Telegram previews show artwork; falls back to SVG when `sharp` is unavailable.
- USD base pricing with locale-based display conversion.
- HMAC-based admin session authentication using environment-only production credentials.

## Payment flows

### Crypto (cold wallet) — proof of payment comes from the blockchain

1. User selects the product or vote pack and picks the crypto option.
2. The server creates a pending payment intent and shows the exact amount, asset, network and **public cold-wallet address**.
3. User sends the crypto from their own wallet and pastes the transaction hash.
4. The payment becomes `pending_verification` and the server asks TronGrid to prove that
   the transaction exists, is confirmed, transfers USDT (TRC20) to our wallet and matches
   the order amount exactly (`server/services/onchain.js`).
5. Verified → the purchase is activated automatically (`AUTO_ONCHAIN_VERIFY=1`).
   Not verified → the admin screen shows the exact reason (not found, wrong recipient,
   wrong asset, amount too low, pending confirmation, network error).
6. **No votes, sponsorship or advertising rights are activated before verification.**
   Manual approval remains possible as an audited fallback and requires the observed
   amount plus a written reason.

### Card (Stripe Checkout) — optional, enabled by `STRIPE_SECRET_KEY`

1. User picks the card option; the server creates a Stripe Checkout session and the
   browser is redirected to Stripe's hosted page (card data never touches our server).
2. Stripe sends a signed webhook (`/api/webhooks/stripe`). The signature is verified with
   `STRIPE_WEBHOOK_SECRET` before anything is trusted.
3. `checkout.session.completed` activates the purchase automatically and idempotently.

## Architecture

```text
server/
  index.js              Express app, SSR routes, security middleware
  db.js                 SQLite schema and migrations
  seed.js               catalogue seed + local development helpers
  core.js               voting, ranking, statistics and activity domain logic
  api.js                public JSON API and purchase endpoints
  admin.js              authenticated admin API
  render.js             SSR templates and share-card SVG generation
  services/
    payments.js         provider abstraction: cold wallet (crypto) + Stripe Checkout (card)
    onchain.js          on-chain USDT/TRC20 verification (TronGrid)
    graphics-og.js      PNG og:image generation (sharp) with SVG fallback
    text-fold.js        accent-insensitive search folding (ı/ğ/ş → i/g/s)
    payment-verification.js  chain check + auto-activation orchestration
    payment-fulfillment.js   atomic, idempotent activation of paid orders
    fraud.js            anti-abuse controls
    ratelimit.js        endpoint rate limiting
    sse.js              realtime event bus
    uploads.js          validated media handling
    sanitize.js         input/output sanitization
    currency.js         currency display service
client/                  React island sources
public/                  SSR assets, CSS, JS and media
scripts/                 React build and integration tests
var/                     local SQLite database (not committed)
```

## Production architecture notes

The current deployment model is a **single persistent SQLite process**. In-memory rate limits, fraud throttles and the SSE bus therefore remain process-local.

For horizontal scaling:

- migrate shared writes to PostgreSQL/Supabase or another server database;
- move rate limiting/fraud counters to Redis or an equivalent shared store;
- replace the process-local SSE bus with a shared realtime/pub-sub layer;
- use shared object storage for uploads;
- add centralized logs, metrics and alerting.

## Security checklist before launch

- [ ] HTTPS is enforced.
- [ ] Production environment variables are configured from a secret manager.
- [ ] `PUBLIC_BASE_URL` matches the real canonical HTTPS origin.
- [ ] Admin credentials are unique and not stored in the database.
- [ ] `CRYPTO_WALLET_ADDRESS` is a public receiving address only.
- [ ] Network and asset are tested with a small real transfer before launch.
- [ ] Manual payment verification and reconciliation are tested.
- [ ] CAPTCHA is integrated for requests classified as high-risk.
- [ ] Upload storage and file-serving policy are reviewed.
- [ ] Leader portraits, historical data and anthem recordings have appropriate rights/licensing.
- [ ] Backup and restore procedures for the production database are tested.
- [ ] Backend/API smoke tests and load tests pass.
- [ ] Community ranking/legal wording is reviewed for the jurisdictions where the service operates.

## Important product wording

The ranking should remain described as **community voting**. It should not be presented as a scientific, representative or statistically valid public opinion poll.
