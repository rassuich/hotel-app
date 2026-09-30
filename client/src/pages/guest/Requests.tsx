import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { ErrorNotice, Notice, Spinner, progressTone } from '../../components/ui';
import type { GuestNoticeDto, GuestRequestDto } from '../../../../shared/src/api';

export function progressLabel(t: (k: string) => string, r: Pick<GuestRequestDto, 'type' | 'progress'>) {
  return r.type === 'service' && r.progress === 'sent' ? t('progress.sent_service') : t(`progress.${r.progress}`);
}

export default function Requests() {
  const { t, l, time } = useI18n();
  const guest = useGuest();
  const active = guest.me?.capability === 'order';
  const q = useQuery<{ requests: GuestRequestDto[] }>(active ? '/api/guest/requests' : null, [guest.version]);
  const notices = useQuery<{ notices: GuestNoticeDto[] }>(active ? '/api/guest/notices' : null, [guest.version]);

  if (guest.loading) return <Spinner />;
  if (!active) {
    return (
      <>
        <h1>{t('requests.title')}</h1>
        <Notice kind="info">
          <p>{guest.me ? t('stay.postStay') : t('requests.needsActivation')}</p>
          {!guest.me && (
            <Link className="btn btn-secondary btn-sm" to="/activate">
              {t('home.activateCta')}
            </Link>
          )}
        </Notice>
      </>
    );
  }
  const unread = notices.data?.notices.filter((n) => !n.readAt) ?? [];
  return (
    <>
      <div className="row">
        <h1>{t('requests.title')}</h1>
        <span className={`pill ${guest.live === 'live' ? 'pill-ok' : 'pill-muted'}`}>{guest.live === 'live' ? t('requests.live') : t('requests.reconnecting')}</span>
      </div>
      <p className="muted">{t('requests.subtitle')}</p>
      {unread.map((n) => (
        <Notice kind="warn" key={n.id} role="alert">
          <strong>{t('requests.noticeTitle')}</strong>
          <p>{t('requests.noticeBody', { ref: n.requestRef ?? '' })}</p>
          {n.requestRef && (
            <Link className="btn btn-primary btn-sm" to={`/h/requests/${n.requestRef}`}>
              {t('requests.viewNotice')}
            </Link>
          )}
        </Notice>
      ))}
      {q.loading && !q.data && <Spinner />}
      {q.error && <ErrorNotice code={q.error.code} onRetry={q.reload} />}
      {q.data?.requests.length === 0 && <p className="muted">{t('requests.empty')}</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {q.data?.requests.map((r) => (
          <li key={r.ref}>
            <Link to={`/h/requests/${r.ref}`} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
              <div className="row">
                <strong>{r.type === 'food' ? t('requests.food') : t('requests.service')}</strong>
                <span className={`pill ${progressTone(r.progress)}`}>{progressLabel(t, r)}</span>
              </div>
              <div className="muted">
                {t('requests.ref', { ref: r.ref })} · {t('requests.createdAt', { time: time(r.createdAt) })} · {l(r.destination.label)}
              </div>
              <div>{r.lines.map((x) => `${x.quantity} × ${l(x.name)}`).join(', ')}</div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
