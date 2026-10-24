import React, { useState } from 'react';
import { Check } from 'lucide-react';
import { Sheet } from './Sheet';

const PRESETS = [
  '#020617', '#0f172a', '#030505', '#111827', '#1e293b', '#334155', '#64748b', '#ffffff',
  '#059669', '#10b981', '#34d399', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#ef4444', '#f97316', '#f59e0b', '#eab308',
];

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Expands #abc to #aabbcc and adds a missing #. Returns null when not a valid colour. */
export function normalizeHex(raw: string): string | null {
  let v = raw.trim();
  if (!v) return null;
  if (!v.startsWith('#')) v = `#${v}`;
  if (/^#[0-9a-fA-F]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return HEX.test(v) ? v.toLowerCase() : null;
}

/** App-styled replacement for <input type="color">: swatch grid + hex entry. */
export function ColorSwatchButton({
  value, onChange, fallback, title, className = '',
}: { value: string; onChange: (hex: string) => void; fallback: string; title: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const current = HEX.test(value) ? value.toLowerCase() : fallback;
  const [draft, setDraft] = useState(current);
  const draftValid = normalizeHex(draft);

  const openSheet = () => { setDraft(current); setOpen(true); };
  const apply = (hex: string) => { onChange(hex); setOpen(false); };

  return (
    <>
      <button type="button" aria-label={`${title}: ${current}`} aria-haspopup="dialog" onClick={openSheet} className={`wy-color-trigger ${className}`}>
        <span style={{ background: current }} />
      </button>
      <Sheet open={open} title={title} onClose={() => setOpen(false)}>
        <div className="wy-color-body">
          <div className="wy-color-grid" role="listbox" aria-label={title}>
            {PRESETS.map(hex => (
              <button
                type="button" key={hex} role="option" aria-selected={hex === current} aria-label={hex}
                className={`wy-color-swatch ${hex === current ? 'is-selected' : ''}`}
                style={{ background: hex }}
                onClick={() => apply(hex)}
              >
                {hex === current && <Check className="w-4 h-4" style={{ color: hex === '#ffffff' || hex === '#eab308' || hex === '#f59e0b' ? '#020617' : '#fff' }} />}
              </button>
            ))}
          </div>
          <label className="wy-color-custom">
            <span>Custom hex</span>
            <div>
              <i style={{ background: draftValid || 'transparent' }} />
              <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && draftValid) { e.preventDefault(); apply(draftValid); } }}
                placeholder="#0f172a"
                maxLength={7}
                autoCapitalize="off"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={!draftValid}
              />
              <button type="button" disabled={!draftValid} onClick={() => draftValid && apply(draftValid)}>Use</button>
            </div>
          </label>
        </div>
      </Sheet>
    </>
  );
}
