import { useCallback, useSyncExternalStore } from 'react';
import { loadCart, saveCart, type Cart } from './cart';

const listeners = new Set<() => void>();
const cache = new Map<string, Cart>();

function read(propertyId: string): Cart {
  if (!cache.has(propertyId)) cache.set(propertyId, loadCart(propertyId));
  return cache.get(propertyId)!;
}

/** Cart shared by the menu and review screens, persisted on this device only. */
export function useCart(propertyId: string): [Cart, (update: (c: Cart) => Cart) => void] {
  const cart = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => read(propertyId),
  );
  const update = useCallback(
    (fn: (c: Cart) => Cart) => {
      const next = fn(read(propertyId));
      cache.set(propertyId, next);
      saveCart(next);
      listeners.forEach((l) => l());
    },
    [propertyId],
  );
  return [cart, update];
}
