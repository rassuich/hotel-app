import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useCart } from '../../lib/useCart';
import { addLine, cartCount, cartTotal, unitPrice } from '../../lib/cart';
import { ErrorNotice, Notice, Sheet, Spinner, Stepper, useToast, Toast } from '../../components/ui';
import { useProperty } from './GuestShell';
import type { FoodCategory, FoodItem } from '../../../../shared/src/api';

function ItemSheet({ item, onClose, onAdd, canOrder }: { item: FoodItem; onClose: () => void; onAdd: (ids: number[], qty: number) => void; canOrder: boolean }) {
  const { t, l, money } = useI18n();
  const [selected, setSelected] = useState<number[]>(() =>
    item.optionGroups.flatMap((g) => (g.minSelect > 0 ? g.options.filter((o) => o.available).slice(0, g.minSelect).map((o) => o.id) : [])),
  );
  const [qty, setQty] = useState(1);
  const valid = item.optionGroups.every((g) => {
    const n = g.options.filter((o) => selected.includes(o.id)).length;
    return n >= g.minSelect && n <= g.maxSelect;
  });
  const toggle = (groupId: number, optionId: number, single: boolean) => {
    const group = item.optionGroups.find((g) => g.id === groupId)!;
    const inGroup = group.options.map((o) => o.id);
    setSelected((cur) => {
      if (single) return [...cur.filter((id) => !inGroup.includes(id)), optionId];
      if (cur.includes(optionId)) return cur.filter((id) => id !== optionId);
      const count = cur.filter((id) => inGroup.includes(id)).length;
      return count >= group.maxSelect ? cur : [...cur, optionId];
    });
  };
  const price = unitPrice(item, selected);
  return (
    <Sheet
      open
      onClose={onClose}
      title={l(item.name)}
      footer={
        canOrder && item.available ? (
          <>
            <Stepper value={qty} max={20} onChange={setQty} label={t('food.quantity')} />
            <button className="btn-primary" style={{ flex: 1 }} disabled={!valid} onClick={() => onAdd(selected, qty)}>
              {t('food.addToOrder')} · {money(price * qty, item.currency)}
            </button>
          </>
        ) : undefined
      }
    >
      {l(item.description) && <p className="muted">{l(item.description)}</p>}
      <p>
        <strong>{money(item.priceMinor, item.currency)}</strong>
      </p>
      {!item.available && <Notice kind="warn">{t('food.unavailable')}</Notice>}
      {item.optionGroups.map((g) => {
        const single = g.maxSelect === 1;
        return (
          <fieldset key={g.id}>
            <legend>
              {l(g.name)}{' '}
              <span className="muted" style={{ fontWeight: 400 }}>
                ({g.minSelect > 0 ? t('food.required', { count: g.minSelect }) : g.maxSelect > 1 ? t('food.upTo', { count: g.maxSelect }) : t('food.optional')})
              </span>
            </legend>
            {g.options.map((o) => (
              <label className="check" key={o.id}>
                <input
                  type={single && g.minSelect > 0 ? 'radio' : 'checkbox'}
                  name={`g${g.id}`}
                  checked={selected.includes(o.id)}
                  disabled={!o.available}
                  onChange={() => (single && g.minSelect > 0 ? toggle(g.id, o.id, true) : toggle(g.id, o.id, false))}
                />
                <span>
                  {l(o.name)}
                  {o.priceDeltaMinor > 0 && <span className="muted"> + {money(o.priceDeltaMinor, item.currency)}</span>}
                  {!o.available && <span className="muted"> — {t('food.optionUnavailable')}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        );
      })}
    </Sheet>
  );
}

export default function Food() {
  const { t, l, money } = useI18n();
  const property = useProperty();
  const q = useQuery<{ categories: FoodCategory[]; currency: string }>(`/api/public/properties/${property.id}/menu`);
  const [cart, setCart] = useCart(property.id);
  const [active, setActive] = useState<number | null>(null);
  const [open, setOpen] = useState<FoodItem | null>(null);
  const toast = useToast();
  const cats = q.data?.categories ?? [];
  const current = useMemo(() => cats.find((c) => c.id === active) ?? cats[0], [cats, active]);
  const count = cartCount(cart);

  return (
    <>
      <h1>{t('food.title')}</h1>
      {!property.requestsEnabled && <Notice kind="info">{t('home.notAccepting')}</Notice>}
      {q.loading && <Spinner />}
      {q.error && <ErrorNotice code={q.error.code} onRetry={q.reload} />}
      {q.data && cats.length === 0 && <p className="muted">{t('food.emptyMenu')}</p>}
      {cats.length > 0 && (
        <div className="chips" role="toolbar" aria-label={t('food.title')}>
          {cats.map((c) => (
            <button key={c.id} aria-pressed={current?.id === c.id} onClick={() => setActive(c.id)}>
              {l(c.name)}
            </button>
          ))}
        </div>
      )}
      {current && (
        <section aria-label={l(current.name)}>
          {current.items.map((item) => (
            <button key={item.id} className={`menu-item${item.available ? '' : ' unavailable'}`} onClick={() => setOpen(item)}>
              <span>
                <span className="name">{l(item.name)}</span>
                <br />
                <span className="desc">{item.available ? l(item.description) : t('food.unavailable')}</span>
              </span>
              <span className="price">{money(item.priceMinor, item.currency)}</span>
            </button>
          ))}
        </section>
      )}
      {open && (
        <ItemSheet
          item={open}
          canOrder={property.requestsEnabled}
          onClose={() => setOpen(null)}
          onAdd={(ids, qty) => {
            setCart((c) => addLine(c, open, ids, qty));
            setOpen(null);
            toast.show(t('food.added'));
          }}
        />
      )}
      {count > 0 && property.requestsEnabled && (
        <div className="cartbar">
          <Link to="/h/food/cart" className="btn btn-primary">
            <span>
              {t('food.viewOrder')} · {t('food.itemsCount', { count })}
            </span>
            <strong>{money(cartTotal(cart), cart.currency)}</strong>
          </Link>
        </div>
      )}
      <Toast message={toast.message} onDone={toast.clear} />
    </>
  );
}
