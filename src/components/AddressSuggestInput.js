import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fetchAddressAutocompleteSuggestions } from '../lib/reverseGeocode';
import './AddressSuggestInput.css';

const DEBOUNCE_MS = 100;

/**
 * Address field with debounced suggestions (Google Places or Nominatim).
 * @param {boolean} [inline=false] — render the list under the field (good for /request-delivery). Default uses a body portal (avoids clipping on some layouts).
 * @param {(suggestion: { id: string, label: string, lat?: number, lng?: number }) => void} [onSelectSuggestion]
 */
export default function AddressSuggestInput({
  id,
  name,
  value,
  onChange,
  onSelectSuggestion,
  placeholder,
  ariaLabel,
  autoComplete = 'off',
  debounceMs = DEBOUNCE_MS,
  minChars = 2,
  inline = false,
  className = '',
}) {
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [highlight, setHighlight] = useState(-1);
  const [listPos, setListPos] = useState({ top: 0, left: 0, width: 0 });
  const debounceRef = useRef(null);
  const reqIdRef = useRef(0);

  const runFetch = useCallback(
    async (q) => {
      const idReq = ++reqIdRef.current;
      if (q.length < minChars) {
        setSuggestions([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const rows = await fetchAddressAutocompleteSuggestions(q, { limit: 6 });
        if (reqIdRef.current !== idReq) return;
        setSuggestions(rows);
      } catch {
        if (reqIdRef.current !== idReq) return;
        setSuggestions([]);
      } finally {
        if (reqIdRef.current === idReq) setLoading(false);
      }
    },
    [minChars],
  );

  useEffect(() => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    const q = String(value || '').trim();
    if (q.length < minChars) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }
    debounceRef.current = window.setTimeout(() => {
      runFetch(q);
    }, debounceMs);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [value, debounceMs, minChars, runFetch]);

  const showList = open && suggestions.length > 0;

  const syncListPosition = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setListPos({ top: r.bottom + 2, left: r.left, width: r.width });
  }, []);

  useLayoutEffect(() => {
    if (!showList || inline) return undefined;
    syncListPosition();
    window.addEventListener('resize', syncListPosition);
    window.addEventListener('scroll', syncListPosition, true);
    return () => {
      window.removeEventListener('resize', syncListPosition);
      window.removeEventListener('scroll', syncListPosition, true);
    };
  }, [showList, suggestions, inline, syncListPosition]);

  useEffect(() => {
    const onDoc = (e) => {
      const t = e.target;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
      setHighlight(-1);
    };
    document.addEventListener('pointerdown', onDoc, true);
    return () => document.removeEventListener('pointerdown', onDoc, true);
  }, []);

  const onInputChange = (e) => {
    onChange(e.target.value);
    onSelectSuggestion?.(null);
    setOpen(true);
    setHighlight(-1);
  };

  const pick = (suggestion) => {
    const label = typeof suggestion === 'string' ? suggestion : suggestion?.label;
    onChange(label || '');
    if (suggestion && typeof suggestion === 'object') {
      onSelectSuggestion?.(suggestion);
    } else {
      onSelectSuggestion?.(null);
    }
    setOpen(false);
    setSuggestions([]);
    setHighlight(-1);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter') {
      // Always stop Enter from submitting the parent Delivery/Taxi form while typing an address.
      if (open || suggestions.length > 0 || highlight >= 0) {
        e.preventDefault();
      }
      if (open && suggestions.length > 0 && highlight >= 0 && suggestions[highlight]) {
        pick(suggestions[highlight]);
      }
      return;
    }
    if (!open || suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(suggestions.length - 1, h + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
    }
  };

  useEffect(() => {
    if (highlight < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  const listClass = ['addr-suggest__list', inline ? 'addr-suggest__list--inline' : 'addr-suggest__list--portal'].join(' ');

  const listInner = showList ? (
    <ul
      id={`${id}-suggest-list`}
      ref={listRef}
      className={listClass}
      style={
        inline
          ? undefined
          : {
              top: listPos.top,
              left: listPos.left,
              width: Math.max(200, listPos.width),
            }
      }
      role="listbox"
    >
      {suggestions.map((s, i) => (
        <li key={s.id} role="presentation">
          <button
            type="button"
            role="option"
            data-idx={i}
            aria-selected={highlight === i}
            className={`addr-suggest__item${highlight === i ? ' addr-suggest__item--active' : ''}`}
            onMouseDown={(ev) => {
              ev.preventDefault();
              pick(s);
            }}
            onMouseEnter={() => setHighlight(i)}
          >
            {s.label}
          </button>
        </li>
      ))}
    </ul>
  ) : null;

  const listEl = showList && (inline ? listInner : createPortal(listInner, document.body));

  return (
    <div className={`flow-input-wrap addr-suggest${inline ? ' addr-suggest--inline' : ''}${className ? ` ${className}` : ''}`} ref={wrapRef}>
      <input
        ref={inputRef}
        id={id}
        className="flow-input"
        name={name}
        value={value}
        onChange={onInputChange}
        onFocus={() => {
          setOpen(true);
          const q = String(value || '').trim();
          if (q.length >= minChars) runFetch(q);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-expanded={showList}
        aria-controls={showList ? `${id}-suggest-list` : undefined}
        role="combobox"
      />
      {loading ? <span className="addr-suggest__loading">…</span> : null}
      {listEl}
    </div>
  );
}
