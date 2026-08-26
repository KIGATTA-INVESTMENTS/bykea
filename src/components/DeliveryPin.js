import { useEffect, useMemo, useRef } from 'react';
import { DELIVERY_PIN_LENGTH, normalizeDeliveryCodeInput } from '../lib/deliveryConfirmationCode';
import './DeliveryPin.css';

/**
 * Shared 6-digit delivery PIN boxes — same UI for customer (read-only) and driver (entry).
 * Typing a digit fills the current box and moves the cursor to the next one.
 * @param {{
 *   value?: string,
 *   onChange?: (next: string) => void,
 *   readOnly?: boolean,
 *   disabled?: boolean,
 *   autoFocus?: boolean,
 *   idPrefix?: string,
 *   ariaLabel?: string,
 * }} props
 */
export default function DeliveryPin({
  value = '',
  onChange,
  readOnly = false,
  disabled = false,
  autoFocus = false,
  idPrefix = 'pin',
  ariaLabel = 'Delivery PIN',
}) {
  const digits = useMemo(() => {
    const s = normalizeDeliveryCodeInput(value);
    return Array.from({ length: DELIVERY_PIN_LENGTH }, (_, i) => s[i] || '');
  }, [value]);
  const refs = useRef([]);
  const pendingFocusRef = useRef(null);

  useEffect(() => {
    if (autoFocus && !readOnly && !disabled) {
      refs.current[0]?.focus();
    }
  }, [autoFocus, readOnly, disabled]);

  useEffect(() => {
    const i = pendingFocusRef.current;
    if (i == null) return;
    pendingFocusRef.current = null;
    const el = refs.current[i];
    if (!el) return;
    el.focus();
    el.select?.();
  }, [digits]);

  const commit = (nextDigits, focusIndex) => {
    if (readOnly || disabled || !onChange) return;
    const nextValue = nextDigits.join('');
    const unchanged = nextValue === digits.join('');
    if (typeof focusIndex === 'number') pendingFocusRef.current = focusIndex;
    if (!unchanged) {
      onChange(nextValue);
      return;
    }
    pendingFocusRef.current = null;
    if (typeof focusIndex === 'number') {
      const el = refs.current[focusIndex];
      el?.focus();
      el?.select?.();
    }
  };

  const focusBox = (index) => {
    const i = Math.max(0, Math.min(DELIVERY_PIN_LENGTH - 1, index));
    pendingFocusRef.current = i;
    const el = refs.current[i];
    el?.focus();
    el?.select?.();
  };

  const onKeyDown = (index, e) => {
    if (readOnly || disabled) return;

    if (e.key === 'Backspace') {
      e.preventDefault();
      const next = digits.slice();
      if (next[index]) {
        next[index] = '';
        commit(next, index);
      } else if (index > 0) {
        next[index - 1] = '';
        commit(next, index - 1);
      }
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      const next = digits.slice();
      next[index] = '';
      commit(next, index);
      return;
    }

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (index > 0) focusBox(index - 1);
      return;
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (index < DELIVERY_PIN_LENGTH - 1) focusBox(index + 1);
      return;
    }

    if (e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      return;
    }

    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      const next = digits.slice();
      next[index] = e.key;
      commit(next, index < DELIVERY_PIN_LENGTH - 1 ? index + 1 : index);
    }
  };

  const onBoxChange = (index, raw) => {
    if (readOnly || disabled || !onChange) return;
    const cleaned = String(raw || '').replace(/\D/g, '');
    if (!cleaned) {
      if (digits[index]) {
        const next = digits.slice();
        next[index] = '';
        commit(next, index);
      }
      return;
    }
    if (cleaned.length > 1) {
      const pasted = normalizeDeliveryCodeInput(index === 0 ? cleaned : `${digits.slice(0, index).join('')}${cleaned}`);
      const arr = Array.from({ length: DELIVERY_PIN_LENGTH }, (_, i) => pasted[i] || '');
      commit(arr, Math.min(Math.max(index + cleaned.length, pasted.length), DELIVERY_PIN_LENGTH) - 1);
      return;
    }
    if (digits[index] === cleaned) return;
    const next = digits.slice();
    next[index] = cleaned;
    commit(next, index < DELIVERY_PIN_LENGTH - 1 ? index + 1 : index);
  };

  return (
    <div className={`dpin${readOnly ? ' dpin--view' : ''}`} role="group" aria-label={ariaLabel}>
      {digits.map((d, i) => (
        <input
          key={`${idPrefix}-${i}`}
          id={`${idPrefix}-${i}`}
          ref={(el) => {
            refs.current[i] = el;
          }}
          className="dpin__box"
          value={d}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={DELIVERY_PIN_LENGTH}
          readOnly={readOnly}
          disabled={disabled}
          aria-label={`PIN digit ${i + 1} of ${DELIVERY_PIN_LENGTH}`}
          onChange={(e) => onBoxChange(i, e.target.value)}
          onKeyDown={(e) => onKeyDown(i, e)}
        />
      ))}
    </div>
  );
}
