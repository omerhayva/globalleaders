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

> `npm test` currently covers the React island integration layer. Production deployment should also run backend/API smoke tests against the deployed environment.

## Environment

Copy `.env.example` to `.env` and replace all placeholders.

Required production variables:

- `NODE_ENV=production`
- `GL_ADMIN_SECRET` — random, high-entropy secret, at least 32 characters
- `GL_ADMIN_PASSWORD` — strong admin password, at least 12 characters
- `GL_FRAUD_SALT` — random secret used to hash abuse identifiers, at least 32 characters
- `PUBLIC_BASE_URL` — canonical public HTTPS origin
- `PORT` — optional, defaults to 3000

Never commit `.env`, database files, credentials, payment secrets, or private keys.

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
- Payment provider abstraction with fulfillment fields designed to prevent duplicate fulfillment.
- USD base pricing with locale-based display conversion.
- HMAC-based admin session authentication using environment-only production credentials.

## Payments

**Real payments are not enabled by the repository's default configuration.** The included mock provider is development architecture only and must never be represented to users as a real charge.

Before accepting real money, implement and verify a production provider with:

1. provider-side payment creation;
2. server-side signature verification for webhooks;
3. webhook idempotency;
4. atomic fulfillment;
5. duplicate-payment protection;
6. refund/dispute handling;
7. reconciliation and audit logs;
8. provider-specific legal/tax requirements.

Do not enable a payment provider merely by changing a UI flag.

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
    payments.js         provider abstraction
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
- [ ] Real payment provider and signed webhooks are implemented and tested.
- [ ] CAPTCHA is integrated for requests classified as high-risk.
- [ ] Upload storage and file-serving policy are reviewed.
- [ ] Leader portraits, historical data and anthem recordings have appropriate rights/licensing.
- [ ] Backup and restore procedures for the production database are tested.
- [ ] Backend/API smoke tests and load tests pass.
- [ ] Community ranking/legal wording is reviewed for the jurisdictions where the service operates.

## Important product wording

The ranking should remain described as **community voting**. It should not be presented as a scientific, representative or statistically valid public opinion poll.
