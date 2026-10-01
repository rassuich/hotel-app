import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n, LANGUAGE_NAMES } from '../i18n';
import { useOnline } from '../lib/live';
import { guestSteps, type GuestProgressKey, type RequestType } from '../../../shared/src/states';
import { LANGS } from '../../../shared/src/api';

const icon = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" focusable="false">
    {d}
  </svg>
);
/** Line icons for the guest tab bar (always paired with a visible text label). */
export const Icons = {
  home: icon(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /><path d="M10 20v-6h4v6" /></>),
  food: icon(<><path d="M4 15h16" /><path d="M6 15a6 6 0 0 1 12 0" /><path d="M12 7V5" /><path d="M3 18h18" /></>),
  services: icon(<><path d="M4 7h16v12H4z" /><path d="M8 7V5h8v2" /><path d="M4 12h16" /></>),
  requests: icon(<><path d="M8 4h8l1 2h2v15H5V6h2z" /><path d="M9 11h6M9 15h4" /></>),
  stay: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" /></>),
};

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading" role="status" aria-live="polite">
      {t('app.loading')}
    </div>
  );
}
/** Kept for existing call sites. */
export const Spinner = Loading;

export function Notice({ kind = 'info', children, role }: { kind?: 'info' | 'warn' | 'bad' | 'ok' | 'plain'; children: ReactNode; role?: string }) {
  const cls = kind === 'bad' ? 'note bad' : kind === 'ok' ? 'note ok' : kind === 'plain' ? 'note plain' : 'note';
  return (
    <div className={cls} role={role ?? (kind === 'bad' ? 'alert' : undefined)}>
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
        <button className="btn-text" onClick={onRetry}>
          {t('app.retry')}
        </button>
      )}
    </Notice>
  );
}

/** FR · EN · ES, each labelled in its own language. `compact` renders a small select for phone mastheads. */
export function LangSwitch({ compact = false }: { compact?: boolean }) {
  const { lang, setLang, t } = useI18n();
  if (compact) {
    return (
      <select className="lang-select" aria-label={t('app.language')} value={lang} onChange={(e) => setLang(e.target.value as typeof lang)}>
        {LANGS.map((l) => (
          <option key={l} value={l} lang={l} label={l.toUpperCase()}>
            {LANGUAGE_NAMES[l]}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="lang-switch" role="group" aria-label={t('app.language')}>
      {LANGS.map((l) => (
        <button key={l} type="button" aria-pressed={lang === l} lang={l} aria-label={LANGUAGE_NAMES[l]} onClick={() => setLang(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

export function OfflineBanner() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return null;
  return (
    <div className="offline-strip" role="status">
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

/** Native <dialog>: focus handling and Escape come for free. */
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
              <h2 id="sheet-title">{title}</h2>
              <button type="button" className="btn-text" onClick={onClose}>
                {t('app.close')}
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

export function Steps({ type, progress }: { type: RequestType; progress: GuestProgressKey }) {
  const { t } = useI18n();
  const steps = guestSteps(type);
  const map: Partial<Record<GuestProgressKey, GuestProgressKey>> = { confirming_in_person: 'confirming', not_reached: 'confirming' };
  const current = map[progress] ?? progress;
  const idx = steps.indexOf(current);
  const failed = progress === 'not_reached' || progress === 'declined' || progress === 'cancelled';
  return (
    <ol className="steps" aria-hidden="true">
      {steps.map((s, i) => (
        <li key={s} className={failed && (i === idx || idx === -1) ? 'fail' : i <= idx ? 'done' : ''}>
          {t(`progress.step_${s}`)}
        </li>
      ))}
    </ol>
  );
}

/** Tone class for the `.state` label of a guest-facing progress key. */
export function progressTone(p: GuestProgressKey): string {
  if (p === 'not_reached' || p === 'declined') return 'bad';
  if (p === 'cancelled') return 'idle';
  if (p === 'delivered' || p === 'done' || p === 'confirmed') return 'ok';
  return '';
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

export function DemoStrip() {
  const { t } = useI18n();
  return (
    <div className="demo-strip" role="note">
      <strong>{t('app.demo')}</strong>
      {t('app.demoBanner')}
    </div>
  );
}

/** Shown when the guest session cannot be checked (offline or server unreachable). */
export function Unreachable({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <div className="gate-body">
      <p className="eyebrow">{t('app.unreachableEyebrow')}</p>
      <h1 style={{ margin: '8px 0 12px' }}>{t('app.unreachableTitle')}</h1>
      <p className="muted">{t('app.unreachableBody')}</p>
      <button className="btn-primary btn-block" onClick={onRetry}>
        {t('app.retry')}
      </button>
    </div>
  );
}
