import React, { useId, useMemo, useState } from 'react';

/** App-styled replacement for <input list="…"> + <datalist>: free text with a themed suggestion list. */
export function ComboInput({
  value, onChange, suggestions, className = '', placeholder, id,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  className?: string;
  placeholder?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const shown = useMemo(() => {
    const q = value.trim().toLowerCase();
    return suggestions.filter(s => s.toLowerCase().includes(q) && s !== value).slice(0, 8);
  }, [suggestions, value]);
  const visible = open && shown.length > 0;

  return (
    <div className="wy-combo">
      <input
        id={id}
        className={className}
        value={value}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={visible}
        aria-controls={`${uid}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
      />
      {visible && (
        <div id={`${uid}-list`} role="listbox" className="wy-combo-list">
          {shown.map(s => (
            <button
              type="button" role="option" aria-selected={false} key={s}
              onPointerDown={e => e.preventDefault()}
              onClick={() => { onChange(s); setOpen(false); }}
              className="wy-select-option"
            >
              <span className="wy-select-copy"><span className="wy-select-label">{s}</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
