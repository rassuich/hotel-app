import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { admin, guest, key, orderTea, reception, requestTowels, roomId, roomService, setup, staffTicket, tokenFromUrl, type TestEnv } from './helpers';
import { clock } from '../src/lib/clock';
import type { BillProvider } from '../src/bills/provider';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});
afterEach(() => {
  clock.now = () => new Date();
  env.close();
});

async function failTicket(ref: string) {
  const t1 = await roomService(env);
  let t = await staffTicket(t1, ref);
  t = (await t1.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision })).body.request;
  t = (await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'not_received', method: 'room_call' })).body.request;
  return { t1, t };
}

describe('room move', () => {
  it('revokes old sessions and QR, issues a new QR, and flags unfinished tickets', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const { t1, t } = await failTicket(ref);
    const desk = await reception(env);
    const move = await desk.post(`/api/admin/stays/${env.stays[0].stayId}/move`, { roomId: roomId(env, 'DEMO-201') });
    expect(move.status).toBe(200);
    const newToken = tokenFromUrl(move.body.qr.url);

    // Old page/device: every private call is rejected, including the callback.
    const me = await g.get('/api/guest/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('session_revoked');
    expect(String(me.headers['set-cookie'])).toMatch(/pa_guest=;/); // cookie cleared
    expect((await g.get('/api/guest/me')).body.error.code).toBe('not_activated');
    expect((await g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() })).status).toBe(401);
    expect((await orderTea(env, g)).status).toBe(401);

    // Old QR no longer activates, even with the old or the new room number.
    for (const room of ['DEMO-101', 'DEMO-201']) {
      await expect(guest(env, 0, env.stays[0].token, room)).rejects.toThrow(/activation failed: 401/);
    }
    // New QR requires the new room.
    await expect(guest(env, 0, newToken, 'DEMO-101')).rejects.toThrow();
    const g2 = await guest(env, 0, newToken, 'DEMO-201');
    expect((await g2.get('/api/guest/me')).body.me.roomLabel).toBe('DEMO-201');

    // The unfinished ticket is flagged; its original destination is kept.
    const flagged = await staffTicket(t1, ref);
    expect(flagged.attention).toMatchObject({ flag: 'room_moved', detail: 'DEMO-101 → DEMO-201' });
    expect(flagged.originalDestination.label.en).toBe('Room DEMO-101');
    expect(flagged.currentDestination.label.en).toBe('Room DEMO-101');

    // The new session cannot trigger a callback to the old room until staff resolve it.
    const cb = await g2.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() });
    expect(cb.status).toBe(409);
    expect((await g2.get(`/api/guest/requests/${ref}`)).body.request.canRequestCallback).toBe(false);

    // Staff review: point the ticket at the current room; then the guest may ask for a callback.
    const resolved = await t1.post(`/api/staff/requests/${t.id}/resolve-attention`, {
      expectedRevision: flagged.revision,
      note: 'Guest confirmed new room at desk',
      useCurrentRoom: true,
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.request.currentDestination.label.en).toBe('Room DEMO-201');
    expect(resolved.body.request.originalDestination.label.en).toBe('Room DEMO-101');
    const ok = await g2.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() });
    expect(ok.status).toBe(200);
  });

  it('blocks staff confirmation on a ticket whose room changed', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env);
    let t = await staffTicket(t1, ref);
    t = (await t1.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision })).body.request;
    await (await reception(env)).post(`/api/admin/stays/${env.stays[0].stayId}/move`, { roomId: roomId(env, 'DEMO-202') });
    t = await staffTicket(t1, ref);
    const r = await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'confirmed', method: 'room_call' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('room_changed');
  });

  it('refuses to move into an occupied room', async () => {
    const desk = await reception(env);
    const r = await desk.post(`/api/admin/stays/${env.stays[0].stayId}/move`, { roomId: roomId(env, 'DEMO-102') });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('room_occupied');
  });
});

