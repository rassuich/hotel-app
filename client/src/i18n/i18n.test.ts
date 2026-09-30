import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import en from './en.json';
import fr from './fr.json';
import es from './es.json';
import { translate } from './index';
import { FOOD_STATES, SERVICE_STATES } from '../../../shared/src/states';

const flat = (o: object, p = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? flat(v, `${p}${k}.`) : [`${p}${k}`]));

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir).flatMap((f) => {
    const full = path.join(dir, f);
    if (statSync(full).isDirectory()) return files(full, ext);
    return ext.test(f) && !f.endsWith('.test.ts') ? [full] : [];
  });
}

const enKeys = new Set(flat(en));
const frKeys = new Set(flat(fr));
const esKeys = new Set(flat(es));
const LANGS = ['fr', 'en', 'es'] as const;
/** Key families built at runtime (e.g. t(`staff.state_${state}`)). */
const DYNAMIC = ['errors.', 'progress.', 'staff.state_', 'requests.attempt_', 'staff.posStatus_', 'cart.issue_', 'staff.attention_', 'staff.push_', 'admin.kind_', 'admin.filter_', 'staff.sections_', 'admin.pmsStatus_'];
const clientSource = () => files(path.resolve(__dirname, '..'), /\.tsx?$/).map((f) => readFileSync(f, 'utf8')).join('\n');

describe('translations', () => {
  it('French, English and Spanish have exactly the same keys, all non-empty', () => {
    for (const other of [frKeys, esKeys]) {
      expect([...enKeys].filter((k) => !other.has(k))).toEqual([]);
      expect([...other].filter((k) => !enKeys.has(k))).toEqual([]);
    }
    for (const k of enKeys) for (const l of LANGS) expect(translate(l, k).trim(), `${l}:${k}`).not.toBe('');
  });

  it('uses the same {placeholders} in every language', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const k of enKeys) {
      expect(ph(translate('fr', k)), `fr:${k}`).toBe(ph(translate('en', k)));
      expect(ph(translate('es', k)), `es:${k}`).toBe(ph(translate('en', k)));
    }
  });

  it('has no unused keys (outside runtime-built families)', () => {
    const src = clientSource();
    const used = new Set([...src.matchAll(/\bt\(\s*'([a-zA-Z_.]+)'/g)].map((m) => m[1]));
    expect([...enKeys].filter((k) => !used.has(k) && !DYNAMIC.some((d) => k.startsWith(d)))).toEqual([]);
  });

  it('every literal t("...") key used in the client exists', () => {
    const src = clientSource();
    const used = [...src.matchAll(/\bt\(\s*'([a-zA-Z_.]+)'/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(100);
    expect(used.filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('covers every dynamic key family (states, progress, attempts, POS, issues)', () => {
    for (const s of new Set([...FOOD_STATES, ...SERVICE_STATES])) expect(enKeys.has(`staff.state_${s}`), s).toBe(true);
    for (const p of ['sent', 'confirming', 'confirming_in_person', 'not_reached', 'confirmed', 'preparing', 'delivered', 'handling', 'done', 'declined', 'cancelled'])
      expect(enKeys.has(`progress.${p}`), p).toBe(true);
    for (const s of ['sent', 'confirming', 'confirmed', 'preparing', 'delivered', 'handling', 'done']) expect(enKeys.has(`progress.step_${s}`)).toBe(true);
    for (const a of ['pending', 'confirmed', 'not_received', 'superseded']) expect(enKeys.has(`requests.attempt_${a}`)).toBe(true);
    for (const p of ['not_entered', 'entered', 'uncertain']) expect(enKeys.has(`staff.posStatus_${p}`)).toBe(true);
    for (const i of ['unavailable', 'price_changed', 'became_chargeable', 'option_unavailable', 'quantity_limit']) expect(enKeys.has(`cart.issue_${i}`)).toBe(true);
    for (const f of ['room_moved', 'checked_out']) expect(enKeys.has(`staff.attention_${f}`)).toBe(true);
  });

  it('translates every error code the server can return, in every language', () => {
    const server = files(path.resolve(__dirname, '../../../server/src'), /\.ts$/).map((f) => readFileSync(f, 'utf8')).join('\n');
    const codes = new Set<string>();
    for (const m of server.matchAll(/(?:ApiError\(\d+,\s*|notFound\(|forbidden\(|conflict\(|badRequest\(|unauthorized\()'([a-z_]+)'/g)) codes.add(m[1]);
    for (const m of server.matchAll(/return '([a-z_]+)';/g)) codes.add(m[1]); // orderingBlockReason
    for (const c of ['not_found', 'rate_limited', 'csrf_failed', 'validation_failed', 'internal_error']) codes.add(c);
    expect(codes.size).toBeGreaterThan(30);
    const missing = [...codes].filter((c) => !enKeys.has(`errors.${c}`));
    expect(missing).toEqual([]);
  });

  it('interpolates parameters', () => {
    expect(translate('fr', 'home.greeting', { hotel: "Le Palace d'Anfa" })).toBe("Bienvenue au Le Palace d'Anfa");
    expect(translate('en', 'requests.ref', { ref: 'PA-0001' })).toBe('Ref. PA-0001');
    expect(translate('es', 'services.selectedCount', { count: 3 })).toContain('3');
  });
});
