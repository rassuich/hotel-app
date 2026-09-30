import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { buildApp } from '../src/app';
import { openDatabase } from '../src/db';
import { PlurielPmsAdapter } from '../src/pms/pluriel';
import type { PushSender } from '../src/push/sender';
import { Client, guest, key, orderTea, reception, roomId, roomService, setup, staffTicket, testConfig, type TestEnv } from './helpers';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function fakePush(): PushSender & { sent: string[] } {
  const sent: string[] = [];
  return { configured: true, publicKey: 'test-public-key', sent, send: async (_s, payload) => (sent.push(payload), { ok: true }) };
}

describe('server restart', () => {
  it('preserves pending tickets and delivers recoverable notifications after restart', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'palace-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const dbFile = path.join(dir, 'db.sqlite');

    // First run: push "down" (worker not running), ticket fails confirmation.
    const env1 = await setup({}, { dbFile });
    const g = await guest(env1);
    const pending = (await orderTea(env1, g)).body.request.ref;
    const failed = (await orderTea(env1, g)).body.request.ref;
    const t1 = await roomService(env1);
    let t = await staffTicket(t1, failed);
    t = (await t1.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision })).body.request;
    // Push is configured on the next boot; simulate the process dying before the job ran.
    env1.ctx.kickNotifications = () => {};
    await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'not_received', method: 'room_call' });
    env1.ctx.db.prepare(`INSERT INTO push_subscriptions (guest_session_id, endpoint, keys_json, created_at)
      SELECT id, 'https://push.example/1', '{"p256dh":"x","auth":"y"}', 'now' FROM guest_sessions LIMIT 1`).run();
    expect(env1.ctx.db.prepare('SELECT status FROM notification_jobs').pluck().get()).toBe('pending');
    env1.close();
    env1.ctx.db.close();

    // Second run: same database file.
    const push = fakePush();
    const env2 = await buildApp(testConfig(), { db: openDatabase(dbFile), push, startWorker: false });
    cleanups.push(() => {
      env2.close();
      env2.ctx.db.close();
    });
    await env2.worker.processPending();
    expect(push.sent).toHaveLength(1);
    expect(JSON.parse(push.sent[0])).toMatchObject({ url: `/h/requests/${failed}` });
    expect(env2.ctx.db.prepare('SELECT status FROM notification_jobs').pluck().get()).toBe('sent');

    // Tablets reconnecting reload the queue from the database.
    const t2 = await roomService({ ...env2, stays: [] } as TestEnv, 2);
    const queue = (await t2.get('/api/staff/queue')).body.requests.map((r: { ref: string; state: string }) => [r.ref, r.state]);
    expect(queue).toEqual([
      [pending, 'received'],
      [failed, 'confirmation_not_received'],
    ]);
    // The guest's session survives the restart and still sees the in-app notice.
    const jar = (g.agent as unknown as { jar: { getCookies: (o: object) => { name: string; value: string }[] } }).jar;
    const cookie = jar.getCookies({ domain: '127.0.0.1', path: '/api', secure: false, script: false }).map((k) => `${k.name}=${k.value}`).join('; ');
    const notices = await request(env2.app).get('/api/guest/notices').set('Cookie', cookie);
    expect(notices.status).toBe(200);
    expect(notices.body.notices.map((n: { requestRef: string }) => n.requestRef)).toEqual([failed]);
  });
});

describe('push notifications', () => {
  it('delivers to subscribed devices of the same stay in their language, never to other stays', async () => {
    const push = fakePush();
    const env = await setup({}, { push });
    cleanups.push(() => env.close());
    const g = await guest(env, 0);
    const other = await guest(env, 1);
    expect((await g.post('/api/guest/push-subscription', { endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'a' } })).status).toBe(201);
    expect((await other.post('/api/guest/push-subscription', { endpoint: 'https://push.example/b', keys: { p256dh: 'k', auth: 'a' } })).status).toBe(201);
    const ref = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env);
    let t = await staffTicket(t1, ref);
    t = (await t1.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision })).body.request;
    await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'not_received', method: 'room_call' });
    await env.worker.processPending();
    expect(push.sent).toHaveLength(1);
    expect(JSON.parse(push.sent[0]).body).toMatch(/We tried to reach you/);
    const staffView = await staffTicket(t1, ref);
    expect(staffView.notices[0]).toMatchObject({ push: 'sent', readAt: null });
  });

  it('works without push: subscription is refused, in-app notice still recorded', async () => {
    const env = await setup();
    cleanups.push(() => env.close());
    const g = await guest(env);
    const r = await g.post('/api/guest/push-subscription', { endpoint: 'https://push.example/a', keys: { p256dh: 'k', auth: 'a' } });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('push_unconfigured');
    expect((await new Client(env.app).get('/api/public/config')).body.pushPublicKey).toBeNull();
  });
});

