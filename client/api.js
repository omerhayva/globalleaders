// Paylaşılan API istemcisi — X-GL-Session başlığı + localStorage aynası.
// (app.js içindeki aynı mantığın React tarafındaki ikizi; çerez düşerse bile
// oturum kimliği korunur.)
let GLSID = null;
try { GLSID = localStorage.getItem('gl_sid'); } catch { /* erişim yok */ }

export function api(url, opts) {
  const headers = {
    ...(opts && opts.body ? { 'Content-Type': 'application/json' } : {}),
    ...(GLSID ? { 'X-GL-Session': GLSID } : {})
  };
  return fetch(url, {
    ...(opts || {}),
    headers: { ...headers, ...((opts && opts.headers) || {}) },
    body: opts && opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  }).then(async r => {
    const sid = r.headers.get('X-GL-Session');
    if (sid && sid !== GLSID) { GLSID = sid; try { localStorage.setItem('gl_sid', sid); } catch { } }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw j;
    return j;
  });
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const num = n => (n || 0).toLocaleString('en-US');
export const FLAG = cc => String.fromCodePoint(...[...String(cc).toUpperCase()].map(c => 0x1F1A5 + c.charCodeAt(0)));
