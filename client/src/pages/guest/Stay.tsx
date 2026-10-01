import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useGuest } from '../../lib/guest';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { Loading, Notice } from '../../components/ui';

interface BillResponse {
  bill: { status: 'unconfigured' | 'not_authorized' | 'available'; fallback?: string; document?: { currency: string; balanceMinor: number; asOf: string; lines: { date: string; description: string; amountMinor: number }[] } };
}

function BillArea() {
  const { t, money, dateTime } = useI18n();
  const q = useQuery<BillResponse>('/api/guest/bill');
  const b = q.data?.bill;
  return (
    <section className="section" aria-labelledby="bill-h">
      <h2 id="bill-h" className="eyebrow">
        {t('stay.bill')}
      </h2>
      {!b && <Loading />}
      {b?.status === 'unconfigured' && <p>{t('stay.billFallback')}</p>}
      {b?.status === 'not_authorized' && <p>{t('stay.billNotAuthorized')}</p>}
      {b?.status === 'available' && b.document && (
        <>
          <ul className="lines">
            {b.document.lines.map((x, i) => (
              <li key={i}>
                <span>{x.description}</span>
                <span className="num">{money(x.amountMinor, b.document!.currency)}</span>
              </li>
            ))}
          </ul>
          <div className="total-row">
            <span>{dateTime(b.document.asOf)}</span>
            <span className="num">{money(b.document.balanceMinor, b.document.currency)}</span>
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

  useEffect(() => {
    if (guest.me?.capability === 'order') pushState().then(setPush).catch(() => setPush('unsupported'));
  }, [guest.me]);

  const me = guest.me;
  if (!me) return <Loading />;
  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{me.property.name}</span>
        <h1>{t('stay.title')}</h1>
      </div>
      {me.capability === 'post_stay' ? (
        <div className="pad">
          <Notice>{t('stay.postStay')}</Notice>
        </div>
      ) : (
        <section className="section">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <div>
              <span className="label">{t('stay.room')}</span>
              <div style={{ fontSize: '2rem', fontWeight: 700 }}>{me.roomLabel}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span className="label">{t('stay.guest')}</span>
              <div>{me.guestName}</div>
            </div>
          </div>
          <p className="muted mt mb0">{t('stay.device')}</p>
        </section>
      )}
      {me.capability === 'order' && (
        <section className="section">
          <h2 className="eyebrow">{t('stay.notifications')}</h2>
          {push === 'available' && (
            <button className="btn-secondary" onClick={() => enablePush().then(setPush).catch(() => setPush('unsupported'))}>
              {t('stay.enablePush')}
            </button>
          )}
          {push === 'enabled' && <p className="mb0">{t('stay.pushEnabled')}</p>}
          {push === 'denied' && <p className="mb0">{t('stay.pushDenied')}</p>}
          {(push === 'unconfigured' || push === 'unsupported') && <p className="mb0 muted">{t('stay.pushUnavailable')}</p>}
        </section>
      )}
      <BillArea />
      {me.capability === 'order' && (
        <section className="section">
          <h2 className="eyebrow">{t('stay.install')}</h2>
          <p className="mb0 muted">{t('stay.installHelp')}</p>
        </section>
      )}
      <div className="section">
        <button className="btn-danger btn-block" onClick={() => void guest.signOut()}>
          {t('stay.signOut')}
        </button>
      </div>
    </>
  );
}
