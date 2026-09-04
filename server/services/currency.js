// CurrencyService — all prices are stored in USD (base currency).
// Display conversion is approximate. Rates below are a static fallback table;
// wire `refreshRates()` to a live FX API (e.g. exchangerate.host, ECB) in production.
const FALLBACK_RATES = {
  USD: 1, EUR: 0.86, GBP: 0.75, TRY: 41.5, INR: 88.2, JPY: 147.0, CNY: 7.12,
  BRL: 5.4, MXN: 18.6, ZAR: 17.6, NGN: 1530, EGP: 48.4, SAR: 3.75, AED: 3.67,
  KRW: 1390, IDR: 16300, AUD: 1.52, CAD: 1.37, RUB: 81, PLN: 3.65, ARS: 1350
};
const LOCALE_CCY = {
  tr: 'TRY', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', pt: 'EUR', el: 'EUR',
  en_gb: 'GBP', gb: 'GBP', in: 'INR', hi: 'INR', ja: 'JPY', zh: 'CNY', ko: 'KRW',
  pt_br: 'BRL', ru: 'RUB', ar: 'SAR', id: 'IDR', pl: 'PLN'
};

class CurrencyService {
  constructor() { this.rates = { ...FALLBACK_RATES }; this.updatedAt = null; }
  async refreshRates() { /* plug live FX API here; keep fallback on failure */ }
  guessCurrency(acceptLanguage = '') {
    const lang = (acceptLanguage.split(',')[0] || 'en').toLowerCase().replace('-', '_');
    return LOCALE_CCY[lang] || LOCALE_CCY[lang.split('_')[0]] || 'USD';
  }
  convert(amountUsd, ccy) {
    const r = this.rates[ccy];
    return r ? amountUsd * r : null;
  }
  display(amountUsd, ccy) {
    if (!ccy || ccy === 'USD') return `$${amountUsd.toFixed(2)}`;
    const v = this.convert(amountUsd, ccy);
    if (v == null) return `$${amountUsd.toFixed(2)}`;
    const formatted = new Intl.NumberFormat('en', { style: 'currency', currency: ccy, maximumFractionDigits: 2 }).format(v);
    return `$${amountUsd.toFixed(2)} (≈ ${formatted})`;
  }
}
module.exports = new CurrencyService();
