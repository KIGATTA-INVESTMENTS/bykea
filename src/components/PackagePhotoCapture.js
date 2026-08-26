import { useId, useRef, useState } from 'react';
import { compressImageToDataUrl } from '../lib/compressImageToDataUrl';
import './PackagePhotoCapture.css';

function CamIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M8 7l1.4-2.2h5.2L16 7" strokeLinecap="round" />
      <circle cx="12" cy="13.5" r="3.1" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M12 16V5" strokeLinecap="round" />
      <path d="M8 9l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 19h14" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Take (camera) or upload a package photo. `onChange(dataUrl, fileName)`.
 */
export default function PackagePhotoCapture({
  value,
  onChange,
  label = 'Package photo',
  hint = 'Take a clear photo of the parcel so both of you can confirm what is being delivered.',
  compact = false,
  disabled = false,
  required = false,
}) {
  const uid = useId();
  const camRef = useRef(null);
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const processFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const url = await compressImageToDataUrl(file, compact ? 720 : 960, 0.76);
      onChange?.(url, file.name || 'package.jpg');
    } catch (e) {
      setErr(e?.message || 'Could not read that image. Try another photo.');
    } finally {
      setBusy(false);
      if (camRef.current) camRef.current.value = '';
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const locked = disabled || busy;

  return (
    <div className={compact ? 'pkg-photo pkg-photo--compact' : 'pkg-photo'}>
      {label ? (
        <p className="pkg-photo__label">
          {label}
          {required ? ' (required)' : ''}
        </p>
      ) : null}
      {hint ? <p className="pkg-photo__hint">{hint}</p> : null}
      <div className="pkg-photo__actions">
        <button
          type="button"
          className="pkg-photo__btn pkg-photo__btn--cam"
          disabled={locked}
          onClick={() => camRef.current?.click()}
        >
          <CamIcon />
          {busy ? 'Processing…' : 'Take photo'}
        </button>
        <button type="button" className="pkg-photo__btn" disabled={locked} onClick={() => fileRef.current?.click()}>
          <UploadIcon />
          Upload
        </button>
      </div>
      <input
        id={`${uid}-cam`}
        ref={camRef}
        className="pkg-photo__file"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={locked}
        onChange={(e) => processFile(e.currentTarget.files?.[0])}
      />
      <input
        id={`${uid}-file`}
        ref={fileRef}
        className="pkg-photo__file"
        type="file"
        accept="image/*"
        disabled={locked}
        onChange={(e) => processFile(e.currentTarget.files?.[0])}
      />
      {value ? (
        <div className="pkg-photo__previewWrap">
          <img className="pkg-photo__preview" src={value} alt="Package" />
          <button
            type="button"
            className="pkg-photo__rm"
            disabled={locked}
            onClick={() => {
              setErr('');
              onChange?.(null, '');
            }}
          >
            Remove
          </button>
        </div>
      ) : null}
      {err ? (
        <p className="pkg-photo__err" role="alert">
          {err}
        </p>
      ) : null}
    </div>
  );
}
