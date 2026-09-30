import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';
import { useOnline } from '../lib/live';
import { guestSteps, type GuestProgressKey, type RequestType } from '../../../shared/src/states';

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
export const Icons = {
  home: icon(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
  food: icon(<><path d="M4 15h16" /><path d="M6 15a6 6 0 0 1 12 0" /><path d="M12 7V5" /><path d="M3 18h18" /></>),
  services: icon(<><path d="M4 7h16v12H4z" /><path d="M8 7V5h8v2" /><path d="M4 12h16" /></>),
  requests: icon(<><path d="M8 4h8l1 2h2v15H5V6h2z" /><path d="M9 11h6M9 15h4" /></>),
  stay: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>),
  pin: icon(<><path d="M12 21s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>),
};

export function Spinner() {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite">
      <div className="spinner" />
      <span className="visually-hidden">{t('app.loading')}</span>
    </div>
  );
}

export function Notice({ kind = 'info', children, role }: { kind?: 'info' | 'warn' | 'bad' | 'ok' | 'demo'; children: ReactNode; role?: string }) {
  return (
    <div className={`notice notice-${kind}`} role={role ?? (kind === 'bad' ? 'alert' : undefined)}>
      {children}
    </div>
  );
}

export function ErrorNotice({ code, onRetry }: { code?: string; onRetry?: () => void }) {
  const { err, t } = useI18n();
  return (
    <Notice kind="bad">
      <p className="mb0">{err(code)}</p>
      {onRetry && (
        <button className="btn-secondary btn-sm mt" onClick={onRetry}>
          {t('app.retry')}
        </button>
      )}
    </Notice>
  );
}

export function LangSwitch({ className = 'lang-btn' }: { className?: string }) {
  const { lang, setLang, t } = useI18n();
  return (
    <button type="button" className={className} onClick={() => setLang(lang === 'fr' ? 'en' : 'fr')} lang={lang === 'fr' ? 'en' : 'fr'} aria-label={`${t('app.language')}: ${t('app.switchTo')}`}>
      {lang === 'fr' ? 'EN' : 'FR'}
    </button>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return (
    <div className="notice notice-warn banner" role="status">
      {t('app.offline')}
    </div>
  );
}

export function Stepper({ value, min = 1, max, onChange, label }: { value: number; min?: number; max: number; onChange: (v: number) => void; label: string }) {
  const { t } = useI18n();
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={t('food.decrease')}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={t('food.increase')}>
        +
      </button>
    </div>
  );
}

/** Native <dialog> as a bottom sheet: focus handling and Escape come for free. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const { t } = useI18n();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" onClose={onClose} onCancel={onClose} aria-labelledby="sheet-title">
      {open && (
        <>
          <div className="sheet-body">
            <div className="sheet-head">
              <h2 id="sheet-title" style={{ marginTop: 0 }}>
                {title}
              </h2>
              <button type="button" className="btn-ghost btn-sm" onClick={onClose} aria-label={t('app.close')}>
                ✕
              </button>
            </div>
            {children}
          </div>
          {footer && <div className="sheet-foot">{footer}</div>}
        </>
      )}
    </dialog>
  );
}

export function ProgressBar({ type, progress }: { type: RequestType; progress: GuestProgressKey }) {
  const { t } = useI18n();
  const steps = guestSteps(type);
  const map: Partial<Record<GuestProgressKey, GuestProgressKey>> = { confirming_in_person: 'confirming', not_reached: 'confirming' };
  const current = map[progress] ?? progress;
  const idx = steps.indexOf(current);
  const failed = progress === 'not_reached' || progress === 'declined' || progress === 'cancelled';
  return (
    <div aria-hidden="true">
      <div className="progress">
        {steps.map((s, i) => (
          <span key={s} className={failed && (i === idx || idx === -1) ? 'fail' : i <= idx ? 'done' : ''} />
        ))}
      </div>
      <div className="steps-labels">
        {steps.map((s) => (
          <span key={s}>{t(`progress.step_${s}`)}</span>
        ))}
      </div>
    </div>
  );
}

export function progressTone(p: GuestProgressKey): string {
  if (p === 'not_reached' || p === 'declined') return 'pill-bad';
  if (p === 'cancelled') return 'pill-muted';
  if (p === 'delivered' || p === 'done' || p === 'confirmed') return 'pill-ok';
  return 'pill-info';
}

export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDone, 4000);
    return () => clearTimeout(id);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div className="toast" role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  return { message, show: setMessage, clear: () => setMessage(null) };
}
