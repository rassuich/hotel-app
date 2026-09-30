import request from 'supertest';
import type { Express } from 'express';
import { loadConfig, type AppConfig } from '../src/config';
import { openDatabase } from '../src/db';
import { buildApp, type BuildOptions, type BuiltApp } from '../src/app';
import { seedBase } from '../src/seed/base';
import { seedDemo } from '../src/seed/demo';
import { hashPassword } from '../src/lib/crypto';
import { nowIso } from '../src/lib/clock';

export const PASSWORDS = { roomService: 'rs-password', reception: 'rc-password', admin: 'admin-password' };

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    ...loadConfig({} as NodeJS.ProcessEnv),
    dbPath: ':memory:',
    publicBaseUrl: 'https://guest.test',
    clientDist: null,
    silentLogs: true,
    rateLimit: { windowMs: 60_000, activationMax: 1000, loginMax: 1000 },
    ...overrides,
  };
}

export interface TestEnv extends BuiltApp {
  /** Private activation tokens for the two demo stays (DEMO-101, DEMO-102). */
  stays: { token: string; room: string; stayId: string }[];
}

export function tokenFromUrl(url: string): string {
  return new URL(url).hash.replace('#t=', '');
}

export async function setup(config: Partial<AppConfig> = {}, opts: BuildOptions & { dbFile?: string; seed?: boolean } = {}): Promise<TestEnv> {
  const cfg = testConfig(config);
  const db = opts.db ?? openDatabase(opts.dbFile ?? ':memory:');
  const built = await buildApp(cfg, { startWorker: false, heartbeatMs: 100, ...opts, db });
  if (opts.seed === false) return { ...built, stays: [] };
  seedBase(built.ctx.db, PASSWORDS);
  const demo = seedDemo(built.ctx);
  // A second property with its own department accounts, to prove isolation.
  const now = nowIso();
  built.ctx.db
    .prepare(
      `INSERT INTO department_accounts (id, property_id, role, username, display_name_fr, display_name_en, password_hash, created_at)
       VALUES ('hotel-suisse:room_service', 'hotel-suisse', 'room_service', 'suisse.roomservice', 'RS', 'RS', ?, ?)`,
    )
    .run(hashPassword('suisse-password'), now);
  built.ctx.db.prepare(`INSERT INTO devices (account_id, name, created_at) VALUES ('hotel-suisse:room_service', 'Suisse Tablet', ?)`).run(now);
  const stays = demo.stays.map((s) => {
    const stayId = built.ctx.db
      .prepare(`SELECT ra.stay_id FROM room_assignments ra JOIN rooms r ON r.id = ra.room_id WHERE r.label = ? AND ra.ended_at IS NULL`)
      .pluck()
      .get(s.room) as string;
    return { token: tokenFromUrl(s.activationUrl), room: s.room, stayId };
  });
  return { ...built, stays };
}

/** A browser-like client: cookie jar + CSRF header on writes. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  constructor(public app: Express) {
    this.agent = request.agent(app);
  }
  async init() {
    const r = await this.agent.get('/api/csrf');
    this.csrf = r.body.token;
    return this;
  }
  get(url: string) {
    return this.agent.get(url);
  }
  post(url: string, body: unknown = {}) {
    return this.agent.post(url).set('x-csrf-token', this.csrf).send(body as object);
  }
  patch(url: string, body: unknown = {}) {
    return this.agent.patch(url).set('x-csrf-token', this.csrf).send(body as object);
  }
}

export async function guest(env: TestEnv, stayIndex = 0, token?: string, room?: string): Promise<Client> {
  const c = await new Client(env.app).init();
  const s = env.stays[stayIndex];
  const r = await c.post('/api/guest/activate', { token: token ?? s.token, room: room ?? s.room, language: 'en' });
  if (r.status !== 201) throw new Error(`activation failed: ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}

export async function staff(env: TestEnv, username: string, password: string, deviceName?: string): Promise<Client> {
  const c = await new Client(env.app).init();
  const r = await c.post('/api/staff/login', { username, password });
  if (r.status !== 201) throw new Error(`login failed: ${r.status}`);
  if (deviceName) {
    const devices = (await c.get('/api/staff/devices')).body.devices as { id: number; name: string }[];
    const d = devices.find((x) => x.name === deviceName);
    if (!d) throw new Error(`no device ${deviceName}`);
    const b = await c.post('/api/staff/device', { deviceId: d.id });
    if (b.status !== 200) throw new Error('device bind failed');
  }
  return c;
}

export const roomService = (env: TestEnv, n = 1) => staff(env, 'palace.roomservice', PASSWORDS.roomService, `Room Service Tablet ${n}`);
export const reception = (env: TestEnv, n = 1) => staff(env, 'palace.reception', PASSWORDS.reception, `Reception Tablet ${n}`);
export const admin = (env: TestEnv) => staff(env, 'palace.admin', PASSWORDS.admin);

let keyCounter = 0;
export const key = (prefix = 'k') => `${prefix}${Date.now().toString(36)}${(keyCounter++).toString(36)}xx`;

export function menuItem(env: TestEnv, nameEn: string) {
  return env.ctx.db.prepare('SELECT * FROM food_items WHERE name_en = ?').get(nameEn) as { id: number; price_minor: number };
}
export function serviceItem(env: TestEnv, nameEn: string) {
  return env.ctx.db.prepare('SELECT * FROM service_items WHERE name_en = ?').get(nameEn) as { id: number; price_minor: number; complimentary: number };
}
export function poolLocation(env: TestEnv, n = 1) {
  return env.ctx.db.prepare(`SELECT * FROM delivery_locations WHERE label_en = ?`).get(`Pool – Lounger L${n} (demo)`) as { id: number };
}
export function roomId(env: TestEnv, label: string) {
  return env.ctx.db.prepare('SELECT id FROM rooms WHERE label = ?').pluck().get(label) as number;
}

/** Submits a simple food order (mint tea x2) to the room. */
export async function orderTea(env: TestEnv, g: Client, idempotencyKey = key(), extra: Record<string, unknown> = {}) {
  const tea = menuItem(env, 'Mint tea');
  return g.post('/api/guest/requests/food', {
    idempotencyKey,
    lines: [{ itemId: tea.id, quantity: 2, optionIds: [], expectedUnitPriceMinor: tea.price_minor }],
    destination: { kind: 'room' },
    expectedTotalMinor: tea.price_minor * 2,
    ...extra,
  });
}

export async function requestTowels(env: TestEnv, g: Client, idempotencyKey = key()) {
  const towels = serviceItem(env, 'Towels');
  return g.post('/api/guest/requests/service', {
    idempotencyKey,
    line: { itemId: towels.id, quantity: 2, details: 'Two large ones', expectedComplimentary: true },
    destination: { kind: 'room' },
  });
}

/** Finds the staff-side ticket id for a guest ref. */
export async function staffTicket(s: Client, ref: string) {
  const q = await s.get('/api/staff/queue');
  const t = (q.body.requests as { ref: string; id: number; revision: number }[]).find((x) => x.ref === ref);
  if (!t) throw new Error(`ticket ${ref} not in queue`);
  return t as any;
}
