// ---------------------------------------------------------------------------
// Zincir üstü (on-chain) ödeme doğrulama.
//
// Amaç: "para gerçekten geldi mi?" sorusunu insan gözüne bırakmamak. Kullanıcı
// işlem hash'ini (txid) bildirdiğinde sunucu, herkese açık blokzincir API'sine
// sorup şunları KANITLAR:
//   1) işlem blokzincirinde var ve onaylanmış,
//   2) TRC20 transferi bizim soğuk cüzdan adresimize yapılmış,
//   3) doğru sözleşme (USDT), doğru ağ,
//   4) tutar sipariş tutarına eşit (eksik ödeme kabul edilmez).
// Hepsi tutuyorsa ödeme otomatik doğrulanır; tutmuyorsa nedeni açıkça yazılır.
//
// Ağ erişimi yoksa/manual doğrulama tercih ediliyorsa admin panelinden elle
// onay yolu korunur (bkz. server/admin.js → /payments/:id/verify).
// ---------------------------------------------------------------------------
const crypto = require('crypto');

const TRONGRID_BASE = () => process.env.TRONGRID_BASE || 'https://api.trongrid.io';
const TRON_API_KEY = () => process.env.TRON_API_KEY || '';
const HTTP_TIMEOUT_MS = Number(process.env.ONCHAIN_TIMEOUT_MS || 9000);

// TRC20 USDT sözleşmesi (Tether, TRON ağı) — ana ağ adresi.
const USDT_TRC20_CONTRACT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const USDT_DECIMALS = 6;

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58ToHex(address) {
  const s = String(address || '');
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)) return null;
  let num = 0n;
  for (const ch of s) {
    const i = B58_ALPHABET.indexOf(ch);
    if (i < 0) return null;
    num = num * 58n + BigInt(i);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  // T-address = 0x41 + 20 bayt adres + 4 bayt checksum
  return hex.slice(0, 42);
}

// TRON (TRC20) adresleri T ile başlar ve toplam 34 karakterdir.
function isValidTronAddress(address) { return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(String(address || '')); }

const normHex = v => String(v || '').toLowerCase().replace(/^0x/, '');
function sameAddress(a, b) {
  if (!a || !b) return false;
  if (String(a).toLowerCase() === String(b).toLowerCase()) return true;
  const ah = base58ToHex(a);
  const bh = normHex(b);
  return !!ah && ah === bh;
}

