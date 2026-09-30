import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n';
import { useQuery } from '../../lib/hooks';
import { useCart } from '../../lib/useCart';
import { addLine, cartCount, cartTotal, unitPrice } from '../../lib/cart';
import { ErrorNotice, Loading, Notice, Sheet, Stepper, Toast, useToast } from '../../components/ui';
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
              {t('food.addToOrder')} · <span className="num">{money(price * qty, item.currency)}</span>
            </button>
          </>
        ) : undefined
      }
    >
      {l(item.description) && <p className="muted">{l(item.description)}</p>}
      <p className="num">{money(item.priceMinor, item.currency)}</p>
      {!item.available && <Notice kind="plain">{t('food.unavailable')}</Notice>}
      {item.optionGroups.map((g) => {
        const radio = g.maxSelect === 1 && g.minSelect > 0;
        return (
          <fieldset key={g.id}>
            <legend>
              {l(g.name)} — {g.minSelect > 0 ? t('food.required', { count: g.minSelect }) : g.maxSelect > 1 ? t('food.upTo', { count: g.maxSelect }) : t('food.optional')}
            </legend>
            {g.options.map((o) => (
              <label className="check" key={o.id}>
                <input
                  type={radio ? 'radio' : 'checkbox'}
                  name={`g${g.id}`}
                  checked={selected.includes(o.id)}
                  disabled={!o.available}
                  onChange={() => toggle(g.id, o.id, radio)}
                />
                <span>
                  {l(o.name)}
                  {o.priceDeltaMinor > 0 && <span className="muted num"> + {money(o.priceDeltaMinor, item.currency)}</span>}
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
  const q = useQuery<{ categories: FoodCategory[]; currency: string }>('/api/guest/catalog/menu');
  const [cart, setCart] = useCart(property.id);
  const [active, setActive] = useState<number | null>(null);
  const [open, setOpen] = useState<FoodItem | null>(null);
  const toast = useToast();
  const cats = q.data?.categories ?? [];
  const current = useMemo(() => cats.find((c) => c.id === active) ?? cats[0], [cats, active]);
  const count = cartCount(cart);

  return (
    <>
      <div className="page-head">
        <span className="eyebrow">Room Service</span>
        <h1>{t('food.title')}</h1>
      </div>
      {!property.requestsEnabled && (
        <div className="pad">
          <Notice>{t('home.notAccepting')}</Notice>
        </div>
      )}
      {q.loading && !q.data && <Loading />}
      {q.error && <ErrorNotice code={q.error.code} onRetry={q.reload} />}
      {q.data && cats.length === 0 && <p className="section muted">{t('food.emptyMenu')}</p>}
      {cats.length > 0 && (
        <div className="cat-nav" role="toolbar" aria-label={t('food.title')}>
          {cats.map((c) => (
            <button key={c.id} aria-pressed={current?.id === c.id} onClick={() => setActive(c.id)}>
              {l(c.name)}
            </button>
          ))}
        </div>
      )}
      {current && (
        <ul className="list" aria-label={l(current.name)} style={{ borderTop: 0 }}>
          {current.items.map((item) => (
            <li key={item.id}>
              <button className={`row-link${item.available ? '' : ' dim'}`} onClick={() => setOpen(item)}>
                <span className="title">{l(item.name)}</span>
                <span className="aside">{money(item.priceMinor, item.currency)}</span>
                <span className="sub">{item.available ? l(item.description) : t('food.unavailable')}</span>
              </button>
            </li>
          ))}
        </ul>
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
        <div className="dock">
          <Link to="/h/food/cart">
            <span className="eyebrow" style={{ color: 'inherit' }}>
              {t('food.viewOrder')} · {t('food.itemsCount', { count })}
            </span>
            <span className="num">{money(cartTotal(cart), cart.currency)}</span>
          </Link>
        </div>
      )}
      <Toast message={toast.message} onDone={toast.clear} />
    </>
  );
}
