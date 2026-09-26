import { useLayoutEffect, useRef, useState } from 'react';

export function useSize<T extends HTMLElement>(): [React.RefObject<T | null>, { width: number; height: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.round(r.width) === s.width && Math.round(r.height) === s.height ? s : { width: Math.round(r.width), height: Math.round(r.height) }));
    };
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    // Web fonts reflow the page after first layout; ResizeObserver only fires on rendered frames,
    // so also re-measure when fonts land and on a couple of timers (background tabs, headless capture).
    document.fonts?.addEventListener('loadingdone', set);
    window.addEventListener('resize', set);
    const timers = [250, 1000, 2500].map((ms) => setTimeout(set, ms));
    return () => {
      ro.disconnect();
      document.fonts?.removeEventListener('loadingdone', set);
      window.removeEventListener('resize', set);
      timers.forEach(clearTimeout);
    };
  }, []);
  return [ref, size];
}
