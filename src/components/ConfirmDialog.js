/**
 * In-app confirm dialog (replaces window.confirm).
 * @param {{
 *   open: boolean,
 *   title: string,
 *   message: string,
 *   confirmLabel?: string,
 *   cancelLabel?: string,
 *   hideCancel?: boolean,
 *   busy?: boolean,
 *   danger?: boolean,
 *   onConfirm: () => void,
 *   onCancel: () => void,
 * }} props
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Keep going',
  hideCancel = false,
  busy = false,
  danger = true,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;

  return (
    <div className="ingo-confirm" role="presentation">
      <button
        type="button"
        className="ingo-confirm__backdrop"
        aria-label="Dismiss"
        disabled={busy}
        onClick={busy ? undefined : onCancel}
      />
      <div
        className="ingo-confirm__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ingo-confirm-title"
        aria-describedby="ingo-confirm-msg"
      >
        <div className={`ingo-confirm__icon${danger ? ' ingo-confirm__icon--danger' : ''}`} aria-hidden>
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
            <path d="M12 8v5.5M12 16.5v.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </div>
        <h2 id="ingo-confirm-title" className="ingo-confirm__title">
          {title}
        </h2>
        <p id="ingo-confirm-msg" className="ingo-confirm__msg">
          {message}
        </p>
        <div className="ingo-confirm__actions">
          {hideCancel ? null : (
            <button type="button" className="ingo-confirm__btn ingo-confirm__btn--ghost" disabled={busy} onClick={onCancel}>
              {cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={`ingo-confirm__btn${danger ? ' ingo-confirm__btn--danger' : ' ingo-confirm__btn--primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Please wait…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
