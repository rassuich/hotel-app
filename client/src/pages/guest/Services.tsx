import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, get, newKey, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { useOnline } from '../../lib/live';
import { useGuest } from '../../lib/guest';
import { ErrorNotice, Loading, Notice, Sheet, Stepper } from '../../components/ui';
import { useProperty } from './GuestShell';
import type { DeliveryLocation, GuestRequestDto, QuoteLineIssue, ServiceItem } from '../../../../shared/src/api';

interface Pick {
  quantity: number;
  details: string;
}

/**
 * Services work like a checklist: tick everything needed, adjust quantities,
 * then send ONE request to Reception. Simple requests need no confirmation call.
 */
export default function Services() {
  const { t, l, money } = useI18n();
  const property = useProperty();
  const { me } = useGuest();
  const online = useOnline();
  const nav = useNavigate();
  const q = useQuery<{ services: ServiceItem[] }>('/api/guest/catalog/services');
  const locations = useQuery<{ locations: DeliveryLocation[] }>('/api/guest/catalog/locations');
  const [picked, setPicked] = useState<Record<number, Pick>>({});
  const [reviewing, setReviewing] = useState(false);
  const [dest, setDest] = useState<'room' | 'pool'>('room');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  // One key per reviewed order: a retry after a lost response cannot create a second request.
  const [submitKey, setSubmitKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  // Set when the server reports that prices/availability changed: sending stays blocked until
  // the guest explicitly accepts the updated request. Names come from what was actually sent.
  const [changed, setChanged] = useState<{ issues: QuoteLineIssue[]; sent: { itemId: number; name: ServiceItem['name'] }[] } | null>(null);
  const [removed, setRemoved] = useState<string[]>([]);

  const items = q.data?.services ?? [];
  const selected = useMemo(() => items.filter((s) => picked[s.id]), [items, picked]);
  const count = selected.reduce((n, s) => n + picked[s.id].quantity, 0);
  const fees = selected.reduce((sum, s) => sum + (s.complimentary ? 0 : s.priceMinor * picked[s.id].quantity), 0);
  const currency = items[0]?.currency ?? property.currency;
  const pools = locations.data?.locations ?? [];

  const change = (fn: (p: Record<number, Pick>) => Record<number, Pick>) => {
    setPicked(fn);
    setSubmitKey(null);
    setError(null);
    setRemoved([]);
  };
  const MAX_LINES = 30;
  const toggle = (s: ServiceItem) =>
    change((p) => {
      const next = { ...p };
      if (next[s.id]) delete next[s.id];
      else next[s.id] = { quantity: 1, details: '' };
      return next;
    });
  const update = (id: number, patch: Partial<Pick>) => change((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  const send = async () => {
    const key = submitKey ?? newKey();
    setSubmitKey(key);
    setSending(true);
    setError(null);
    const sent = selected.map((s) => ({ itemId: s.id, name: s.name }));
    try {
      const r = await post<{ request: GuestRequestDto }>('/api/guest/requests/service', {
        idempotencyKey: key,
        lines: selected.map((s) => ({
          itemId: s.id,
          quantity: picked[s.id].quantity,
          details: s.allowDetails ? picked[s.id].details.trim() || null : null,
          expectedComplimentary: s.complimentary,
          expectedUnitPriceMinor: s.complimentary ? 0 : s.priceMinor,
        })),
        destination: dest === 'room' ? { kind: 'room' } : { kind: 'pool', locationId: Number(locationId) },
        notes: notes.trim() || null,
      });
      setPicked({});
      setNotes('');
      setSubmitKey(null);
      setReviewing(false);
      nav(`/h/requests/${r.request.ref}`, { state: { justSent: true } });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'quote_changed') {
        setChanged({ issues: err.details?.issues ?? [], sent });
      } else {
        setError(err);
      }
      if (err.status >= 400 && err.status < 500) setSubmitKey(null);
    } finally {
      setSending(false);
    }
  };

  const issueText = (i: QuoteLineIssue) => {
    const line = changed?.sent[i.index];
    const price = i.currentUnitPriceMinor !== undefined ? money(i.currentUnitPriceMinor, currency) : '';
    return t(`cart.issue_${i.issue}`, { item: line ? l(line.name) : '', price, count: i.maxQuantity ?? '' });
  };

  /** Applies the current catalogue: drops unavailable/removed items, clamps quantities, shows new prices. */
  const acceptChanges = async () => {
    try {
      const fresh = (await get<{ services: ServiceItem[] }>('/api/guest/catalog/services')).services;
      const byId = new Map(fresh.map((s) => [s.id, s]));
      const gone: string[] = [];
      const next: Record<number, Pick> = {};
      for (const [id, p] of Object.entries(picked)) {
        const s = byId.get(Number(id));
        const old = items.find((x) => x.id === Number(id));
        if (!s || !s.available) {
          gone.push(l((s ?? old)?.name));
          continue;
        }
        next[s.id] = { ...p, quantity: Math.min(p.quantity, s.maxQuantity) };
      }
      await q.reload();
      setPicked(next);
      setRemoved(gone);
      setChanged(null);
      setSubmitKey(null);
    } catch (e) {
      setError(e as ApiError);
    }
  };

  const canSend = !!me?.canOrder && online && selected.length > 0 && (dest === 'room' || locationId !== '') && !sending && !changed;

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">{t('services.eyebrow')}</span>
        <h1>{t('services.title')}</h1>
        <p>{t('services.selectHelp')}</p>
      </div>
      {!property.requestsEnabled && (
        <div className="pad">
          <Notice>{t('home.notAccepting')}</Notice>
        </div>
      )}
      {q.loading && !q.data && <Loading />}
      {q.error && <ErrorNotice code={q.error.code} onRetry={q.reload} />}
      {q.data && items.length === 0 && <p className="section muted">{t('services.empty')}</p>}
      <ul className="list" style={{ borderTop: 0 }}>
        {items.map((s) => {
          const p = picked[s.id];
          const full = selected.length >= MAX_LINES;
          const disabled = !s.available || !property.requestsEnabled || full;
          return (
            <li key={s.id} className={`svc${s.available ? '' : ' unavailable'}`}>
              <input
                type="checkbox"
                id={`svc-${s.id}`}
                checked={!!p}
                disabled={disabled && !p}
                aria-describedby={`svc-${s.id}-price svc-${s.id}-desc`}
                onChange={() => toggle(s)}
              />
              <label htmlFor={`svc-${s.id}`} className="title" style={{ margin: 0, letterSpacing: 0, textTransform: 'none', color: 'inherit', fontWeight: 400, minHeight: 44 }}>
                {l(s.name)}
              </label>
              <span className="tag num" id={`svc-${s.id}-price`}>
                {s.complimentary ? t('services.complimentary') : money(s.priceMinor, s.currency)}
              </span>
              {(l(s.description) || !s.available) && (
                <span className="muted" id={`svc-${s.id}-desc`} style={{ gridColumn: '2 / -1', fontSize: '0.88rem' }}>
                  {s.available ? l(s.description) : t('food.unavailable')}
                </span>
              )}
              {p && (
                <div className="more">
                  {(s.maxQuantity > 1 || p.quantity > 1) && (
                    <div>
                      <span className="label">{t('food.quantity')}</span>
                      <Stepper value={p.quantity} max={Math.max(s.maxQuantity, 1)} onChange={(v) => update(s.id, { quantity: Math.min(v, s.maxQuantity) })} label={`${t('food.quantity')} ${l(s.name)}`} />
                      {p.quantity > s.maxQuantity && <div className="help">{t('cart.issue_quantity_limit', { item: l(s.name), count: s.maxQuantity })}</div>}
                    </div>
                  )}
                  {s.allowDetails && (
                    <div className="field">
                      <label htmlFor={`d-${s.id}`}>
                        {t('services.details')}
                        <span className="visually-hidden"> — {l(s.name)}</span>
                      </label>
                      <input id={`d-${s.id}`} maxLength={300} value={p.details} placeholder={t('services.detailsPlaceholder')} onChange={(e) => update(s.id, { details: e.target.value })} />
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {selected.length >= MAX_LINES && (
        <div className="pad">
          <Notice kind="plain">{t('services.maxLines', { count: MAX_LINES })}</Notice>
        </div>
      )}
      {selected.length > 0 && (
        <div className="dock">
          <button type="button" onClick={() => setReviewing(true)}>
            <span className="eyebrow" style={{ color: 'inherit' }}>
              {t('services.review')} · {t('services.selectedCount', { count })}
            </span>
            <span className="num">{fees > 0 ? money(fees, currency) : t('services.complimentary')}</span>
          </button>
        </div>
      )}

      <Sheet
        open={reviewing}
        onClose={() => setReviewing(false)}
        title={t('services.summaryTitle')}
        footer={
          <button className="btn-primary btn-block" onClick={send} disabled={!canSend}>
            {sending ? t('cart.sending') : t('services.send')}
          </button>
        }
      >
        <ul className="lines">
          {selected.map((s) => (
            <li key={s.id}>
              <div>
                {picked[s.id].quantity} × {l(s.name)}
                {s.allowDetails && picked[s.id].details.trim() && <div className="opt">{picked[s.id].details.trim()}</div>}
              </div>
              <div className="num">{s.complimentary ? t('services.complimentary') : money(s.priceMinor * picked[s.id].quantity, s.currency)}</div>
            </li>
          ))}
        </ul>
        {fees > 0 && <Notice>{t('services.feeNotice', { price: money(fees, currency) })}</Notice>}
        <fieldset className="mt">
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
        <div className="field">
          <label htmlFor="snotes">{t('services.notes')}</label>
          <textarea id="snotes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          {t('services.subtitle')}
        </p>
        {!online && <Notice kind="bad">{t('app.offline')}</Notice>}
        {me && !me.canOrder && <ErrorNotice code={me.orderingBlockedReason ?? undefined} />}
        {removed.length > 0 && <Notice kind="plain">{t('services.removed', { items: removed.join(', ') })}</Notice>}
        {changed && (
          <Notice kind="bad" role="alert">
            <p>{t('cart.quoteChanged')}</p>
            <ul>
              {changed.issues.map((i) => (
                <li key={`${i.index}-${i.issue}`}>{issueText(i)}</li>
              ))}
            </ul>
            <button type="button" className="btn-primary btn-sm" onClick={() => void acceptChanges()}>
              {t('services.acceptChanges')}
            </button>
          </Notice>
        )}
        {error && <ErrorNotice code={error.code} />}
      </Sheet>
    </>
  );
}
