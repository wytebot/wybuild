import React, { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

/**
 * App-styled modal sheet used by every picker (Select, ColorField).
 * - bottom sheet on phones, centered card on larger screens
 * - closes on backdrop tap, Escape, the close button and the Android/browser Back gesture
 * - returns focus to the control that opened it
 */
export function Sheet({
  open, title, onClose, children, labelledBy, initialFocusRef,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  labelledBy?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const ownsHistory = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);

  const requestClose = useCallback(() => {
    // If we pushed a history entry, pop it; the popstate handler then calls onClose.
    if (ownsHistory.current) {
      try { window.history.back(); return; } catch { /* fall through */ }
    }
    closeRef.current();
  }, []);

  useEffect(() => {
    if (!open) return;
    returnFocus.current = (document.activeElement as HTMLElement) || null;

    // Back button / back gesture closes the sheet instead of leaving the screen.
    try {
      window.history.pushState({ ...(window.history.state || {}), wySheet: true }, '');
      ownsHistory.current = true;
    } catch { ownsHistory.current = false; }
    const onPop = () => { ownsHistory.current = false; closeRef.current(); };
    window.addEventListener('popstate', onPop);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); requestClose(); }
    };
    document.addEventListener('keydown', onKey, true);

    const t = window.setTimeout(() => {
      (initialFocusRef?.current || panelRef.current)?.focus({ preventScroll: true });
    }, 0);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('popstate', onPop);
      document.removeEventListener('keydown', onKey, true);
      // Closed by selection (not by Back): drop the extra history entry we added.
      if (ownsHistory.current) {
        ownsHistory.current = false;
        try { if (window.history.state?.wySheet) window.history.back(); } catch { /* ignore */ }
      }
      returnFocus.current?.focus?.({ preventScroll: true });
    };
  }, [open, requestClose, initialFocusRef]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="wy-sheet-root" role="presentation">
      <div className="wy-sheet-backdrop" onClick={requestClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="wy-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={labelledBy ? undefined : title}
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        <div className="wy-sheet-grab" aria-hidden="true" />
        <div className="wy-sheet-head">
          <span className="wy-sheet-title">{title}</span>
          <button type="button" className="wy-sheet-close" onClick={requestClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
