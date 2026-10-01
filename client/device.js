// Cihaz parmak izi — SENKRON hesaplanır ki ilk oy isteğinden itibaren hazır olsun.
//
// AMAÇ: "mobil veriyi kapat/aç" (IP değişir) veya "çerezleri sil" gibi yollarla
// bedava oyu yenilemeyi engellemek. Sunucu bu imzayı kendi tuzuyla hash'ler,
// ham veri saklamaz ve başka hiçbir amaçla kullanmaz.
//
// Toplananlar yalnızca cihazı ayırt eden teknik değerlerdir (ekran, saat dilimi,
// dil, donanım, canvas çizimi). İsim/e-posta/konum gibi kişisel veri TOPLANMAZ.
let cached = null;

function computeSync() {
  const parts = [];
  try {
    const s = window.screen || {};
    parts.push(`${s.width}x${s.height}x${s.colorDepth}x${s.pixelDepth || 0}`);
    parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || '');
    parts.push((navigator.languages || [navigator.language || '']).join(','));
    const n = navigator;
    parts.push([n.hardwareConcurrency || 0, n.deviceMemory || 0, n.platform || '', n.maxTouchPoints || 0].join('-'));
    const c = document.createElement('canvas');
    c.width = 220; c.height = 40;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.textBaseline = 'top';
      ctx.font = '15px "Arial"';
      ctx.fillStyle = '#f5b524';
      ctx.fillRect(0, 0, 220, 40);
      ctx.fillStyle = '#0b1220';
      ctx.fillText('GLOBAL-LEADERS-LIVE', 4, 8);
      parts.push(c.toDataURL().slice(-96));
      const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) parts.push(String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '').slice(0, 60));
      }
    }
  } catch { /* kısıtlı ortam: eldeki verilerle devam */ }

  // Bağımlılıksız karma (FNV-1a + karışım) — sunucu ayrıca kendi tuzuyla hash'ler.
  const str = parts.join('|');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = (h1 ^ ch) * 0x01000193;
    h2 = (h2 + ch * (i + 7)) * 0x85ebca6b;
  }
  const hex = x => (x >>> 0).toString(16).padStart(8, '0');
  return (hex(h1) + hex(h2) + hex(h1 ^ h2) + hex((h1 + h2) >>> 0)).slice(0, 32);
}

// Gömülü ortamlar (ve testler) cihaz kimliğini sayfadan sabitleyebilir:
//   window.__GL_DEVICE__ = '32-hex-deger'
// Gerçek ziyaretçide bu değer yoktur, parmak izi kullanılır.
function overrideValue() {
  try {
    const ov = typeof window !== 'undefined' ? window.__GL_DEVICE__ : null;
    return typeof ov === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(ov) ? ov : null;
  } catch { return null; }
}

// Her zaman bir değer döner (ilk çağrıda senkron hesaplar).
export function deviceHeader() {
  const ov = overrideValue();
  if (ov) return ov;
  if (!cached) { try { cached = computeSync(); } catch { cached = ''; } }
  return cached;
}

export function initDevice() { deviceHeader(); }
export function primeDevice(value) { cached = value; }
