import type { DB } from '../db';
import { badRequest } from '../lib/errors';
import type {
  ContentItem,
  DeliveryLocation,
  FoodCategory,
  FoodItem,
  FoodOptionGroup,
  QuoteLineIssue,
  ServiceItem,
} from '../../../shared/src/api';

const L = (fr: string, en: string) => ({ fr, en });

export function listContent(db: DB, propertyId: string, includePrivate: boolean): ContentItem[] {
  const rows = db
    .prepare(
      `SELECT * FROM content_items WHERE property_id = ? AND active = 1 ${includePrivate ? '' : 'AND public = 1'} ORDER BY kind, sort, id`,
    )
    .all(propertyId) as Record<string, any>[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: L(r.title_fr, r.title_en),
    body: L(r.body_fr, r.body_en),
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    isDemo: !!r.is_demo,
  }));
}

function optionGroups(db: DB, itemId: number, includeUnavailable = true): FoodOptionGroup[] {
  const groups = db.prepare('SELECT * FROM food_option_groups WHERE food_item_id = ? ORDER BY sort, id').all(itemId) as Record<string, any>[];
  return groups.map((g) => ({
    id: g.id,
    name: L(g.name_fr, g.name_en),
    minSelect: g.min_select,
    maxSelect: g.max_select,
    options: (db.prepare('SELECT * FROM food_options WHERE group_id = ? ORDER BY sort, id').all(g.id) as Record<string, any>[])
      .filter((o) => includeUnavailable || o.available)
      .map((o) => ({ id: o.id, name: L(o.name_fr, o.name_en), priceDeltaMinor: o.price_delta_minor, available: !!o.available })),
  }));
}

function foodItemDto(db: DB, r: Record<string, any>): FoodItem {
  return {
    id: r.id,
    categoryId: r.category_id,
    name: L(r.name_fr, r.name_en),
    description: L(r.description_fr, r.description_en),
    priceMinor: r.price_minor,
    currency: r.currency,
    available: !!r.available,
    optionGroups: optionGroups(db, r.id),
    isDemo: !!r.is_demo,
  };
}

export function listMenu(db: DB, propertyId: string): FoodCategory[] {
  const cats = db
    .prepare('SELECT * FROM food_categories WHERE property_id = ? AND active = 1 ORDER BY sort, id')
    .all(propertyId) as Record<string, any>[];
  return cats.map((c) => ({
    id: c.id,
    name: L(c.name_fr, c.name_en),
    items: (db
      .prepare('SELECT * FROM food_items WHERE category_id = ? AND property_id = ? AND active = 1 ORDER BY sort, id')
      .all(c.id, propertyId) as Record<string, any>[]).map((r) => foodItemDto(db, r)),
  }));
}

function serviceDto(r: Record<string, any>): ServiceItem {
  return {
    id: r.id,
    name: L(r.name_fr, r.name_en),
    description: L(r.description_fr, r.description_en),
    complimentary: !!r.complimentary,
    priceMinor: r.price_minor,
    currency: r.currency,
    maxQuantity: r.max_quantity,
    allowDetails: !!r.allow_details,
    available: !!r.available,
    isDemo: !!r.is_demo,
  };
}

export function listServices(db: DB, propertyId: string): ServiceItem[] {
  return (db
    .prepare('SELECT * FROM service_items WHERE property_id = ? AND active = 1 ORDER BY sort, id')
    .all(propertyId) as Record<string, any>[]).map(serviceDto);
}

export function listLocations(db: DB, propertyId: string): DeliveryLocation[] {
  return (db
    .prepare('SELECT * FROM delivery_locations WHERE property_id = ? AND active = 1 ORDER BY sort, id')
    .all(propertyId) as Record<string, any>[]).map((r) => ({ id: r.id, zone: r.zone, label: L(r.label_fr, r.label_en) }));
}

// ---------------------------------------------------------------------------
// Quoting: prices, availability and limits are always re-derived on the server.
// ---------------------------------------------------------------------------

export interface QuotedLine {
  itemKind: 'food' | 'service';
  itemId: number;
  nameFr: string;
  nameEn: string;
  options: { id: number; name: { fr: string; en: string }; priceDeltaMinor: number }[];
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  complimentary: boolean;
  details: string | null;
}

export interface Quote {
  lines: QuotedLine[];
  totalMinor: number;
  currency: string;
  issues: QuoteLineIssue[];
}

export interface FoodLineInput {
  itemId: number;
  quantity: number;
  optionIds: number[];
  expectedUnitPriceMinor?: number;
}

export const MAX_FOOD_QUANTITY = 20;

