import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { isSupabaseConfigured, supabase } from '../../lib/supabaseClient';
import './adminNewOrderNotifier.css';

const POLL_MS = 8000;
const AUTO_DISMISS_MS = 12000;

function shortRef(id) {
  if (!id) return 'ING-—';
  const s = String(id).replace(/-/g, '');
  return `ING-${s.slice(0, 8).toUpperCase()}`;
}

function placeLabel(raw) {
  const t = String(raw ?? '').trim();
  if (!t) return '—';
  return t.split(',')[0].trim().slice(0, 40) || '—';
}

/** Soft two-note chime so admins notice a new order (no asset file). */
function playNewOrderChime() {
  if (typeof window === 'undefined') return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    const ac = new AC();
    const beep = (freq, start, dur) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, ac.currentTime + start);
      g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + start + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
      osc.connect(g);
      g.connect(ac.destination);
      osc.start(ac.currentTime + start);
      osc.stop(ac.currentTime + start + dur + 0.05);
    };
    beep(880, 0, 0.18);
    beep(1175, 0.16, 0.22);
    setTimeout(() => ac.close().catch(() => {}), 800);
  } catch {
    /* ignore audio errors */
  }
}

/**
 * Polls `customer_delivery_orders` and shows a popup whenever a new delivery
 * order is placed. Mounted once inside the admin shell so it works on every page.
 */
export default function AdminNewOrderNotifier() {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState([]);
  const seenIdsRef = useRef(new Set());
  const baselineRef = useRef(null);
  const primedRef = useRef(false);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.key !== id));
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return undefined;
    let cancelled = false;
    let timer = null;

    const poll = async () => {
      const { data, error } = await supabase
        .from('customer_delivery_orders')
        .select('id, created_at, pickup_location, dropoff_location, total_amount')
        .order('created_at', { ascending: false })
        .limit(8);
      if (cancelled || error || !Array.isArray(data)) return;

      if (!primedRef.current) {
        primedRef.current = true;
        baselineRef.current = data[0]?.created_at ? new Date(data[0].created_at).getTime() : Date.now();
        data.forEach((r) => r.id && seenIdsRef.current.add(r.id));
        return;
      }

      const baseline = baselineRef.current ?? 0;
      const fresh = data
        .filter((r) => r.id && !seenIdsRef.current.has(r.id))
        .filter((r) => {
          const t = r.created_at ? new Date(r.created_at).getTime() : 0;
          return t >= baseline;
        })
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));

      if (!fresh.length) return;

      fresh.forEach((r) => seenIdsRef.current.add(r.id));
      const newest = fresh[fresh.length - 1];
      const newestTs = newest.created_at ? new Date(newest.created_at).getTime() : Date.now();
      if (newestTs > baseline) baselineRef.current = newestTs;

      playNewOrderChime();
      setToasts((prev) => [
        ...prev,
        ...fresh.map((r) => ({
          key: r.id,
          ref: shortRef(r.id),
          pickup: placeLabel(r.pickup_location),
          dropoff: placeLabel(r.dropoff_location),
          amount: Number(r.total_amount) || 0,
        })),
      ]);
    };

    poll();
    timer = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!toasts.length) return undefined;
    const timers = toasts.map((t) => window.setTimeout(() => dismiss(t.key), AUTO_DISMISS_MS));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [toasts, dismiss]);

  if (!toasts.length) return null;

  return (
    <div className="admNoteStack" role="region" aria-label="New order notifications">
      {toasts.map((t) => (
        <div key={t.key} className="admNote" role="alert">
          <span className="admNote__pulse" aria-hidden />
          <div className="admNote__icon" aria-hidden>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7l-4-4H9v4zM9 5v4h6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="admNote__body">
            <p className="admNote__title">New delivery order placed</p>
            <p className="admNote__meta">
              {t.ref} · {t.pickup} → {t.dropoff}
            </p>
            <button
              type="button"
              className="admNote__cta"
              onClick={() => {
                dismiss(t.key);
                navigate('/admin/delivery-orders');
              }}
            >
              View order
            </button>
          </div>
          <button type="button" className="admNote__close" aria-label="Dismiss" onClick={() => dismiss(t.key)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
