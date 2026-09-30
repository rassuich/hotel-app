import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, newKey, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { useOnline } from '../../lib/live';
import { useGuest } from '../../lib/guest';
import { ErrorNotice, Loading, Notice, Steps, progressTone } from '../../components/ui';
import { progressLabel } from './Requests';
import type { GuestNoticeDto, GuestRequestDto } from '../../../../shared/src/api';

export default function RequestDetail() {
  const { ref } = useParams();
  const { t, l, money, time } = useI18n();
  const guest = useGuest();
  const online = useOnline();
  const location = useLocation();
  const q = useQuery<{ request: GuestRequestDto }>(`/api/guest/requests/${ref}`, [guest.version]);
  const notices = useQuery<{ notices: GuestNoticeDto[] }>('/api/guest/notices', [guest.version]);
  const [calling, setCalling] = useState(false);
  const [callError, setCallError] = useState<ApiError | null>(null);
  const [callbackKey, setCallbackKey] = useState(newKey);
  const [requested, setRequested] = useState(false);

  // Viewing the request on a visible screen marks its notices as read (shared across the stay's devices).
  useEffect(() => {
    const markRead = () => {
      if (document.visibilityState !== 'visible') return;
      for (const n of notices.data?.notices ?? []) {
        if (n.requestRef === ref && !n.readAt) void post(`/api/guest/notices/${n.id}/read`).catch(() => undefined);
      }
    };
    markRead();
    document.addEventListener('visibilitychange', markRead);
    return () => document.removeEventListener('visibilitychange', markRead);
  }, [notices.data, ref]);

  if (q.error) return <ErrorNotice code={q.error.code} onRetry={q.reload} />;
  const r = q.data?.request;
  if (!r) return <Loading />;

  const requestCallback = async () => {
    setCalling(true);
    setCallError(null);
    try {
      await post(`/api/guest/requests/${r.ref}/callback`, { idempotencyKey: callbackKey });
      setRequested(true);
      setCallbackKey(newKey());
      await q.reload();
    } catch (e) {
      setCallError(e as ApiError);
    } finally {
      setCalling(false);
    }
  };

  const justSent = (location.state as { justSent?: boolean } | null)?.justSent && r.progress === 'sent';
  return (
    <>
      <div className="page-head">
        <Link to="/h/requests" className="btn-text">
          ← {t('requests.title')}
        </Link>
        <span className="eyebrow" style={{ display: 'block' }}>
          {t('requests.ref', { ref: r.ref })} · <span className="num">{t('requests.createdAt', { time: time(r.createdAt) })}</span>
        </span>
        <h1>{r.type === 'food' ? t('requests.food') : t('requests.service')}</h1>
        <p aria-live="polite" style={{ color: 'var(--ink)' }}>
          <span className={`state ${progressTone(r.progress)}`}>{progressLabel(t, r)}</span>
        </p>
        <Steps type={r.type} progress={r.progress} />
      </div>
      {justSent && (
        <div className="pad">
          <Notice kind="ok">
            {r.type === 'service' ? t('services.sent') : r.destination.kind === 'pool' ? t('cart.confirmationInPerson') : t('cart.confirmationRequired')}
          </Notice>
        </div>
      )}

      {r.progress === 'not_reached' && (
        <section className="section" style={{ borderLeft: '3px solid var(--error)' }}>
          <h2>{t('callback.title')}</h2>
          <p className="mt">{t('callback.body')}</p>
          {r.canRequestCallback ? (
            <button className="btn-primary btn-block" onClick={requestCallback} disabled={calling || !online}>
              {calling ? t('callback.requesting') : t('callback.button')}
            </button>
          ) : (
            <Notice kind="plain">{t('callback.unavailable')}</Notice>
          )}
          {!online && <p className="muted mt">{t('app.offline')}</p>}
          {callError && <ErrorNotice code={callError.code} />}
        </section>
      )}
      {requested && r.progress !== 'not_reached' && (
        <div className="pad">
          <Notice kind="ok">{t('callback.requested')}</Notice>
        </div>
      )}

      <section className="section">
        <h2 className="eyebrow">{t('requests.items')}</h2>
        <ul className="lines">
          {r.lines.map((x, i) => (
            <li key={i}>
              <div>
                {x.quantity} × {l(x.name)}
                {x.options.length > 0 && <div className="opt">{x.options.map((o) => l(o.name)).join(', ')}</div>}
                {x.details && <div className="opt">{x.details}</div>}
              </div>
              <div className="num">{x.complimentary ? t('services.complimentary') : money(x.lineTotalMinor, r.currency)}</div>
            </li>
          ))}
        </ul>
        <div className="total-row">
          <span>{t('requests.total')}</span>
          <span className="num">{money(r.totalMinor, r.currency)}</span>
        </div>
      </section>
      <section className="section">
        <h2 className="eyebrow">{t('requests.destination')}</h2>
        <p className="mb0">{l(r.destination.label)}</p>
        {r.notes && (
          <>
            <h2 className="eyebrow mt">{t('requests.notes')}</h2>
            <p className="mb0">{r.notes}</p>
          </>
        )}
      </section>
      {r.amendments.length > 0 && (
        <section className="section">
          <h2 className="eyebrow">{t('requests.amendments')}</h2>
          <ul className="lines">
            {r.amendments.map((a, i) => (
              <li key={i}>
                <span>{a.note}</span>
                <span className="num muted">{time(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.attempts.length > 0 && (
        <section className="section">
          <h2 className="eyebrow">{t('requests.attempts')}</h2>
          <ul className="lines">
            {r.attempts.map((a) => (
              <li key={a.attemptNo}>
                <span>{t('requests.attemptLine', { n: a.attemptNo, status: t(`requests.attempt_${a.status}`) })}</span>
                <span className="num muted">{time(a.resolvedAt ?? a.createdAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
