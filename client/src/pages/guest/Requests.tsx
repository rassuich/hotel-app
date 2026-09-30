import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { ErrorNotice, Loading, Notice, progressTone } from '../../components/ui';
import type { GuestNoticeDto, GuestRequestDto } from '../../../../shared/src/api';

export function progressLabel(t: (k: string) => string, r: Pick<GuestRequestDto, 'type' | 'progress'>) {
  return r.type === 'service' && r.progress === 'sent' ? t('progress.sent_service') : t(`progress.${r.progress}`);
}

export default function Requests() {
  const { t, l, time } = useI18n();
  const guest = useGuest();
  const q = useQuery<{ requests: GuestRequestDto[] }>('/api/guest/requests', [guest.version]);
  const notices = useQuery<{ notices: GuestNoticeDto[] }>('/api/guest/notices', [guest.version]);
  const unread = notices.data?.notices.filter((n) => !n.readAt) ?? [];

  return (
    <>
      <div className="page-head">
        <div className="row">
          <span className="eyebrow">{guest.live === 'live' ? t('requests.live') : t('requests.reconnecting')}</span>
        </div>
        <h1>{t('requests.title')}</h1>
        <p>{t('requests.subtitle')}</p>
      </div>
      {unread.map((n) => (
        <div className="pad" key={n.id}>
          <Notice kind="bad" role="alert">
            <p>
              <strong>{t('requests.noticeTitle')}</strong>
            </p>
            <p>{t('requests.noticeBody', { ref: n.requestRef ?? '' })}</p>
            {n.requestRef && (
              <Link className="btn btn-primary btn-sm" to={`/h/requests/${n.requestRef}`}>
                {t('requests.viewNotice')}
              </Link>
            )}
          </Notice>
        </div>
      ))}
      {q.loading && !q.data && <Loading />}
      {q.error && <ErrorNotice code={q.error.code} onRetry={q.reload} />}
      {q.data?.requests.length === 0 && <p className="section muted">{t('requests.empty')}</p>}
      <ul className="list" style={{ borderTop: 0 }}>
        {q.data?.requests.map((r) => (
          <li key={r.ref}>
            <Link to={`/h/requests/${r.ref}`} className="row-link">
              <span className="title">{r.type === 'food' ? t('requests.food') : t('requests.service')}</span>
              <span className={`state ${progressTone(r.progress)}`}>{progressLabel(t, r)}</span>
              <span className="sub">
                {r.lines.map((x) => `${x.quantity} × ${l(x.name)}`).join(', ')}
                <br />
                <span className="num">
                  {t('requests.ref', { ref: r.ref })} · {time(r.createdAt)} · {l(r.destination.label)}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
