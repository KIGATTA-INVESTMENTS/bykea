import { useId, useMemo, useState } from 'react';
import { PRODUCT_CATEGORIES, normalizeProductCategory } from '../../lib/shopProductCategories';

/**
 * Category field: pick from the full list or type a custom category.
 * @param {{ value: string, onChange: (value: string) => void, id?: string, className?: string, selectClassName?: string }} props
 */
export default function ProductCategoryField({
  value,
  onChange,
  id,
  className = '',
  selectClassName = 'soap-select',
  inputClassName = 'soap-input',
}) {
  const autoId = useId();
  const fieldId = id || autoId;
  const listId = `${fieldId}-list`;
  const normalized = normalizeProductCategory(value);
  const isKnown = PRODUCT_CATEGORIES.some((c) => c.toLowerCase() === String(value || '').trim().toLowerCase());
  const [customMode, setCustomMode] = useState(
    Boolean(String(value || '').trim()) && !isKnown && String(value).trim().toLowerCase() !== 'other',
  );

  const options = useMemo(() => {
    const raw = String(value || '').trim();
    if (raw && !PRODUCT_CATEGORIES.some((c) => c.toLowerCase() === raw.toLowerCase())) {
      return [raw, ...PRODUCT_CATEGORIES];
    }
    return PRODUCT_CATEGORIES;
  }, [value]);

  if (customMode) {
    return (
      <div className={`pcf${className ? ` ${className}` : ''}`}>
        <input
          id={fieldId}
          className={inputClassName}
          list={listId}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          onBlur={() => onChange(normalizeProductCategory(value))}
          placeholder="Type a category"
          autoComplete="off"
        />
        <datalist id={listId}>
          {PRODUCT_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button
          type="button"
          className="soap-cat-switch"
          onClick={() => {
            setCustomMode(false);
            onChange(isKnown ? normalized : 'Other');
          }}
        >
          Choose from list
        </button>
      </div>
    );
  }

  return (
    <div className={`pcf${className ? ` ${className}` : ''}`}>
      <div className="soap-select-wrap pcf-select-wrap">
        <select
          className={selectClassName}
          id={fieldId}
          value={isKnown ? normalized : options[0] || 'Other'}
          onChange={(e) => {
            if (e.target.value === '__custom__') {
              setCustomMode(true);
              onChange('');
              return;
            }
            onChange(e.target.value);
          }}
        >
          {options.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value="__custom__">Custom category…</option>
        </select>
        <span className="soap-select-chevron" aria-hidden>
          ▾
        </span>
      </div>
    </div>
  );
}
