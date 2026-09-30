import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { Notice, Spinner } from '../../components/ui';

interface BillResponse {
  bill: { status: 'unconfigured' | 'not_authorized' | 'available'; fallback?: string; document?: { currency: string; balanceMinor: number; asOf: string; lines: { date: string; description: string; amountMinor: number }[] } };
}

function BillArea() {
  const { t, money, dateTime } = useI18n();
  const q = useQuery<BillResponse>('/api/guest/bill');
  const b = q.data?.bill;
  return (
    <section className="card" aria-labelledby="bill-h">
      <h2 id="bill-h" style={{ marginTop: 0 }}>
        {t('stay.bill')}
      </h2>
      {!b && <Spinner />}
      {b?.status === 'unconfigured' && <p>{t('stay.billFallback')}</p>}
      {b?.status === 'not_authorized' && <p>{t('stay.billNotAuthorized')}</p>}
      {b?.status === 'available' && b.document && (
        <>
          <ul className="lines">
            {b.document.lines.map((x, i) => (
              <li key={i}>
                <span>{x.description}</span>
                <span>{money(x.amountMinor, b.document!.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="total-row">
            <span>{dateTime(b.document.asOf)}</span>
            <span>{money(b.document.balanceMinor, b.document.currency)}</span>
          </div>
        </>
      )}
      <p className="muted mb0" style={{ fontSize: '0.85rem' }}>
        {t('stay.billNote')}
      </p>
    </section>
  );
}

export default function Stay() {
  const { t } = useI18n();
  const guest = useGuest();
  const [push, setPush] = useState<PushState | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    if (guest.me?.capability === 'order') pushState().then(setPush).catch(() => setPush('unsupported'));
  }, [guest.me]);

  if (guest.loading) return <Spinner />;
  if (!guest.me) {
    return (
      <>
        <h1>{t('stay.title')}</h1>
        {signedOut && <Notice kind="ok">{t('stay.signedOut')}</Notice>}
        <p>{t('stay.notActivated')}</p>
        <Notice kind="info">
          <p>{t('activate.intro')}</p>
          <Link className="btn btn-secondary btn-sm" to="/activate">
            {t('home.activateCta')}
          </Link>
        </Notice>
      </>
    );
  }
  const me = guest.me;
  return (
    <>
      <h1>{t('stay.title')}</h1>
      {me.capability === 'post_stay' ? (
        <Notice kind="info">{t('stay.postStay')}</Notice>
      ) : (
        <div className="card">
          <div className="row">
            <div>
              <div className="muted">{t('stay.room')}</div>
              <div style={{ fontFamily: 'var(--serif)', fontSize: '1.6rem', color: 'var(--navy)' }}>{me.roomLabel}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div className="muted">{t('stay.guest')}</div>
              <div>{me.guestName}</div>
            </div>
          </div>
          <p className="muted mt mb0">{t('stay.device')}</p>
        </div>
      )}
      {me.capability === 'order' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>{t('stay.notifications')}</h2>
          {push === 'available' && (
            <button className="btn-secondary" onClick={() => enablePush().then(setPush).catch(() => setPush('unsupported'))}>
              {t('stay.enablePush')}
            </button>
          )}
          {push === 'enabled' && <p className="mb0">{t('stay.pushEnabled')}</p>}
          {push === 'denied' && <p className="mb0">{t('stay.pushDenied')}</p>}
          {(push === 'unconfigured' || push === 'unsupported') && <p className="mb0">{t('stay.pushUnavailable')}</p>}
        </section>
      )}
      <BillArea />
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{t('stay.install')}</h2>
        <p className="mb0 muted">{t('stay.installHelp')}</p>
      </section>
      <button
        className="btn-danger btn-block"
        onClick={async () => {
          await guest.signOut();
          setSignedOut(true);
        }}
      >
        {t('stay.signOut')}
      </button>
    </>
  );
}
