import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client, guest, orderTea, setup, type TestEnv } from './helpers';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});
afterEach(() => env.close());

describe('public content', () => {
  it('serves menus, services, content and properties without login', async () => {
    const c = await new Client(env.app).init();
    const menu = await c.get('/api/public/properties/palace-anfa/menu');
    expect(menu.status).toBe(200);
    expect(menu.body.categories.length).toBeGreaterThan(0);
    expect(menu.body.categories[0].items[0].isDemo).toBe(true);
    expect((await c.get('/api/public/properties/palace-anfa/services')).body.services.length).toBeGreaterThan(0);
    expect((await c.get('/api/public/properties/palace-anfa/content')).body.content.length).toBeGreaterThan(0);
    const props = (await c.get('/api/public/properties')).body.properties as { id: string; requestsEnabled: boolean }[];
    expect(props.map((p) => p.id)).toEqual(['palace-anfa', 'hotel-suisse', 'palm-plaza', 'palm-appart-club']);
    expect(props.filter((p) => p.requestsEnabled).map((p) => p.id)).toEqual(['palace-anfa']);
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

  it('signing out revokes only that device', async () => {
    const a = await guest(env);
    const b = await guest(env);
    await a.post('/api/guest/logout');
    expect((await a.get('/api/guest/me')).status).toBe(401);
    expect((await b.get('/api/guest/me')).status).toBe(200);
  });
});
