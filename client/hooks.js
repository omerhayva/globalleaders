import { useEffect, useRef, useState } from 'react';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Sayı yumuşakça yuvarlanarak hedefe ulaşsın (SSR rollNumber davranışının React ikizi).
// Tüm adacıklar (liderlik, istatistik halkaları) ortak kullanır.
export function useRoll(target) {
  const [v, setV] = useState(target);
  const cur = useRef(target);
  useEffect(() => {
    if (reduceMotion || Math.abs(target - cur.current) > 5000) { cur.current = target; setV(target); return; }
    const from = cur.current, t0 = performance.now(), dur = 900;
    let raf;
    const step = t => {
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(from + (target - from) * e));
      if (p < 1) raf = requestAnimationFrame(step); else cur.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return v;
}

// Mount sonrası bir kare bekleyip "aç" — CSS geçişlerini (halka dolgunu, çubuk
// büyümesi) güvenle tetiklemek için kullanılır.
export function useEnter(delay = 60) {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), delay); return () => clearTimeout(t); }, [delay]);
  return on;
}
