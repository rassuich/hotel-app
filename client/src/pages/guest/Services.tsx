import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, newKey, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { useOnline } from '../../lib/live';
import { useGuest } from '../../lib/guest';
import { ErrorNotice, Notice, Sheet, Spinner, Stepper } from '../../components/ui';
import { useProperty } from './GuestShell';
import type { DeliveryLocation, GuestRequestDto, ServiceItem } from '../../../../shared/src/api';

function ServiceSheet({ item, onClose, onSent }: { item: ServiceItem; onClose: () => void; onSent: (ref: string) => void }) {
  const { t, l, money } = useI18n();
  const property = useProperty();
  const { me } = useGuest();
  const online = useOnline();
  const locations = useQuery<{ locations: DeliveryLocation[] }>(`/api/public/properties/${property.id}/locations`);
  const [qty, setQty] = useState(1);
  const [details, setDetails] = useState('');
  const [dest, setDest] = useState<'room' | 'pool'>('room');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [key] = useState(newKey); // one key per sheet: retries after a lost response cannot duplicate
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const send = async () => {
    setSending(true);
    setError(null);
    try {
      const r = await post<{ request: GuestRequestDto }>('/api/guest/requests/service', {
        idempotencyKey: key,
        line: {
          itemId: item.id,
          quantity: qty,
          details: details.trim() || null,
          expectedComplimentary: item.complimentary,
          expectedUnitPriceMinor: item.complimentary ? 0 : item.priceMinor,
        },
        destination: dest === 'room' ? { kind: 'room' } : { kind: 'pool', locationId: Number(locationId) },
      });
      onSent(r.request.ref);
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setSending(false);
    }
  };

  const pools = locations.data?.locations ?? [];
  const canSend = !!me?.canOrder && online && !sending && (dest === 'room' || locationId !== '');
  return (
    <Sheet
      open
      onClose={onClose}
      title={l(item.name)}
      footer={
        <button className="btn-primary btn-block" onClick={send} disabled={!canSend}>
          {sending ? t('cart.sending') : t('services.send')}
        </button>
      }
    >
      {l(item.description) && <p className="muted">{l(item.description)}</p>}
      <p>
        <span className={`pill ${item.complimentary ? 'pill-ok' : 'pill-warn'}`}>
          {item.complimentary ? t('services.complimentary') : t('services.fee', { price: money(item.priceMinor, item.currency) })}
        </span>
      </p>
      <div className="field">
        <label>{t('food.quantity')}</label>
        <Stepper value={qty} max={item.maxQuantity} onChange={setQty} label={t('food.quantity')} />
        <div className="help">{t('services.maxQuantity', { count: item.maxQuantity })}</div>
      </div>
      {item.allowDetails && (
        <div className="field">
          <label htmlFor="details">{t('services.details')}</label>
          <input id="details" maxLength={300} value={details} placeholder={t('services.detailsPlaceholder')} onChange={(e) => setDetails(e.target.value)} />
        </div>
      )}
      <fieldset>
        <legend>{t('cart.destination')}</legend>
        <label className="check">
          <input type="radio" name="sdest" checked={dest === 'room'} onChange={() => setDest('room')} />
          <span>{me?.roomLabel ? t('cart.roomLabel', { room: me.roomLabel }) : t('cart.room')}</span>
        </label>
        {pools.length > 0 && (
          <label className="check">
            <input type="radio" name="sdest" checked={dest === 'pool'} onChange={() => setDest('pool')} />
            <span>{t('cart.pool')}</span>
          </label>
        )}
        {dest === 'pool' && (
          <select aria-label={t('cart.chooseLocation')} value={locationId} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">{t('cart.chooseLocation')}</option>
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {l(p.label)}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      {!item.complimentary && <Notice kind="warn">{t('services.feeNotice', { price: money(item.priceMinor * qty, item.currency) })}</Notice>}
      {!online && <Notice kind="warn">{t('app.offline')}</Notice>}
      {!me && (
        <Notice kind="warn">
          <p>{t('cart.needsActivation')}</p>
          <Link to="/activate" className="btn btn-secondary btn-sm">
            {t('home.activateCta')}
          </Link>
        </Notice>
      )}
      {me && !me.canOrder && <ErrorNotice code={me.orderingBlockedReason ?? undefined} />}
      {error && (
        <ErrorNotice
          code={error.code === 'quote_changed' ? (error.details?.issues?.[0]?.issue === 'became_chargeable' ? 'quote_changed' : error.code) : error.code}
        />
      )}
    </Sheet>
  );
}

export default function Services() {
  const { t, l, money } = useI18n();
  const property = useProperty();
  const q = useQuery<{ services: ServiceItem[] }>(`/api/public/properties/${property.id}/services`);
  const [open, setOpen] = useState<ServiceItem | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const items = q.data?.services ?? [];
  return (
    <>
      <h1>{t('services.title')}</h1>
      <p className="muted">{t('services.subtitle')}</p>
      {!property.requestsEnabled && <Notice kind="info">{t('home.notAccepting')}</Notice>}
      {sent && (
        <Notice kind="ok" role="status">
          <p className="mb0">{t('services.sent')}</p>
          <Link to={`/h/requests/${sent}`}>{t('services.viewRequest')} ({sent})</Link>
        </Notice>
      )}
      {q.loading && <Spinner />}
      {q.error && <ErrorNotice code={q.error.code} onRetry={q.reload} />}
      {q.data && items.length === 0 && <p className="muted">{t('services.empty')}</p>}
      {items.map((s) => (
        <button key={s.id} className={`menu-item${s.available ? '' : ' unavailable'}`} disabled={!s.available || !property.requestsEnabled} onClick={() => setOpen(s)}>
          <span>
            <span className="name">{l(s.name)}</span>
            <br />
            <span className="desc">{s.available ? l(s.description) : t('food.unavailable')}</span>
          </span>
          <span className={`pill ${s.complimentary ? 'pill-ok' : 'pill-warn'}`}>{s.complimentary ? t('services.complimentary') : money(s.priceMinor, s.currency)}</span>
        </button>
      ))}
      {open && (
        <ServiceSheet
          item={open}
          onClose={() => setOpen(null)}
          onSent={(ref) => {
            setOpen(null);
            setSent(ref);
          }}
        />
      )}
    </>
  );
}