describe('checkout', () => {
  it('blocks submission and callback immediately, even from an old open page', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    await failTicket(ref);
    const confirmedRef = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env);
    let c = await staffTicket(t1, confirmedRef);
    c = (await t1.post(`/api/staff/requests/${c.id}/claim`, { expectedRevision: c.revision })).body.request;
    c = (await t1.post(`/api/staff/requests/${c.id}/confirmation`, { expectedRevision: c.revision, outcome: 'confirmed', method: 'room_call' })).body.request;

    const desk = await reception(env);
    expect((await desk.post(`/api/admin/stays/${env.stays[0].stayId}/checkout`)).status).toBe(200);

    // The same browser session (old page still open) can no longer order or retry.
    const sub = await orderTea(env, g);
    expect(sub.status).toBe(403);
    expect(sub.body.error.code).toBe('post_stay_only');
    const cb = await g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() });
    expect(cb.status).toBe(403);
    expect((await g.get('/api/guest/requests')).status).toBe(403);
    const me = (await g.get('/api/guest/me')).body.me;
    expect(me).toMatchObject({ capability: 'post_stay', stayStatus: 'checked_out', canOrder: false, orderingBlockedReason: 'stay_checked_out', roomLabel: null });

    // The QR can no longer create ordering sessions.
    await expect(guest(env, 0)).rejects.toThrow(/401/);

    // Outstanding work is preserved and flagged, never discarded.
    const confirmed = await staffTicket(t1, confirmedRef);
    expect(confirmed.state).toBe('confirmed');
    expect(confirmed.attention.flag).toBe('checked_out');
    expect(confirmed.stayStatus).toBe('checked_out');
    const blocked = await t1.post(`/api/staff/requests/${confirmed.id}/status`, { expectedRevision: confirmed.revision, to: 'in_progress' });
    expect(blocked.body.error.code).toBe('attention_required');
  });

  it('keeps a restricted, expiring bill-area capability that is separate from ordering', async () => {
    const g = await guest(env);
    await (await reception(env)).post(`/api/admin/stays/${env.stays[0].stayId}/checkout`);
    const bill = await g.get('/api/guest/bill');
    expect(bill.status).toBe(200);
    expect(bill.body.bill).toEqual({ status: 'unconfigured', fallback: 'contact_reception' });
    expect((await g.get('/api/guest/notices')).status).toBe(403);
    expect((await g.get('/api/guest/catalog/menu')).status).toBe(403);
    // After the configured post-stay window the session is gone entirely.
    clock.now = () => new Date(Date.now() + (env.ctx.config.postStayAccessHours + 1) * 3600_000);
    expect((await g.get('/api/guest/bill')).status).toBe(401);
  });

  it('can revoke all sessions at checkout when post-stay access is disabled', async () => {
    env.close();
    env = await setup({ postStayAccessHours: 0 });
    const g = await guest(env);
    await (await reception(env)).post(`/api/admin/stays/${env.stays[0].stayId}/checkout`);
    expect((await g.get('/api/guest/bill')).status).toBe(401);
  });

  it('shows real folio content only with a configured provider AND explicit authorization', async () => {
    env.close();
    const provider: BillProvider = {
      id: 'fake',
      configured: true,
      getBill: async () => ({ currency: 'MAD', lines: [], balanceMinor: 0, asOf: 'now', source: 'fake' }),
    };
    env = await setup({}, { bills: provider });
    const roommate = await guest(env);
    expect((await roommate.get('/api/guest/bill')).body.bill.status).toBe('not_authorized');
    env.ctx.db.prepare('UPDATE guest_sessions SET bill_access = 1 WHERE rowid = (SELECT MAX(rowid) FROM guest_sessions)').run();
    const holder = roommate; // the last-created session is this one
    expect((await holder.get('/api/guest/bill')).body.bill.status).toBe('available');
    const other = await guest(env);
    expect((await other.get('/api/guest/bill')).body.bill.status).toBe('not_authorized');
  });
});

describe('room reuse and occupant changes', () => {
  it('a reused room exposes none of the previous stay\'s data', async () => {
    const prev = await guest(env);
    const ref = (await orderTea(env, prev)).body.request.ref;
    await requestTowels(env, prev);
    const desk = await reception(env);
    await desk.post(`/api/admin/stays/${env.stays[0].stayId}/checkout`);
    const created = await desk.post('/api/admin/stays', { guestName: 'Next Guest', roomId: roomId(env, 'DEMO-101'), occupants: 1 });
    expect(created.status).toBe(201);
    const next = await guest(env, 0, tokenFromUrl(created.body.qr.url), 'DEMO-101');
    expect((await next.get('/api/guest/requests')).body.requests).toEqual([]);
    expect((await next.get('/api/guest/notices')).body.notices).toEqual([]);
    expect((await next.get(`/api/guest/requests/${ref}`)).status).toBe(404);
    // And the previous stay's session cannot see the new stay's requests.
    const newRef = (await orderTea(env, next)).body.request.ref;
    expect((await prev.get(`/api/guest/requests/${newRef}`)).status).toBe(403);
  });

  it('occupant change rotates the QR and signs out every device by default', async () => {
    const a = await guest(env);
    const desk = await reception(env);
    const r = await desk.post(`/api/admin/stays/${env.stays[0].stayId}/rotate-qr`, { reason: 'occupant_change' });
    expect(r.body.revokedSessions).toBe(true);
    expect((await a.get('/api/guest/me')).status).toBe(401);
    await expect(guest(env, 0)).rejects.toThrow();
    await expect(guest(env, 0, tokenFromUrl(r.body.qr.url))).resolves.toBeTruthy();
  });

  it('a reprint rotates the QR but keeps devices signed in', async () => {
    const a = await guest(env);
    const r = await (await reception(env)).post(`/api/admin/stays/${env.stays[0].stayId}/rotate-qr`, { reason: 'reprint' });
    expect(r.body.revokedSessions).toBe(false);
    expect((await a.get('/api/guest/me')).status).toBe(200);
    await expect(guest(env, 0)).rejects.toThrow();
  });

  it('room service accounts cannot manage stays; admin and reception can', async () => {
    const rs = await roomService(env);
    expect((await rs.get('/api/admin/stays')).status).toBe(403);
    expect((await (await admin(env)).get('/api/admin/stays')).status).toBe(200);
    expect((await (await reception(env)).get('/api/admin/content')).status).toBe(403);
  });
});

describe('scheduled departures', () => {
  it('shows overdue departures to staff without blocking ordering by default', async () => {
    const desk = await reception(env);
    const past = new Date(Date.now() - 3600_000).toISOString();
    await desk.patch(`/api/admin/stays/${env.stays[1].stayId}`, { scheduledDeparture: past });
    const overdue = (await desk.get('/api/admin/stays?filter=overdue')).body.stays;
    expect(overdue.map((s: { id: string }) => s.id)).toEqual([env.stays[1].stayId]);
    const g = await guest(env, 1);
    expect((await orderTea(env, g)).status).toBe(201);
  });

  it('applies an explicit, configurable cutoff when enabled', async () => {
    env.close();
    env = await setup({ scheduledDepartureCutoffHours: 2 });
    const desk = await reception(env);
    await desk.patch(`/api/admin/stays/${env.stays[1].stayId}`, { scheduledDeparture: new Date(Date.now() - 3 * 3600_000).toISOString() });
    const g = await guest(env, 1);
    const r = await orderTea(env, g);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('scheduled_departure_passed');
  });
});