export function quoteFood(db: DB, propertyId: string, currency: string, input: FoodLineInput[]): Quote {
  const issues: QuoteLineIssue[] = [];
  const lines: QuotedLine[] = [];
  input.forEach((line, index) => {
    const item = db
      .prepare('SELECT * FROM food_items WHERE id = ? AND property_id = ? AND active = 1')
      .get(line.itemId, propertyId) as Record<string, any> | undefined;
    if (!item) {
      issues.push({ index, itemId: line.itemId, issue: 'unavailable' });
      return;
    }
    if (!item.available) issues.push({ index, itemId: line.itemId, issue: 'unavailable' });
    if (line.quantity > MAX_FOOD_QUANTITY) issues.push({ index, itemId: line.itemId, issue: 'quantity_limit', maxQuantity: MAX_FOOD_QUANTITY });
    const groups = optionGroups(db, item.id);
    const chosen = new Set(line.optionIds);
    const selected: QuotedLine['options'] = [];
    let optionsOk = true;
    for (const g of groups) {
      const picked = g.options.filter((o) => chosen.has(o.id));
      for (const o of picked) {
        chosen.delete(o.id);
        if (!o.available) optionsOk = false;
        selected.push({ id: o.id, name: o.name, priceDeltaMinor: o.priceDeltaMinor });
      }
      if (picked.length < g.minSelect || picked.length > g.maxSelect) throw badRequest('invalid_options', { index, groupId: g.id });
    }
    if (chosen.size > 0) throw badRequest('invalid_options', { index });
    if (!optionsOk) issues.push({ index, itemId: item.id, issue: 'option_unavailable' });
    const unit = item.price_minor + selected.reduce((s, o) => s + o.priceDeltaMinor, 0);
    if (line.expectedUnitPriceMinor !== undefined && line.expectedUnitPriceMinor !== unit) {
      issues.push({ index, itemId: item.id, issue: 'price_changed', quotedUnitPriceMinor: line.expectedUnitPriceMinor, currentUnitPriceMinor: unit });
    }
    if (item.currency !== currency) throw badRequest('currency_mismatch');
    lines.push({
      itemKind: 'food',
      itemId: item.id,
      nameFr: item.name_fr,
      nameEn: item.name_en,
      options: selected,
      unitPriceMinor: unit,
      quantity: line.quantity,
      lineTotalMinor: unit * line.quantity,
      complimentary: false,
      details: null,
    });
  });
  return { lines, totalMinor: lines.reduce((s, l) => s + l.lineTotalMinor, 0), currency, issues };
}

export interface ServiceLineInput {
  itemId: number;
  quantity: number;
  details?: string | null;
  expectedUnitPriceMinor?: number;
  expectedComplimentary?: boolean;
}

export function quoteService(db: DB, propertyId: string, currency: string, line: ServiceLineInput): Quote {
  const issues: QuoteLineIssue[] = [];
  const item = db
    .prepare('SELECT * FROM service_items WHERE id = ? AND property_id = ? AND active = 1')
    .get(line.itemId, propertyId) as Record<string, any> | undefined;
  if (!item) return { lines: [], totalMinor: 0, currency, issues: [{ index: 0, itemId: line.itemId, issue: 'unavailable' }] };
  if (!item.available) issues.push({ index: 0, itemId: item.id, issue: 'unavailable' });
  if (line.quantity > item.max_quantity) issues.push({ index: 0, itemId: item.id, issue: 'quantity_limit', maxQuantity: item.max_quantity });
  const complimentary = !!item.complimentary;
  const unit = complimentary ? 0 : item.price_minor;
  // A request the guest saw as complimentary must never silently gain a charge.
  if (line.expectedComplimentary !== false && !complimentary) {
    issues.push({ index: 0, itemId: item.id, issue: 'became_chargeable', currentUnitPriceMinor: unit });
  } else if (!complimentary && line.expectedUnitPriceMinor !== undefined && line.expectedUnitPriceMinor !== unit) {
    issues.push({ index: 0, itemId: item.id, issue: 'price_changed', quotedUnitPriceMinor: line.expectedUnitPriceMinor, currentUnitPriceMinor: unit });
  }
  if (item.currency !== currency) throw badRequest('currency_mismatch');
  const details = item.allow_details && line.details ? line.details : null;
  return {
    lines: [
      {
        itemKind: 'service',
        itemId: item.id,
        nameFr: item.name_fr,
        nameEn: item.name_en,
        options: [],
        unitPriceMinor: unit,
        quantity: line.quantity,
        lineTotalMinor: unit * line.quantity,
        complimentary,
        details,
      },
    ],
    totalMinor: unit * line.quantity,
    currency,
    issues,
  };
}
