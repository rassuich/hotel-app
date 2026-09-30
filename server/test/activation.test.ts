import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, guest, orderTea, reception, roomId, setup, type TestEnv } from './helpers';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});
afterEach(() => env.close());

describe('guest-only access', () => {
  it('serves no menus, services or hotel content without a validated stay', async () => {
    const c = await new Client(env.app).init();
    for (const path of ['menu', 'services', 'content', 'locations', 'property']) {
      const r = await c.get(`/api/guest/catalog/${path}`);
      expect(r.status, path).toBe(401);
    }
    // The old public catalogue endpoints no longer exist.
    for (const path of ['/api/public/properties', '/api/public/properties/palace-anfa/menu', '/api/public/properties/palace-anfa/content']) {
      expect((await c.get(path)).status, path).toBe(404);
    }
    // Only the hotel's name is public (for the validation screen of a private link).
    const p = (await c.get('/api/public/properties/palace-anfa')).body.property;
    expect(Object.keys(p).sort()).toEqual(['activationCheck', 'city', 'id', 'name']);
  });

  it('serves the catalogue of the guest\'s own hotel, in three languages', async () => {
    const g = await guest(env);
    const menu = (await g.get('/api/guest/catalog/menu')).body;
    expect(menu.categories[0].name).toEqual({ fr: 'Petit-déjeuner', en: 'Breakfast', es: 'Desayuno' });
    expect(menu.categories[0].items[0].isDemo).toBe(true);
    expect((await g.get('/api/guest/catalog/services')).body.services[1].name.es).toBe('Toallas');
    expect((await g.get('/api/guest/catalog/content')).body.content.length).toBeGreaterThan(0);
    expect((await g.get('/api/guest/catalog/locations')).body.locations[0].label.es).toMatch(/Piscina – Tumbona/);
    expect((await g.get('/api/guest/catalog/property')).body.property).toMatchObject({ id: 'palace-anfa', requestsEnabled: true, hasDemoContent: true });
  });

  it('requires an activated stay for private requests and history', async () => {
    const c = await new Client(env.app).init();
    expect((await c.get('/api/guest/requests')).status).toBe(401);
    expect((await c.get('/api/guest/me')).body.error.code).toBe('not_activated');
    const r = await orderTea(env, c);
    expect(r.status).toBe(401);
  });

  it('rejects state-changing calls without the CSRF header', async () => {
    const c = await new Client(env.app).init();
    const r = await c.agent.post('/api/guest/activate').send({ token: env.stays[0].token, room: env.stays[0].room });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('csrf_failed');
  });
});