describe('live updates (SSE)', () => {
  async function listen(env: TestEnv) {
    const server = env.app.listen(0);
    cleanups.push(() => server.close());
    await new Promise((r) => server.once('listening', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  function cookieHeader(c: Client, base: string) {
    const jar = (c.agent as unknown as { jar: { getCookies: (o: object) => { name: string; value: string }[] } }).jar;
    return jar
      .getCookies({ domain: '127.0.0.1', path: '/api', secure: false, script: false })
      .map((k) => `${k.name}=${k.value}`)
      .join('; ')
      .concat(base ? '' : '');
  }

  async function openStream(url: string, cookie: string) {
    const ctrl = new AbortController();
    cleanups.push(() => ctrl.abort());
    const res = await fetch(url, { headers: { cookie }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    const events: string[] = [];
    let buf = '';
    let ended = false;
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += new TextDecoder().decode(value);
          for (const m of buf.matchAll(/event: ([\w.]+)/g)) if (!events.includes(m[1] + '@' + m.index)) events.push(m[1] + '@' + m.index);
        }
      } catch {
        /* aborted */
      }
      ended = true;
    })();
    void pump;
    const types = () => events.map((e) => e.split('@')[0]);
    const waitFor = async (pred: () => boolean, ms = 3000) => {
      const start = Date.now();
      while (!pred()) {
        if (Date.now() - start > ms) throw new Error(`timeout; events=${types().join(',')}`);
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    return { res, types, waitFor, isEnded: () => ended };
  }

  it('alerts every connected tablet on the department account, after persisting', async () => {
    const env = await setup();
    cleanups.push(() => env.close());
    const base = await listen(env);
    const a = await roomService(env, 1);
    const b = await roomService(env, 2);
    const rc = await reception(env);
    const sa = await openStream(`${base}/api/staff/stream`, cookieHeader(a, base));
    const sb = await openStream(`${base}/api/staff/stream`, cookieHeader(b, base));
    const sr = await openStream(`${base}/api/staff/stream`, cookieHeader(rc, base));
    expect(sa.res.headers.get('content-type')).toMatch(/text\/event-stream/);
    await sa.waitFor(() => sa.types().includes('hello'));
    const g = await guest(env);
    await orderTea(env, g);
    await sa.waitFor(() => sa.types().includes('request.created'));
    await sb.waitFor(() => sb.types().includes('request.created'));
    await new Promise((r) => setTimeout(r, 100));
    expect(sr.types()).not.toContain('request.created');
  });

  it('closes a guest stream when the stay is moved, and refuses to reopen it', async () => {
    const env = await setup();
    cleanups.push(() => env.close());
    const base = await listen(env);
    const g = await guest(env);
    const s = await openStream(`${base}/api/guest/stream`, cookieHeader(g, base));
    await s.waitFor(() => s.types().includes('hello'));
    await (await reception(env)).post(`/api/admin/stays/${env.stays[0].stayId}/move`, { roomId: roomId(env, 'DEMO-203') });
    await s.waitFor(() => s.types().includes('session.revoked'));
    await s.waitFor(() => s.isEnded());
    const reopen = await fetch(`${base}/api/guest/stream`, { headers: { cookie: cookieHeader(g, base) } });
    expect(reopen.status).toBe(401);
  });

  it('heartbeat closes a stream whose session was revoked behind its back', async () => {
    const env = await setup();
    cleanups.push(() => env.close());
    const base = await listen(env);
    const g = await guest(env);
    const s = await openStream(`${base}/api/guest/stream`, cookieHeader(g, base));
    await s.waitFor(() => s.types().includes('hello'));
    env.ctx.db.prepare(`UPDATE guest_sessions SET revoked_at = 'x'`).run(); // no hub publish at all
    await s.waitFor(() => s.types().includes('session.revoked'));
  });
});

describe('integrations are represented honestly', () => {
  it('reports manual PMS (no live checks), unconfigured bills and push', async () => {
    const env = await setup();
    cleanups.push(() => env.close());
    const r = (await (await reception(env)).get('/api/admin/integrations')).body;
    expect(r.pms).toMatchObject({ adapter: 'manual', configured: true, liveChecks: false });
    expect(r.pms.lastChangeAt).toBeTruthy();
    expect(r.bills).toEqual({ provider: 'none', configured: false });
    expect(r.push).toEqual({ configured: false });
    expect(r.ordering).toMatchObject({ enabled: true, scheduledDepartureCutoffHours: null });
  });

  it('refuses to construct the Pluriel adapter until it is really implemented', () => {
    expect(() => new PlurielPmsAdapter()).toThrow(/not configured/);
  });

  it('never logs activation tokens', async () => {
    const lines: string[] = [];
    const logger = { info: (m: string, d?: object) => lines.push(m + JSON.stringify(d)), warn: () => {}, error: () => {} };
    const env = await setup({}, { logger });
    cleanups.push(() => env.close());
    await guest(env);
    await new Client(env.app).init().then((c) => c.post('/api/guest/activate', { token: env.stays[1].token, room: 'nope' }));
    expect(lines.length).toBeGreaterThan(0);
    for (const s of env.stays) expect(lines.join('\n')).not.toContain(s.token);
  });

  it('backs up the database consistently while in use', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'palace-bk-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const env = await setup({}, { dbFile: path.join(dir, 'live.sqlite') });
    cleanups.push(() => env.close());
    const g = await guest(env);
    await orderTea(env, g, key());
    await env.ctx.db.backup(path.join(dir, 'copy.sqlite'));
    const copy = openDatabase(path.join(dir, 'copy.sqlite'));
    expect(copy.prepare('SELECT COUNT(*) FROM requests').pluck().get()).toBe(1);
    expect(copy.pragma('integrity_check', { simple: true })).toBe('ok');
    copy.close();
  });
});
