import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { addLine, cartCount, cartTotal, emptyCart, repriceFromMenu, setQuantity, type Cart } from './cart';
import { parseScanned } from './scan';
import { pick } from '../i18n';
import type { FoodItem } from '../../../shared/src/api';
import { BRAND_THEMES, GROUP_THEME, contrast, themeFor } from '../../../shared/src/brands';

function loadSwPolicy(): (pathname: string, mode: string) => string {
  const code = readFileSync(path.resolve(__dirname, '../../public/sw.js'), 'utf8');
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(`${code}\nthis.cachePolicy = cachePolicy;`, sandbox);
  return sandbox.cachePolicy as (p: string, m: string) => string;
}

describe('service worker cache policy', () => {
  const policy = loadSwPolicy();
  it('never caches private API data', () => {
    for (const p of ['/api/guest/me', '/api/guest/requests', '/api/guest/bill', '/api/guest/stream', '/api/guest/catalog/menu', '/api/staff/queue', '/api/admin/stays', '/api/csrf', '/api/guest/activate'])
      expect(policy(p, 'cors')).toBe('network-only');
  });
  it('caches only the shell and the minimal public hotel name', () => {
    expect(policy('/api/public/properties/palace-anfa', 'cors')).toBe('network-first');
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
  id: 1, categoryId: 1, name: { fr: 'Thé', en: 'Tea', es: 'Té' }, description: { fr: '', en: '', es: '' }, priceMinor: 4000, currency: 'MAD', available: true, isDemo: true,
  optionGroups: [{ id: 1, name: { fr: 'x', en: 'x', es: 'x' }, minSelect: 0, maxSelect: 2, options: [{ id: 7, name: { fr: 'Miel', en: 'Honey', es: 'Miel' }, priceDeltaMinor: 500, available: true }] }],
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

describe('scanned QR codes', () => {
  it('recognises a private stay link, a typed-code QR, and rejects anything else', () => {
    expect(parseScanned('https://guest.example/activate?p=palace-anfa#t=' + 'A'.repeat(43))).toEqual({ kind: 'token', token: 'A'.repeat(43), propertyId: 'palace-anfa' });
    expect(parseScanned('abcd-efgh-jk12')).toEqual({ kind: 'code', code: 'ABCDEFGHJK12' });
    expect(parseScanned('https://guest.example/p/palace-anfa')).toEqual({ kind: 'other' });
    expect(parseScanned('https://guest.example/activate?p=palace-anfa')).toEqual({ kind: 'other' });
    expect(parseScanned('hello')).toEqual({ kind: 'other' });
  });
});

describe('content language fallback', () => {
  it('uses the chosen language, then English, then French', () => {
    expect(pick({ fr: 'Serviettes', en: 'Towels', es: 'Toallas' }, 'es')).toBe('Toallas');
    expect(pick({ fr: 'Serviettes', en: 'Towels', es: '' }, 'es')).toBe('Towels');
    expect(pick({ fr: 'Serviettes', en: '', es: '' }, 'es')).toBe('Serviettes');
  });
});

describe('brand themes (Rassuich charter)', () => {
  const all = [GROUP_THEME, ...Object.values(BRAND_THEMES)];
  it('falls back to the group identity for unknown or prototype ids', () => {
    expect(themeFor('constructor')).toBe(GROUP_THEME);
    expect(themeFor('__proto__')).toBe(GROUP_THEME);
    expect(themeFor(null)).toBe(GROUP_THEME);
  });
  it('keeps the charter accents verbatim', () => {
    expect(BRAND_THEMES['palace-anfa'].accent).toBe('#b08d57');
    expect(BRAND_THEMES['hotel-suisse'].accent).toBe('#1f3a52');
    expect(BRAND_THEMES['palm-plaza'].accent).toBe('#995151');
    expect(BRAND_THEMES['palm-appart-club'].accent).toBe('#ce2b31');
    expect(GROUP_THEME.accent).toBe('#0f2a4a');
    // Where the charter's deep shade already reaches 7:1 with cream it is used as-is for buttons.
    for (const id of ['hotel-suisse', 'palm-plaza', 'palm-appart-club']) expect(BRAND_THEMES[id].accentStrong).toBe(BRAND_THEMES[id].accentDeep);
  });
  it('meets WCAG AA for button labels, body text, muted text and accent text', () => {
    for (const th of all) {
      expect(contrast(th.onAccent, th.accent), `${th.id} button`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(th.ink, th.paper), `${th.id} ink`).toBeGreaterThanOrEqual(7);
      expect(contrast(th.muted, th.paper), `${th.id} muted`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(th.muted, th.paperDeep), `${th.id} muted on paperDeep`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(th.cream, th.accentStrong), `${th.id} button / selected fill (AAA)`).toBeGreaterThanOrEqual(7);
      expect(contrast(th.cream, th.accentPressed), `${th.id} pressed button`).toBeGreaterThanOrEqual(7);
      expect(contrast(th.accentText, th.paper), `${th.id} link text (AAA)`).toBeGreaterThanOrEqual(7);
      expect(contrast(th.muted, th.paper), `${th.id} secondary text`).toBeGreaterThanOrEqual(6);
      expect(contrast(th.ink, th.paperDeep), `${th.id} focus ring`).toBeGreaterThanOrEqual(3);
      expect(contrast(th.accentText, th.paper), `${th.id} accent text`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
