import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { ApiError, get, newKey, post } from '../../lib/api';
import { useQuery } from '../../lib/hooks';
import { useOnline } from '../../lib/live';
import { useGuest } from '../../lib/guest';
import { useCart } from '../../lib/useCart';
import { cartTotal, repriceFromMenu, setQuantity, type Cart as CartT } from '../../lib/cart';
import { ErrorNotice, Notice, Stepper } from '../../components/ui';
import { useProperty } from './GuestShell';
import type { DeliveryLocation, FoodCategory, GuestRequestDto, QuoteLineIssue } from '../../../../shared/src/api';

export default function Cart() {
  const { t, l, money } = useI18n();
  const property = useProperty();
  const { me } = useGuest();
  const online = useOnline();
  const nav = useNavigate();
  const [cart, setCart] = useCart(property.id);
  const locations = useQuery<{ locations: DeliveryLocation[] }>('/api/guest/catalog/locations');
  const [dest, setDest] = useState<'room' | 'pool'>('room');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [notes, setNotes] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<QuoteLineIssue[] | null>(null);

  const total = cartTotal(cart);
  const canSend = !!me?.canOrder && online && cart.lines.length > 0 && (dest === 'room' || locationId !== '') && !sending && !issues;

  const submit = async () => {
    setError(null);
    // Reuse the same key if a previous attempt's response was lost, so it cannot duplicate.
    const key = cart.submitKey ?? newKey();
    if (!cart.submitKey) setCart((c) => ({ ...c, submitKey: key }));
    setSending(true);
    try {
      const r = await post<{ request: GuestRequestDto }>('/api/guest/requests/food', {
        idempotencyKey: key,
        lines: cart.lines.map((line) => ({ itemId: line.itemId, quantity: line.quantity, optionIds: line.optionIds, expectedUnitPriceMinor: line.unitPriceMinor })),
        destination: dest === 'room' ? { kind: 'room' } : { kind: 'pool', locationId: Number(locationId) },
        notes: notes.trim() || null,
        expectedTotalMinor: total,
      });
      setCart((c: CartT) => ({ ...c, lines: [], submitKey: null }));
      nav(`/h/requests/${r.request.ref}`, { replace: true, state: { justSent: true } });
    } catch (e) {
      const err = e as ApiError;
      if (err.code === 'quote_changed') {
        setIssues(err.details?.issues ?? []);
        setCart((c) => ({ ...c, submitKey: null }));
      } else if (err.status >= 400 && err.status < 500) {
        setCart((c) => ({ ...c, submitKey: null }));
        setError(err.code);
      } else {
        setError(err.code); // network/server: keep the key so a retry is idempotent
      }
    } finally {
      setSending(false);
    }
  };

  const acceptChanges = async () => {
    const menu = await get<{ categories: FoodCategory[] }>('/api/guest/catalog/menu');
    setCart((c) => repriceFromMenu(c, menu.categories.flatMap((cat) => cat.items)));
    setIssues(null);
  };

  if (cart.lines.length === 0) {
    return (
      <>
        <div className="page-head">
          <h1>{t('cart.title')}</h1>
          <p>{t('cart.empty')}</p>
        </div>
        <div className="section">
          <Link className="btn btn-primary" to="/h/food">
            {t('cart.browseMenu')}
          </Link>
        </div>
      </>
    );
  }

  const issueText = (i: QuoteLineIssue) => {
    const line = cart.lines[i.index];
    const item = line ? l(line.name) : '';
    const price = i.currentUnitPriceMinor !== undefined ? money(i.currentUnitPriceMinor, cart.currency) : '';
    return t(`cart.issue_${i.issue}`, { item, price, count: i.maxQuantity ?? '' });
  };

  const pools = locations.data?.locations ?? [];
  return (
    <>
      <div className="page-head">
        <Link to="/h/food" className="btn-text">
          ← {t('app.back')}
        </Link>
        <h1>{t('cart.title')}</h1>
        <p>{t('cart.keptLocally')}</p>
      </div>
      <div className="section">
        <ul className="lines">
          {cart.lines.map((line) => (
            <li key={line.id}>
              <div>
                <div>{l(line.name)}</div>
                {line.optionNames.length > 0 && <div className="opt">{line.optionNames.map(l).join(', ')}</div>}
                <div className="opt num">{money(line.unitPriceMinor, cart.currency)}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Stepper value={line.quantity} min={0} max={20} onChange={(v) => setCart((c) => setQuantity(c, line.id, v))} label={`${t('food.quantity')} ${l(line.name)}`} />
                <div>
                  <button className="btn-text" onClick={() => setCart((c) => setQuantity(c, line.id, 0))}>
                    {t('cart.remove')}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <div className="total-row">
          <span>{t('cart.total')}</span>
          <span className="num">{money(total, cart.currency)}</span>
        </div>
        <p className="muted" style={{ fontSize: '0.8rem', marginTop: 8 }}>
          {t('cart.notYourBill')}
        </p>
      </div>

      {issues && (
        <div className="pad">
          <Notice kind="bad" role="alert">
            <p>{t('cart.quoteChanged')}</p>
            <ul>
              {issues.filter((i) => i.index >= 0).map((i) => (
                <li key={`${i.index}-${i.issue}`}>{issueText(i)}</li>
              ))}
            </ul>
            <button className="btn-primary btn-sm" onClick={acceptChanges}>
              {t('cart.acceptChanges')}
            </button>
          </Notice>
        </div>
      )}

      <div className="section">
        <fieldset>
          <legend>{t('cart.destination')}</legend>
          <label className="check">
            <input type="radio" name="dest" checked={dest === 'room'} onChange={() => setDest('room')} />
            <span>{me?.roomLabel ? t('cart.roomLabel', { room: me.roomLabel }) : t('cart.room')}</span>
          </label>
          <label className="check">
            <input type="radio" name="dest" checked={dest === 'pool'} onChange={() => setDest('pool')} disabled={pools.length === 0} />
            <span>{t('cart.pool')}</span>
          </label>
          {dest === 'pool' && (
            <div className="field">
              <label htmlFor="loc">{t('cart.chooseLocation')}</label>
              <select id="loc" value={locationId} onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}>
                <option value="">—</option>
                {pools.map((p) => (
                  <option key={p.id} value={p.id}>
                    {l(p.label)}
                  </option>
                ))}
              </select>
            </div>
          )}
          {pools.length === 0 && locations.data && <p className="muted">{t('cart.noPoolLocations')}</p>}
        </fieldset>

        <div className="field">
          <label htmlFor="notes">{t('cart.notes')}</label>
          <textarea id="notes" maxLength={500} value={notes} placeholder={t('cart.notesPlaceholder')} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <Notice>{dest === 'pool' ? t('cart.confirmationInPerson') : t('cart.confirmationRequired')}</Notice>
        {!online && <Notice kind="bad">{t('cart.offlineKept')}</Notice>}
        {me && !me.canOrder && <ErrorNotice code={me.orderingBlockedReason ?? undefined} />}
        {error && <ErrorNotice code={error} />}
        <button className="btn-primary btn-block" onClick={submit} disabled={!canSend}>
          {sending ? t('cart.sending') : `${t('cart.submit')} · ${money(total, cart.currency)}`}
        </button>
      </div>
    </>
  );
}
