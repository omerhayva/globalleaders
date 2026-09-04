import { createPortal } from 'react-dom';
import { useStore } from '../useStore.jsx';

// Bildirim adacığı — #toasts kabına portal ile render edilir.
// html alanı çağıranlar tarafından escape edilmiş değerlerle kurulur.
export function Toasts() {
  const st = useStore();
  const host = document.getElementById('toasts');
  if (!host) return null;
  return createPortal(
    <>
      {st.toasts.map(t => (
        <div key={t.id} className={'toast ' + (t.type || '') + (t.leaving ? ' leaving' : '')}
          dangerouslySetInnerHTML={{ __html: t.html }} />
      ))}
    </>,
    host
  );
}

// Oy kutlama konfetisi — body'ye portal, 2.5s sonra kendini temizler.
export function Confetti() {
  const st = useStore();
  if (!st.confetti.length) return null;
  return createPortal(
    <>{st.confetti.map((style, i) => <i key={i} className="confetti" style={style} />)}</>,
    document.body
  );
}
