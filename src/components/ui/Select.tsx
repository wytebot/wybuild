import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { Sheet } from './Sheet';

export interface SelectOption {
  value: string;
  label: string;
  /** Optional second line shown under the label. */
  hint?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** Shown on the trigger when no option matches `value`. */
  placeholder?: string;
  /** Title of the picker sheet. Defaults to the placeholder / "Choose an option". */
  title?: string;
  /** Classes for the trigger button (same classes the old <select> used). */
  className?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
  /** Show a search box. Defaults to on when there are more than 8 options. */
  searchable?: boolean;
  id?: string;
}

/**
 * App-styled replacement for the native <select>.
 * Native selects are drawn by the browser/OS and cannot be themed on Android WebView;
 * this renders the same options in WyBuild's own sheet.
 */
export function Select({
  value, onChange, options, placeholder = 'Choose…', title, className = '', disabled, required, ariaLabel, searchable, id,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const showSearch = searchable ?? options.length > 8;

  const selected = options.find(o => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o => `${o.label} ${o.hint || ''}`.toLowerCase().includes(q));
  }, [options, query]);

  const close = () => { setOpen(false); setQuery(''); };

  const pick = (o: SelectOption) => {
    if (o.disabled) return;
    onChange(o.value);
    close();
  };

  // Highlight the current value when the sheet opens, and keep it in view.
  useEffect(() => {
    if (!open) return;
    const idx = filtered.findIndex(o => o.value === value && !o.disabled);
    setActive(idx >= 0 ? idx : filtered.findIndex(o => !o.disabled));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, query]);

  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const move = (dir: 1 | -1) => {
    if (!filtered.length) return;
    let i = active;
    for (let n = 0; n < filtered.length; n++) {
      i = (i + dir + filtered.length) % filtered.length;
      if (!filtered[i].disabled) { setActive(i); return; }
    }
  };

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(filtered.findIndex(o => !o.disabled)); }
    else if (e.key === 'End') { e.preventDefault(); for (let i = filtered.length - 1; i >= 0; i--) if (!filtered[i].disabled) { setActive(i); break; } }
    else if (e.key === 'Enter') { e.preventDefault(); if (active >= 0 && filtered[active]) pick(filtered[active]); }
  };

  const sheetTitle = title || (placeholder !== 'Choose…' ? placeholder.replace(/…$/, '') : 'Choose an option');

  return (
    <>
      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setOpen(true); } }}
        className={`${className} wy-select-trigger`}
      >
        <span className={`wy-select-value ${selected ? '' : 'is-placeholder'}`}>{selected ? selected.label : placeholder}</span>
        <ChevronDown className={`wy-select-chevron ${open ? 'is-open' : ''}`} aria-hidden="true" />
      </button>
      {required && (
        // Keeps native form validation ("fill out this field") working for required pickers.
        <input tabIndex={-1} aria-hidden="true" required value={value} onChange={() => undefined} className="wy-select-proxy" />
      )}
      <Sheet open={open} title={sheetTitle} onClose={close} initialFocusRef={showSearch ? searchRef : listRef}>
        {showSearch && (
          <div className="wy-select-search">
            <Search className="w-4 h-4" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onListKey}
              placeholder="Search…"
              aria-label="Search options"
              aria-controls={`${uid}-list`}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        )}
        <div
          ref={listRef}
          id={`${uid}-list`}
          role="listbox"
          tabIndex={-1}
          aria-label={sheetTitle}
          aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
          onKeyDown={onListKey}
          className="wy-select-list"
        >
          {filtered.length === 0 && <div className="wy-select-empty">No matches</div>}
          {filtered.map((o, i) => {
            const isSel = o.value === value;
            return (
              <button
                type="button"
                key={`${o.value}-${i}`}
                id={`${uid}-opt-${i}`}
                data-idx={i}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled || undefined}
                tabIndex={-1}
                onClick={() => pick(o)}
                onMouseMove={() => !o.disabled && setActive(i)}
                className={`wy-select-option ${isSel ? 'is-selected' : ''} ${i === active ? 'is-active' : ''} ${o.disabled ? 'is-disabled' : ''}`}
              >
                <span className="wy-select-copy">
                  <span className="wy-select-label">{o.label}</span>
                  {o.hint && <small>{o.hint}</small>}
                </span>
                <span className="wy-select-radio" aria-hidden="true">{isSel && <Check className="w-3.5 h-3.5" />}</span>
              </button>
            );
          })}
        </div>
      </Sheet>
    </>
  );
}
