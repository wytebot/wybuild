import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, ArrowDown } from 'lucide-react';

const THRESHOLD = 72; // px of (damped) pull needed to trigger
const MAX_PULL = 110;

interface Props { onRefresh: () => Promise<void>; className?: string; children: React.ReactNode; }

/**
 * Scroll container with pull-down-to-refresh. Only starts when the container is scrolled to the very top
 * and the finger moves down, so normal scrolling, sliders and horizontal swipes are untouched.
 */
export const PullToRefresh: React.FC<Props> = ({ onRefresh, className = '', children }) => {
  const ref = useRef<HTMLElement | null>(null);
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const pullRef = useRef(0);
  const busy = useRef(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const setPullBoth = (v: number) => { pullRef.current = v; setPull(v); };

  const finish = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    setPullBoth(THRESHOLD * 0.7);
    try { await Promise.all([onRefresh(), new Promise((r) => setTimeout(r, 600))]); } catch { /* individual loaders report their own errors */ }
    busy.current = false;
    setRefreshing(false);
    setPullBoth(0);
  }, [onRefresh]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const insideScrolled = (target: EventTarget | null) => {
      // ignore gestures that start inside a nested scroller that is not at its top (code boxes, logs, lists)
      let n = target as HTMLElement | null;
      while (n && n !== el) {
        if (n.scrollHeight > n.clientHeight + 1 && n.scrollTop > 0 && /(auto|scroll)/.test(getComputedStyle(n).overflowY)) return true;
        n = n.parentElement;
      }
      return false;
    };
    const onStart = (e: TouchEvent) => {
      if (busy.current || e.touches.length !== 1 || el.scrollTop > 0 || insideScrolled(e.target)) { startY.current = null; return; }
      startY.current = e.touches[0].clientY; startX.current = e.touches[0].clientX;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null || busy.current) return;
      const dy = e.touches[0].clientY - startY.current;
      const dx = Math.abs(e.touches[0].clientX - startX.current);
      if (dy <= 0 || dx > dy) { if (pullRef.current) setPullBoth(0); if (dy <= 0) startY.current = null; return; }
      if (el.scrollTop > 0) { startY.current = null; setPullBoth(0); return; }
      if (e.cancelable) e.preventDefault();
      setPullBoth(Math.min(MAX_PULL, dy * 0.5)); // rubber-band damping
    };
    const onEnd = () => {
      if (startY.current === null) return;
      startY.current = null;
      if (pullRef.current >= THRESHOLD) void finish(); else setPullBoth(0);
    };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => { el.removeEventListener('touchstart', onStart); el.removeEventListener('touchmove', onMove); el.removeEventListener('touchend', onEnd); el.removeEventListener('touchcancel', onEnd); };
  }, [finish]);

  const ready = pull >= THRESHOLD;
  return (
    <main ref={ref} className={`relative ${className}`}>
      <div
        aria-hidden={!pull && !refreshing}
        className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex justify-center"
        style={{ transform: `translateY(${pull - 40}px)`, opacity: Math.min(1, pull / 40), transition: startY.current === null ? 'transform .2s ease, opacity .2s ease' : 'none' }}
      >
        <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-full border border-emerald-400/30 bg-[#07100d] shadow-lg">
          {refreshing
            ? <Loader2 className="h-4 w-4 animate-spin text-emerald-300" />
            : <ArrowDown className="h-4 w-4 text-emerald-300 transition-transform" style={{ transform: `rotate(${ready ? 180 : 0}deg)` }} />}
        </div>
      </div>
      <div style={{ transform: pull ? `translateY(${pull * 0.4}px)` : undefined, transition: startY.current === null ? 'transform .2s ease' : 'none' }}>{children}</div>
    </main>
  );
};
