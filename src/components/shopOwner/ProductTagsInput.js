import { useId, useState } from 'react';
import { normalizeProductTags, suggestedTagsForCategory } from '../../lib/shopProductCategories';
import './productTagsInput.css';

/**
 * Chip-style search tags for the product form.
 * @param {{ tags: string[], onChange: (tags: string[]) => void, category?: string, id?: string, className?: string }} props
 */
export default function ProductTagsInput({ tags = [], onChange, category = '', id, className = '' }) {
  const autoId = useId();
  const inputId = id || autoId;
  const [draft, setDraft] = useState('');
  const current = normalizeProductTags(tags);
  const suggestions = suggestedTagsForCategory(category).filter((s) => !current.includes(s));

  const commit = (raw) => {
    const parts = String(raw || '')
      .split(/[,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    onChange(normalizeProductTags([...current, ...parts]));
    setDraft('');
  };

  const remove = (tag) => {
    onChange(current.filter((t) => t !== tag));
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit(draft);
      return;
    }
    if (e.key === 'Backspace' && !draft && current.length) {
      remove(current[current.length - 1]);
    }
  };

  return (
    <div className={`pti${className ? ` ${className}` : ''}`}>
      <div className="pti-box" onClick={() => document.getElementById(inputId)?.focus()}>
        {current.map((tag) => (
          <span key={tag} className="pti-chip">
            {tag}
            <button type="button" className="pti-chip-x" onClick={() => remove(tag)} aria-label={`Remove ${tag}`}>
              ×
            </button>
          </span>
        ))}
        <input
          id={inputId}
          className="pti-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => {
            if (draft.trim()) commit(draft);
          }}
          placeholder={current.length ? 'Add another…' : 'e.g. organic, milk, large'}
          autoComplete="off"
        />
      </div>
      <p className="pti-hint">Press Enter or comma after each tag. Customers can search by these.</p>
      {suggestions.length ? (
        <div className="pti-suggest" aria-label="Suggested tags">
          {suggestions.slice(0, 8).map((s) => (
            <button
              key={s}
              type="button"
              className="pti-suggest-btn"
              onClick={() => onChange(normalizeProductTags([...current, s]))}
            >
              + {s}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
