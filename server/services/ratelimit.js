// Basit sabit-pencere hız limiter (process içi; ölçeklenirken Redis'e taşınır).
// Kaba kuvvet / flood saldırılarına karşı uç nokta başına koruma sağlar.
const seq = { n: 0 };

function rateLimit(opts = {}) {
  const { windowMs = 60_000, max = 60, name = 'rl' + (++seq.n), message = 'Too many requests. Please try again later.' } = opts;
  const buckets = new Map(); // key -> { count, resetAt }
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip || req.socket.remoteAddress || '?'}`;
    let b = buckets.get(key);
    if (!b || now > b.resetAt) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
    b.count++;
    if (buckets.size > 10_000) { // periyodik temizlik
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k);
    }
    if (b.count > max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((b.resetAt - now) / 1000))));
      return res.status(429).json({ error: 'rate_limited', message });
    }
    next();
  };
}

module.exports = { rateLimit };
