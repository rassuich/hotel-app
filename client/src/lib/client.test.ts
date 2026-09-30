import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { addLine, cartCount, cartTotal, emptyCart, repriceFromMenu, setQuantity, type Cart } from './cart';
import { nearestCity } from '../pages/guest/Welcome';
import type { FoodItem, PropertySummary } from '../../../shared/src/api';

function loadSwPolicy(): (pathname: string, mode: string) => string {
  const code = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(`${code}\nthis.cachePolicy = cachePolicy;`, sandbox);
  return sandbox.cachePolicy as (p: string, m: string) => string;
}

describe('service worker cache policy', () => {
  const policy = loadSwPolicy();
  it('never caches private API data', () => {
    for (const p of ['/api/guest/me', '/api/guest/requests', '/api/guest/bill', '/api/guest/stream', '/api/staff/queue', '/api/admin/stays', '/api/csrf', '/api/guest/activate'])
      expect(policy(p, 'cors')).toBe('network-only');
  });
  it('caches public information network-first and the shell for navigation', () => {
    expect(policy('/api/public/properties/palace-anfa/menu', 'cors')).toBe('network-first');
    expect(policy('/activate', 'navigate')).toBe('shell');
    expect(policy('/assets/index-abc.js', 'no-cors')).toBe('cache-first');
  });
  it('contains no background sync or request replay', () => {
    const code = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
    expect(code).not.toMatch(/sync|backgroundFetch|method !== 'GET'\) \{[^}]*fetch/);
    expect(code).toMatch(/if \(req.method !== 'GET'\) return;/);
  });
});

const tea: FoodItem = {
  id: 1, categoryId: 1, name: { fr: 'Thé', en: 'Tea' }, description: { fr: '', en: '' }, priceMinor: 4000, currency: 'MAD', available: true, isDemo: true,
  optionGroups: [{ id: 1, name: { fr: 'x', en: 'x' }, minSelect: 0, maxSelect: 2, options: [{ id: 7, name: { fr: 'Miel', en: 'Honey' }, priceDeltaMinor: 500, available: true }] }],
};

describe('cart', () => {
  it('merges identical lines, prices options, and resets the submission key on change', () => {
    let c: Cart = { ...emptyCart('palace-anfa'), submitKey: 'abc' };
    c = addLine(c, tea, [7], 1);
    expect(c.submitKey).toBeNull();
    c = addLine(c, tea, [7], 2);
    c = addLine(c, tea, [], 1);
    expect(c.lines).toHaveLength(2);
    expect(cartCount(c)).toBe(4);
    expect(cartTotal(c)).toBe(3 * 4500 + 4000);
    c = { ...c, submitKey: 'k' };
    c = setQuantity(c, c.lines[1].id, 0);
    expect(c.lines).toHaveLength(1);
    expect(c.submitKey).toBeNull();
  });
  it('reprices from the current menu and drops unavailable items when changes are accepted', () => {
    let c = addLine(emptyCart('p'), tea, [], 2);
    c = repriceFromMenu(c, [{ ...tea, priceMinor: 5000 }]);
    expect(cartTotal(c)).toBe(10000);
    expect(repriceFromMenu(c, [{ ...tea, available: false }]).lines).toEqual([]);
  });
});

describe('find my hotel', () => {
  const p = (id: string, city: 'casablanca' | 'marrakech', lat: number, lng: number) => ({ id, city, approxLocation: { lat, lng } }) as PropertySummary;
  const props = [p('palace-anfa', 'casablanca', 33.57, -7.59), p('palm-plaza', 'marrakech', 31.63, -7.98)];
  it('suggests the nearest city within range, or nothing', () => {
    expect(nearestCity(props, { lat: 33.59, lng: -7.62 })).toBe('casablanca');
    expect(nearestCity(props, { lat: 31.6, lng: -8.0 })).toBe('marrakech');
    expect(nearestCity(props, { lat: 48.85, lng: 2.35 })).toBeNull();
  });
});
