import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context';
import type { DB } from '../db';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { parse } from '../lib/http';
import { hashPassword } from '../lib/crypto';
import { nowIso } from '../lib/clock';
import { loadStaff, type StaffContext } from '../services/staffAuth';
import { applyStayEvent, listStays, rotateQr } from '../services/stays';
import { getProperty } from '../services/rows';
import * as S from './schemas';

const toSnake = (s: string) => s.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

function camelRow(row: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v;
  return out;
}

function toColumns(data: Record<string, unknown>) {
  const cols: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    cols[toSnake(k)] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return cols;
}

function insert(db: DB, table: string, data: Record<string, unknown>): number {
  const cols = toColumns(data);
  const keys = Object.keys(cols);
  const info = db.prepare(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map((k) => '@' + k).join(', ')})`).run(cols);
  return Number(info.lastInsertRowid);
}

/** Updates a row only if `scopeSql` (e.g. "property_id = @pid") matches; 404 otherwise. */
function update(db: DB, table: string, id: number, scopeSql: string, scopeParams: Record<string, unknown>, data: Record<string, unknown>) {
  const cols = toColumns(data);
  const keys = Object.keys(cols);
  if (keys.length === 0) throw badRequest('nothing_to_update');
  const res = db
    .prepare(`UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @__id AND ${scopeSql}`)
    .run({ ...cols, ...scopeParams, __id: id });
  if (res.changes !== 1) throw notFound();
}

const text = (max = 200) => z.string().trim().max(max);

const contentSchema = z.object({
  kind: z.enum(['info', 'hours', 'contact', 'event']),
  titleFr: text().min(1),
  titleEn: text().min(1),
  bodyFr: text(4000).default(''),
  bodyEn: text(4000).default(''),
  startsAt: z.string().nullish(),
  endsAt: z.string().nullish(),
  public: z.boolean().default(true),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
const categorySchema = z.object({ nameFr: text().min(1), nameEn: text().min(1), sort: z.number().int().default(0), active: z.boolean().default(true) });
const foodItemSchema = z.object({
  categoryId: z.number().int().positive(),
  nameFr: text().min(1),
  nameEn: text().min(1),
  descriptionFr: text(1000).default(''),
  descriptionEn: text(1000).default(''),
  priceMinor: z.number().int().min(0),
  available: z.boolean().default(true),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
const groupSchema = z.object({
  foodItemId: z.number().int().positive(),
  nameFr: text().min(1),
  nameEn: text().min(1),
  minSelect: z.number().int().min(0).max(10).default(0),
  maxSelect: z.number().int().min(1).max(10).default(1),
  sort: z.number().int().default(0),
});
const optionSchema = z.object({
  groupId: z.number().int().positive(),
  nameFr: text().min(1),
  nameEn: text().min(1),
  priceDeltaMinor: z.number().int().min(0).default(0),
  available: z.boolean().default(true),
  sort: z.number().int().default(0),
});
const serviceSchema = z.object({
  nameFr: text().min(1),
  nameEn: text().min(1),
  descriptionFr: text(1000).default(''),
  descriptionEn: text(1000).default(''),
  complimentary: z.boolean().default(true),
  priceMinor: z.number().int().min(0).default(0),
  maxQuantity: z.number().int().min(1).max(50).default(4),
  allowDetails: z.boolean().default(false),
  available: z.boolean().default(true),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
const roomSchema = z.object({ label: text(20).min(1), active: z.boolean().default(true) });
const locationSchema = z.object({
  labelFr: text(80).min(1),
  labelEn: text(80).min(1),
  active: z.boolean().default(true),
  sort: z.number().int().default(0),
});
const deviceSchema = z.object({ accountId: z.string(), name: text(60).min(2), active: z.boolean().default(true) });

export function adminRoutes(ctx: AppContext): Router {
  const r = Router();
  const { db } = ctx;

  /** Reception (stay/QR desk) and admin may manage stays; only admin edits configuration. */
  const staff = (req: Request, roles: StaffContext['role'][]) => {
    const s = loadStaff(ctx, req);
    if (!roles.includes(s.role)) throw forbidden('role_not_allowed');
    return s;
  };
  const desk = (req: Request) => staff(req, ['reception', 'admin']);
  const admin = (req: Request) => staff(req, ['admin']);
  const num = (v: unknown) => {
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) throw notFound();
    return n;
  };
  const pid = (s: StaffContext) => ({ pid: s.propertyId });

  // ---- Integrations / overview --------------------------------------------
  r.get('/integrations', (req, res) => {
    const s = desk(req);
    res.json({
      pms: ctx.pms.status(s.propertyId),
      bills: { provider: ctx.bills.id, configured: ctx.bills.configured },
      push: { configured: ctx.push.configured },
      ordering: {
        enabled: !!getProperty(db, s.propertyId)?.requests_enabled && ctx.config.orderingProperties.includes(s.propertyId),
        scheduledDepartureCutoffHours: ctx.config.scheduledDepartureCutoffHours,
        postStayAccessHours: ctx.config.postStayAccessHours,
      },
    });
  });

  // ---- Stays & QR ----------------------------------------------------------
  r.get('/stays', (req, res) => {
    const s = desk(req);
    const f = String(req.query.filter ?? 'active');
    const filter = (['active', 'checked_out', 'overdue', 'all'].includes(f) ? f : 'active') as 'active';
    res.json({ stays: listStays(ctx, s.propertyId, filter), pms: ctx.pms.status(s.propertyId) });
  });

  const requireManual = () => {
    if (!ctx.pms.acceptsManualEvents) throw forbidden('pms_manual_disabled');
  };

  r.post('/stays', (req, res) => {
    const s = desk(req);
    requireManual();
    const b = parse(S.createStayBody, req.body);
    const out = applyStayEvent(ctx, s.propertyId, {
      kind: 'check_in',
      guestName: b.guestName,
      roomId: b.roomId,
      occupants: b.occupants,
      scheduledDeparture: b.scheduledDeparture ?? null,
    });
    res.setHeader('Cache-Control', 'no-store');
    res.status(201).json({ stayId: out.stayId, qr: out.qr });
  });

  r.patch('/stays/:id', (req, res) => {
    const s = desk(req);
    requireManual();
    const b = parse(S.updateStayBody, req.body);
    applyStayEvent(ctx, s.propertyId, { kind: 'update', stayId: String(req.params.id), ...b });
    res.json({ ok: true });
  });

  r.post('/stays/:id/move', (req, res) => {
    const s = desk(req);
    requireManual();
    const b = parse(S.moveBody, req.body);
    const out = applyStayEvent(ctx, s.propertyId, { kind: 'room_move', stayId: String(req.params.id), roomId: b.roomId });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ qr: out.qr });
  });

  r.post('/stays/:id/checkout', (req, res) => {
    const s = desk(req);
    requireManual();
    applyStayEvent(ctx, s.propertyId, { kind: 'check_out', stayId: String(req.params.id) });
    res.json({ ok: true });
  });

  r.post('/stays/:id/rotate-qr', (req, res) => {
    const s = desk(req);
    const b = parse(S.rotateBody, req.body);
    const revokeSessions = b.revokeSessions ?? b.reason === 'occupant_change';
    const qr = rotateQr(ctx, s.propertyId, String(req.params.id), { revokeSessions, reason: b.reason });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ qr, revokedSessions: revokeSessions });
  });

  // ---- Rooms & delivery locations -----------------------------------------
  r.get('/rooms', (req, res) => {
    const s = desk(req);
    const rooms = db
      .prepare(
        `SELECT r.*, (SELECT COUNT(*) FROM room_assignments ra WHERE ra.room_id = r.id AND ra.ended_at IS NULL) AS occupied
         FROM rooms r WHERE r.property_id = ? ORDER BY r.label`,
      )
      .all(s.propertyId) as Record<string, unknown>[];
    const property = getProperty(db, s.propertyId)!;
    res.json({ rooms: rooms.map(camelRow), configuredRoomCount: property.room_count });
  });
  r.post('/rooms', (req, res) => {
    const s = admin(req);
    const b = parse(roomSchema, req.body);
    res.status(201).json({ id: insert(db, 'rooms', { ...b, propertyId: s.propertyId }) });
  });
  r.patch('/rooms/:id', (req, res) => {
    const s = admin(req);
    update(db, 'rooms', num(req.params.id), 'property_id = @pid', pid(s), parse(roomSchema.partial(), req.body));
    res.json({ ok: true });
  });

  r.get('/locations', (req, res) => {
    const s = admin(req);
    res.json({ locations: (db.prepare('SELECT * FROM delivery_locations WHERE property_id = ? ORDER BY sort, id').all(s.propertyId) as Record<string, unknown>[]).map(camelRow) });
  });
  r.post('/locations', (req, res) => {
    const s = admin(req);
    res.status(201).json({ id: insert(db, 'delivery_locations', { ...parse(locationSchema, req.body), zone: 'pool', propertyId: s.propertyId }) });
  });
  r.patch('/locations/:id', (req, res) => {
    const s = admin(req);
    update(db, 'delivery_locations', num(req.params.id), 'property_id = @pid', pid(s), parse(locationSchema.partial(), req.body));
    res.json({ ok: true });
  });

  // ---- Content -------------------------------------------------------------
  r.get('/content', (req, res) => {
    const s = admin(req);
    res.json({ content: (db.prepare('SELECT * FROM content_items WHERE property_id = ? ORDER BY kind, sort, id').all(s.propertyId) as Record<string, unknown>[]).map(camelRow) });
  });
  r.post('/content', (req, res) => {
    const s = admin(req);
    res.status(201).json({ id: insert(db, 'content_items', { ...parse(contentSchema, req.body), propertyId: s.propertyId }) });
  });
  r.patch('/content/:id', (req, res) => {
    const s = admin(req);
    update(db, 'content_items', num(req.params.id), 'property_id = @pid', pid(s), parse(contentSchema.partial(), req.body));
    res.json({ ok: true });
  });

  // ---- Food catalogue ------------------------------------------------------
  r.get('/food', (req, res) => {
    const s = admin(req);
    const all = (sql: string) => (db.prepare(sql).all(s.propertyId) as Record<string, unknown>[]).map(camelRow);
    res.json({
      categories: all('SELECT * FROM food_categories WHERE property_id = ? ORDER BY sort, id'),
      items: all('SELECT * FROM food_items WHERE property_id = ? ORDER BY sort, id'),
      groups: all('SELECT g.* FROM food_option_groups g JOIN food_items i ON i.id = g.food_item_id WHERE i.property_id = ? ORDER BY g.sort, g.id'),
      options: all(
        'SELECT o.* FROM food_options o JOIN food_option_groups g ON g.id = o.group_id JOIN food_items i ON i.id = g.food_item_id WHERE i.property_id = ? ORDER BY o.sort, o.id',
      ),
    });
  });
  const ownsCategory = (propertyId: string, id: number) => {
    if (!db.prepare('SELECT 1 FROM food_categories WHERE id = ? AND property_id = ?').get(id, propertyId)) throw badRequest('category_not_found');
  };
  const ownsItem = (propertyId: string, id: number) => {
    if (!db.prepare('SELECT 1 FROM food_items WHERE id = ? AND property_id = ?').get(id, propertyId)) throw badRequest('item_not_found');
  };
  const ownsGroup = (propertyId: string, id: number) => {
    if (!db.prepare('SELECT 1 FROM food_option_groups g JOIN food_items i ON i.id = g.food_item_id WHERE g.id = ? AND i.property_id = ?').get(id, propertyId))
      throw badRequest('group_not_found');
  };

  r.post('/food/categories', (req, res) => {
    const s = admin(req);
    res.status(201).json({ id: insert(db, 'food_categories', { ...parse(categorySchema, req.body), propertyId: s.propertyId }) });
  });
  r.patch('/food/categories/:id', (req, res) => {
    const s = admin(req);
    update(db, 'food_categories', num(req.params.id), 'property_id = @pid', pid(s), parse(categorySchema.partial(), req.body));
    res.json({ ok: true });
  });
  r.post('/food/items', (req, res) => {
    const s = admin(req);
    const b = parse(foodItemSchema, req.body);
    ownsCategory(s.propertyId, b.categoryId);
    const currency = getProperty(db, s.propertyId)!.currency;
    res.status(201).json({ id: insert(db, 'food_items', { ...b, currency, propertyId: s.propertyId }) });
  });
  r.patch('/food/items/:id', (req, res) => {
    const s = admin(req);
    const b = parse(foodItemSchema.partial(), req.body);
    if (b.categoryId) ownsCategory(s.propertyId, b.categoryId);
    update(db, 'food_items', num(req.params.id), 'property_id = @pid', pid(s), b);
    res.json({ ok: true });
  });
  r.post('/food/option-groups', (req, res) => {
    const s = admin(req);
    const b = parse(groupSchema, req.body);
    ownsItem(s.propertyId, b.foodItemId);
    res.status(201).json({ id: insert(db, 'food_option_groups', b) });
  });
  r.patch('/food/option-groups/:id', (req, res) => {
    const s = admin(req);
    const b = parse(groupSchema.omit({ foodItemId: true }).partial(), req.body);
    update(db, 'food_option_groups', num(req.params.id), 'food_item_id IN (SELECT id FROM food_items WHERE property_id = @pid)', pid(s), b);
    res.json({ ok: true });
  });
  r.post('/food/options', (req, res) => {
    const s = admin(req);
    const b = parse(optionSchema, req.body);
    ownsGroup(s.propertyId, b.groupId);
    res.status(201).json({ id: insert(db, 'food_options', b) });
  });
  r.patch('/food/options/:id', (req, res) => {
    const s = admin(req);
    const b = parse(optionSchema.omit({ groupId: true }).partial(), req.body);
    update(
      db,
      'food_options',
      num(req.params.id),
      'group_id IN (SELECT g.id FROM food_option_groups g JOIN food_items i ON i.id = g.food_item_id WHERE i.property_id = @pid)',
      pid(s),
      b,
    );
    res.json({ ok: true });
  });

  // ---- Services ------------------------------------------------------------
  const serviceChecked = (b: { complimentary?: boolean; priceMinor?: number }, current?: { complimentary: number; price_minor: number }) => {
    const complimentary = b.complimentary ?? !!current?.complimentary;
    const price = b.priceMinor ?? current?.price_minor ?? 0;
    if (complimentary && price !== 0) throw badRequest('complimentary_has_price');
    if (!complimentary && price <= 0) throw badRequest('fee_required');
  };
  r.get('/services', (req, res) => {
    const s = admin(req);
    res.json({ services: (db.prepare('SELECT * FROM service_items WHERE property_id = ? ORDER BY sort, id').all(s.propertyId) as Record<string, unknown>[]).map(camelRow) });
  });
  r.post('/services', (req, res) => {
    const s = admin(req);
    const b = parse(serviceSchema, req.body);
    serviceChecked(b);
    const currency = getProperty(db, s.propertyId)!.currency;
    res.status(201).json({ id: insert(db, 'service_items', { ...b, currency, propertyId: s.propertyId }) });
  });
  r.patch('/services/:id', (req, res) => {
    const s = admin(req);
    const b = parse(serviceSchema.partial(), req.body);
    const current = db.prepare('SELECT complimentary, price_minor FROM service_items WHERE id = ? AND property_id = ?').get(num(req.params.id), s.propertyId) as
      | { complimentary: number; price_minor: number }
      | undefined;
    if (!current) throw notFound();
    serviceChecked(b, current);
    update(db, 'service_items', num(req.params.id), 'property_id = @pid', pid(s), b);
    res.json({ ok: true });
  });

  // ---- Accounts & devices --------------------------------------------------
  r.get('/accounts', (req, res) => {
    const s = admin(req);
    const accounts = db
      .prepare('SELECT id, role, username, display_name_fr, display_name_en, active FROM department_accounts WHERE property_id = ? ORDER BY role')
      .all(s.propertyId) as Record<string, unknown>[];
    const devices = db
      .prepare('SELECT d.* FROM devices d JOIN department_accounts a ON a.id = d.account_id WHERE a.property_id = ? ORDER BY d.name')
      .all(s.propertyId) as Record<string, unknown>[];
    res.json({ accounts: accounts.map(camelRow), devices: devices.map(camelRow) });
  });
  const ownsDeptAccount = (propertyId: string, accountId: string) => {
    if (!db.prepare(`SELECT 1 FROM department_accounts WHERE id = ? AND property_id = ? AND role IN ('room_service', 'reception')`).get(accountId, propertyId))
      throw badRequest('account_not_found');
  };
  r.post('/devices', (req, res) => {
    const s = admin(req);
    const b = parse(deviceSchema, req.body);
    ownsDeptAccount(s.propertyId, b.accountId);
    res.status(201).json({ id: insert(db, 'devices', { ...b, createdAt: nowIso() }) });
  });
  r.patch('/devices/:id', (req, res) => {
    const s = admin(req);
    const b = parse(deviceSchema.omit({ accountId: true }).partial(), req.body);
    update(db, 'devices', num(req.params.id), 'account_id IN (SELECT id FROM department_accounts WHERE property_id = @pid)', pid(s), b);
    res.json({ ok: true });
  });
  r.post('/accounts/:id/password', (req, res) => {
    const s = admin(req);
    const { password } = parse(z.object({ password: z.string().min(10).max(200) }), req.body);
    const accountId = String(req.params.id);
    const acc = db.prepare('SELECT id FROM department_accounts WHERE id = ? AND property_id = ?').get(accountId, s.propertyId);
    if (!acc) throw notFound();
    db.transaction(() => {
      db.prepare('UPDATE department_accounts SET password_hash = ? WHERE id = ?').run(hashPassword(password), accountId);
      // Sign out every tablet on that account except the admin doing the change.
      db.prepare('UPDATE staff_sessions SET revoked_at = ? WHERE account_id = ? AND id != ? AND revoked_at IS NULL').run(nowIso(), accountId, s.sessionId);
    })();
    res.json({ ok: true });
  });

  return r;
}
