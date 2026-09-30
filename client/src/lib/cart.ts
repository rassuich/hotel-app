/**
 * Food cart kept on this device (per property). It is NEVER submitted
 * automatically — not on reconnect, not on reload. Only an explicit tap sends it.
 */
import type { FoodItem, Localized } from '../../../shared/src/api';

export interface CartLine {
  /** Stable id for this line (item + options). */
  id: string;
  itemId: number;
  name: Localized;
  optionIds: number[];
  optionNames: Localized[];
  unitPriceMinor: number;
  quantity: number;
}

export interface Cart {
  propertyId: string;
  currency: string;
  lines: CartLine[];
  /** Idempotency key for the submission in flight; reset whenever the cart changes. */
  submitKey: string | null;
}

const key = (propertyId: string) => `pa.cart.${propertyId}`;

export function emptyCart(propertyId: string, currency = 'MAD'): Cart {
  return { propertyId, currency, lines: [], submitKey: null };
}

export function loadCart(propertyId: string): Cart {
  try {
    const raw = localStorage.getItem(key(propertyId));
    if (raw) {
      const c = JSON.parse(raw) as Cart;
      if (c && Array.isArray(c.lines)) return c;
    }
  } catch {
    /* ignore */
  }
  return emptyCart(propertyId);
}

export function saveCart(cart: Cart) {
  try {
    if (cart.lines.length === 0) localStorage.removeItem(key(cart.propertyId));
    else localStorage.setItem(key(cart.propertyId), JSON.stringify(cart));
  } catch {
    /* ignore */
  }
}

export function lineId(itemId: number, optionIds: number[]): string {
  return `${itemId}:${[...optionIds].sort((a, b) => a - b).join(',')}`;
}

export function unitPrice(item: FoodItem, optionIds: number[]): number {
  const deltas = item.optionGroups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id));
  return item.priceMinor + deltas.reduce((s, o) => s + o.priceDeltaMinor, 0);
}

export function addLine(cart: Cart, item: FoodItem, optionIds: number[], quantity: number): Cart {
  const id = lineId(item.id, optionIds);
  const existing = cart.lines.find((l) => l.id === id);
  const optionNames = item.optionGroups.flatMap((g) => g.options).filter((o) => optionIds.includes(o.id)).map((o) => o.name);
  const lines = existing
    ? cart.lines.map((l) => (l.id === id ? { ...l, quantity: Math.min(20, l.quantity + quantity) } : l))
    : [...cart.lines, { id, itemId: item.id, name: item.name, optionIds, optionNames, unitPriceMinor: unitPrice(item, optionIds), quantity }];
  return { ...cart, currency: item.currency, lines, submitKey: null };
}

export function setQuantity(cart: Cart, id: string, quantity: number): Cart {
  const lines = quantity <= 0 ? cart.lines.filter((l) => l.id !== id) : cart.lines.map((l) => (l.id === id ? { ...l, quantity: Math.min(20, quantity) } : l));
  return { ...cart, lines, submitKey: null };
}

export function cartTotal(cart: Cart): number {
  return cart.lines.reduce((s, l) => s + l.unitPriceMinor * l.quantity, 0);
}

export function cartCount(cart: Cart): number {
  return cart.lines.reduce((s, l) => s + l.quantity, 0);
}

/** Re-prices the cart from the current menu after the guest accepts changes. */
export function repriceFromMenu(cart: Cart, items: FoodItem[]): Cart {
  const byId = new Map(items.map((i) => [i.id, i]));
  const lines = cart.lines
    .filter((l) => byId.get(l.itemId)?.available)
    .map((l) => ({ ...l, unitPriceMinor: unitPrice(byId.get(l.itemId)!, l.optionIds) }));
  return { ...cart, lines, submitKey: null };
}