describe('typed validation code', () => {
  it('activates with the code plus the room number, in any case/spacing', async () => {
    const s = env.stays[0];
    expect(s.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    const c = await new Client(env.app).init();
    const r = await c.post('/api/guest/activate', { code: ` ${s.code.toLowerCase().replace(/-/g, ' ')} `, room: 'demo-101', language: 'es' });
    expect(r.status).toBe(201);
    expect((await c.get('/api/guest/me')).body.me.roomLabel).toBe('DEMO-101');
    expect(env.ctx.db.prepare('SELECT language FROM guest_sessions').pluck().get()).toBe('es');
  });

  it('always requires the room number with a code, and fails identically', async () => {
    const s = env.stays[0];
    const c = await new Client(env.app).init();
    const bodies = [
      { code: s.code },
      { code: s.code, room: 'DEMO-102' },
      { code: 'ZZZZ-ZZZZ-ZZZZ', room: 'DEMO-101' },
      { code: 'AB', room: 'DEMO-101' },
    ];
    for (const b of bodies) {
      const r = await c.post('/api/guest/activate', b);
      expect([400, 401]).toContain(r.status);
      if (r.status === 401) expect(r.body).toEqual({ error: { code: 'activation_failed' } });
    }
    // Sending both a token and a code is refused.
    expect((await c.post('/api/guest/activate', { code: s.code, token: s.token, room: 'DEMO-101' })).status).toBe(400);
  });

  it('is revoked together with the QR on rotation and room move, and stored only as a hash', async () => {
    const s = env.stays[0];
    const dump = JSON.stringify(env.ctx.db.prepare('SELECT * FROM activation_credentials').all());
    expect(dump).not.toContain(s.code.replace(/-/g, ''));
    expect(dump).not.toContain(s.code);
    const desk = await reception(env);
    const rot = await desk.post(`/api/admin/stays/${s.stayId}/rotate-qr`, { reason: 'reprint' });
    expect(rot.body.qr.code).toMatch(/^\w{4}-\w{4}-\w{4}$/);
    const c = await new Client(env.app).init();
    expect((await c.post('/api/guest/activate', { code: s.code, room: 'DEMO-101' })).status).toBe(401);
    expect((await c.post('/api/guest/activate', { code: rot.body.qr.code, room: 'DEMO-101' })).status).toBe(201);
    const move = await desk.post(`/api/admin/stays/${s.stayId}/move`, { roomId: roomId(env, 'DEMO-206') });
    const c2 = await new Client(env.app).init();
    expect((await c2.post('/api/guest/activate', { code: rot.body.qr.code, room: 'DEMO-101' })).status).toBe(401);
    expect((await c2.post('/api/guest/activate', { code: rot.body.qr.code, room: 'DEMO-206' })).status).toBe(401);
    expect((await c2.post('/api/guest/activate', { code: move.body.qr.code, room: 'DEMO-206' })).status).toBe(201);
  });
});

describe('private QR activation', () => {
  it('activates multiple devices for the same stay, which share request history', async () => {
    const phone = await guest(env);
    const tablet = await guest(env);
    const sub = await orderTea(env, phone);
    expect(sub.status).toBe(201);
    const history = await tablet.get('/api/guest/requests');
    expect(history.status).toBe(200);
    expect(history.body.requests.map((r: { ref: string }) => r.ref)).toEqual([sub.body.request.ref]);
    const me = (await tablet.get('/api/guest/me')).body.me;
    expect(me).toMatchObject({ roomLabel: 'DEMO-101', canOrder: true, capability: 'order' });
  });

  it('a public hotel link/QR cannot authenticate', async () => {
    const c = await new Client(env.app).init();
    for (const token of ['palace-anfa', 'https://guest.test/p/palace-anfa', 'x'.repeat(43)]) {
      const r = await c.post('/api/guest/activate', { token, room: 'DEMO-101' });
      expect([400, 401]).toContain(r.status);
    }
    expect((await c.get('/api/guest/me')).status).toBe(401);
  });

  it('gives an identical error for a wrong room, unknown token or empty room', async () => {
    const c = await new Client(env.app).init();
    const wrongRoom = await c.post('/api/guest/activate', { token: env.stays[0].token, room: 'DEMO-102' });
    const noRoom = await c.post('/api/guest/activate', { token: env.stays[0].token });
    const badToken = await c.post('/api/guest/activate', { token: 'A'.repeat(43), room: 'DEMO-101' });
    for (const r of [wrongRoom, noRoom, badToken]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: { code: 'activation_failed' } });
    }
  });

  it('accepts the room number case/spacing-insensitively', async () => {
    await expect(guest(env, 0, undefined, ' demo 101 ')).resolves.toBeTruthy();
  });

  it('stores only token hashes, never raw tokens', () => {
    const dump = JSON.stringify(env.ctx.db.prepare('SELECT * FROM activation_credentials').all());
    for (const s of env.stays) expect(dump).not.toContain(s.token);
  });

  it('rate-limits activation attempts', async () => {
    env.close();
    env = await setup({ rateLimit: { windowMs: 60_000, activationMax: 3, loginMax: 3 } });
    const c = await new Client(env.app).init();
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await c.post('/api/guest/activate', { token: 'B'.repeat(43), room: '1' })).status);
    expect(codes).toEqual([401, 401, 401, 429, 429]);
  });

  it('sets an httpOnly session cookie scoped to the API', async () => {
    const c = await new Client(env.app).init();
    const r = await c.post('/api/guest/activate', { token: env.stays[0].token, room: 'DEMO-101' });
    const cookie = (r.headers['set-cookie'] as unknown as string[]).find((h) => h.startsWith('pa_guest='))!;
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/Path=\/api/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('keeps the session language in step with the guest\'s choice (used for push text)', async () => {
    const g = await guest(env);
    expect((await g.patch('/api/guest/language', { language: 'es' })).status).toBe(200);
    expect(env.ctx.db.prepare('SELECT language FROM guest_sessions').pluck().get()).toBe('es');
    expect((await g.patch('/api/guest/language', { language: 'de' })).status).toBe(400);
  });

  it('signing out revokes only that device', async () => {
    const a = await guest(env);
    const b = await guest(env);
    await a.post('/api/guest/logout');
    expect((await a.get('/api/guest/me')).status).toBe(401);
    expect((await b.get('/api/guest/me')).status).toBe(200);
  });
});