async function httpGetJson(url, fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== 'function') return { error: 'network_error', detail: 'fetch unavailable' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers = { accept: 'application/json' };
    if (TRON_API_KEY()) headers['TRON-PRO-API-KEY'] = TRON_API_KEY();
    const r = await doFetch(url, { headers, signal: controller.signal });
    if (r.status === 404) return { error: 'not_found' };
    if (!r.ok) return { error: 'network_error', detail: `HTTP ${r.status}` };
    return { data: await r.json() };
  } catch (e) {
    return { error: 'network_error', detail: String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

// TronGrid olay (event) kaydından bize yapılan USDT transferini bulur.
function findUsdtTransfer(events, toAddress, expectedUnits) {
  const list = (events && events.data) || [];
  let seenOtherRecipient = false;
  let seenTooSmall = false;
  for (const ev of list) {
    const name = ev.event_name || (ev.result && ev.result.event_name);
    const contract = ev.contract_address;
    if (!sameAddress(contract, USDT_TRC20_CONTRACT)) continue;
    if (name && name !== 'Transfer') continue;
    const res = ev.result || {};
    const to = res.to || res['1'];
    const value = res.value !== undefined ? res.value : res['2'];
    if (!sameAddress(to, toAddress)) { seenOtherRecipient = true; continue; }
    const units = BigInt(value || 0);
    if (units >= expectedUnits) return { units };
    seenTooSmall = true;
  }
  if (seenTooSmall) return { error: 'amount_too_low' };
  if (seenOtherRecipient) return { error: 'wrong_recipient' };
  return { error: 'transfer_not_found' };
}

const REASON_TEXT = {
  not_found: 'Transaction not found on the blockchain yet.',
  pending_confirmation: 'Transaction exists but is not confirmed yet — try again in ~1 minute.',
  transfer_not_found: 'No USDT transfer to our wallet inside this transaction.',
  wrong_recipient: 'This transaction sent USDT to a different address.',
  wrong_asset: 'This transaction is not a USDT (TRC20) transfer.',
  amount_too_low: 'The transferred amount is lower than the order amount.',
  unsupported_network: 'Automatic check supports USDT-TRC20 only — verify this payment manually.',
  network_error: 'Blockchain API could not be reached — check manually or retry.'
};

// expectedUsd: sipariş tutarı (USDT = 1:1). asset/network TRC20 değilse otomatik
// kontrol yapılmaz, çağıran taraf manuel doğrulamaya yönlendirir.
async function verifyUsdtTrc20({ txHash, toAddress, expectedUsd, asset = 'USDT', network = 'TRC20', fetchImpl, requireConfirmations = true }) {
  const hash = String(txHash || '').trim();
  if (!/^[A-Za-z0-9]{60,80}$/.test(hash)) return { ok: false, reason: 'not_found', message: 'Transaction hash format looks wrong.' };
  if (String(asset).toUpperCase() !== 'USDT' || String(network).toUpperCase() !== 'TRC20') {
    return { ok: false, reason: 'unsupported_network', message: REASON_TEXT.unsupported_network };
  }
  const expectedUnits = BigInt(Math.round(Number(expectedUsd) * 10 ** USDT_DECIMALS));

  const tx = await httpGetJson(`${TRONGRID_BASE()}/v1/transactions/${hash}`, fetchImpl);
  if (tx.error) return { ok: false, reason: tx.error, message: REASON_TEXT[tx.error] || 'Check failed.', detail: tx.detail };
  const record = (tx.data && tx.data.data && tx.data.data[0]) || null;
  if (!record) return { ok: false, reason: 'not_found', message: REASON_TEXT.not_found };
  const ret = (record.ret && record.ret[0] && record.ret[0].contractRet) || record.contractRet || 'SUCCESS';
  if (ret !== 'SUCCESS') return { ok: false, reason: 'transfer_not_found', message: 'The transaction failed on-chain.' };
  if (requireConfirmations && !record.blockNumber) return { ok: false, reason: 'pending_confirmation', message: REASON_TEXT.pending_confirmation };

  const evts = await httpGetJson(`${TRONGRID_BASE()}/v1/transactions/${hash}/events?only_confirmed=true`, fetchImpl);
  if (evts.error) return { ok: false, reason: evts.error, message: REASON_TEXT[evts.error] || 'Check failed.', detail: evts.detail };
  const found = findUsdtTransfer(evts.data, toAddress, expectedUnits);
  if (found.error) return { ok: false, reason: found.error, message: REASON_TEXT[found.error] || 'Transfer not verified.' };

  return {
    ok: true,
    amountUsd: Number(found.units) / 10 ** USDT_DECIMALS,
    expectedUsd: Number(expectedUsd),
    block: record.blockNumber || null,
    message: `Verified on-chain: ${(Number(found.units) / 10 ** USDT_DECIMALS).toFixed(2)} USDT received.`
  };
}

function explorerUrl(network, txHash) {
  const net = String(network || '').toUpperCase();
  const h = String(txHash || '');
  if (!h) return null;
  if (net === 'TRC20') return `https://tronscan.org/#/transaction/${h}`;
  if (net === 'ERC20') return `https://etherscan.io/tx/${h}`;
  if (net === 'BEP20') return `https://bscscan.com/tx/${h}`;
  return null;
}

module.exports = { verifyUsdtTrc20, explorerUrl, base58ToHex, sameAddress, findUsdtTransfer, isValidTronAddress, USDT_TRC20_CONTRACT, REASON_TEXT };
