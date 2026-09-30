import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, newKey, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { useOnline } from '../../lib/live';
import { useGuest } from '../../lib/guest';
import { ErrorNotice, Notice, ProgressBar, Spinner, progressTone } from '../../components/ui';
import { progressLabel } from './Requests';
import type { GuestNoticeDto, GuestRequestDto } from '../../../../shared/src/api';

export default function RequestDetail() {
  const { ref } = useParams();
  const { t, l, money, time } = useI18n();
  const guest = useGuest();
  const online = useOnline();
  const location = useLocation();
  const active = guest.me?.capability === 'order';
  const q = useQuery<{ request: GuestRequestDto }>(active ? `/api/guest/requests/${ref}` : null, [guest.version]);
  const notices = useQuery<{ notices: GuestNoticeDto[] }>(active ? '/api/guest/notices' : null, [guest.version]);
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

  if (guest.loading) return <Spinner />;
  if (!active) {
    return <Notice kind="info">{guest.me ? t('stay.postStay') : t('requests.needsActivation')}</Notice>;
  }
  if (q.error) return <ErrorNotice code={q.error.code} onRetry={q.reload} />;
  const r = q.data?.request;
  if (!r) return <Spinner />;

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

  return (
    <>
      <p>
        <Link to="/h/requests">← {t('requests.title')}</Link>
      </p>
      <div className="row">
        <h1>{r.type === 'food' ? t('requests.food') : t('requests.service')}</h1>
        <span className={`pill ${progressTone(r.progress)}`}>{progressLabel(t, r)}</span>
      </div>
      <p className="muted">
        {t('requests.ref', { ref: r.ref })} · {t('requests.createdAt', { time: time(r.createdAt) })}
      </p>
      {(location.state as { justSent?: boolean } | null)?.justSent && r.progress === 'sent' && r.type === 'food' && (
        <Notice kind="ok">{r.destination.kind === 'pool' ? t('cart.confirmationInPerson') : t('cart.confirmationRequired')}</Notice>
      )}
      <div className="card">
        <ProgressBar type={r.type} progress={r.progress} />
        <p className="mt mb0" aria-live="polite">
          <strong>{progressLabel(t, r)}</strong>
        </p>
      </div>

      {r.progress === 'not_reached' && (
        <div className="card" style={{ borderColor: '#eec3bf' }}>
          <h2 style={{ marginTop: 0 }}>{t('callback.title')}</h2>
          <p>{t('callback.body')}</p>
          {r.canRequestCallback ? (
            <button className="btn-primary btn-block" onClick={requestCallback} disabled={calling || !online}>
              {calling ? t('callback.requesting') : t('callback.button')}
            </button>
          ) : (
            <Notice kind="info">{t('callback.unavailable')}</Notice>
          )}
          {!online && <p className="muted">{t('app.offline')}</p>}
          {callError && <ErrorNotice code={callError.code} />}
        </div>
      )}
      {requested && r.progress !== 'not_reached' && <Notice kind="ok">{t('callback.requested')}</Notice>}

      <div className="card">
        <h3>{t('requests.items')}</h3>
        <ul className="lines">
          {r.lines.map((x, i) => (
            <li key={i}>
              <div>
                {x.quantity} × {l(x.name)}
                {x.options.length > 0 && <div className="opt">{x.options.map((o) => l(o.name)).join(', ')}</div>}
                {x.details && <div className="opt">{x.details}</div>}
              </div>
              <div>{x.complimentary ? t('services.complimentary') : money(x.lineTotalMinor, r.currency)}</div>
            </li>
          ))}
        </ul>
        <div className="total-row">
          <span>{t('requests.total')}</span>
          <span>{money(r.totalMinor, r.currency)}</span>
        </div>
      </div>
      <div className="card">
        <h3>{t('requests.destination')}</h3>
        <p className="mb0">{l(r.destination.label)}</p>
        {r.notes && (
          <>
            <h3 className="mt">{t('requests.notes')}</h3>
            <p className="mb0">{r.notes}</p>
          </>
        )}
      </div>
      {r.amendments.length > 0 && (
        <div className="card">
          <h3>{t('requests.amendments')}</h3>
          <ul>
            {r.amendments.map((a, i) => (
              <li key={i}>
                {time(a.createdAt)} — {a.note}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.attempts.length > 0 && (
        <div className="card">
          <h3>{t('requests.attempts')}</h3>
          <ul>
            {r.attempts.map((a) => (
              <li key={a.attemptNo}>
                {t('requests.attemptLine', { n: a.attemptNo, status: t(`requests.attempt_${a.status}`) })} · {time(a.resolvedAt ?? a.createdAt)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
