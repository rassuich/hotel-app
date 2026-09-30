import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  guest,
  key,
  menuItem,
  orderTea,
  poolLocation,
  reception,
  requestTowels,
  roomService,
  serviceItem,
  setup,
  staff,
  staffTicket,
  type TestEnv,
} from './helpers';

let env: TestEnv;
beforeEach(async () => {
  env = await setup();
});
afterEach(() => env.close());

/** Drives a food ticket to "confirming" (claimed by tablet `s`). */
async function claimed(s: Client, ref: string) {
  const t = await staffTicket(s, ref);
  const r = await s.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision });
  expect(r.status).toBe(200);
  return r.body.request;
}

describe('routing and scoping', () => {
  it('food goes only to Room Service and services only to Reception, of the same property', async () => {
    const g = await guest(env);
    const food = (await orderTea(env, g)).body.request.ref;
    const svc = (await requestTowels(env, g)).body.request.ref;
    const rs = await roomService(env);
    const rc = await reception(env);
    const suisse = await staff(env, 'suisse.roomservice', 'suisse-password', 'Suisse Tablet');
    const refs = async (c: Client) => (await c.get('/api/staff/queue')).body.requests.map((r: { ref: string }) => r.ref);
    expect(await refs(rs)).toEqual([food]);
    expect(await refs(rc)).toEqual([svc]);
    expect(await refs(suisse)).toEqual([]);
    const foodId = (await staffTicket(rs, food)).id;
    expect((await rc.get(`/api/staff/requests/${foodId}`)).status).toBe(404);
    expect((await suisse.post(`/api/staff/requests/${foodId}/claim`, { expectedRevision: 1 })).status).toBe(404);
  });

  it('a guest cannot read or act on another stay\'s request by ref', async () => {
    const a = await guest(env, 0);
    const b = await guest(env, 1);
    const ref = (await orderTea(env, a)).body.request.ref;
    expect((await b.get(`/api/guest/requests/${ref}`)).status).toBe(404);
    expect((await b.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() })).status).toBe(404);
    expect((await b.get('/api/guest/requests')).body.requests).toEqual([]);
  });

  it('refuses requests for properties not enabled for ordering', async () => {
    env.ctx.db.prepare(`UPDATE properties SET requests_enabled = 0 WHERE id = 'palace-anfa'`).run();
    const g = await guest(env);
    const r = await orderTea(env, g);
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('property_not_accepting');
  });

  it('admin accounts cannot work tickets and department accounts need a named device', async () => {
    const g = await guest(env);
    await orderTea(env, g);
    const noDevice = await staff(env, 'palace.roomservice', 'rs-password');
    expect((await noDevice.get('/api/staff/queue')).body.error.code).toBe('device_required');
    const adm = await staff(env, 'palace.admin', 'admin-password');
    expect((await adm.get('/api/staff/queue')).body.error.code).toBe('department_account_required');
  });
});

describe('idempotent submission', () => {
  it('a double submission / lost response creates exactly one request', async () => {
    const g = await guest(env);
    const k = key();
    const [a, b] = await Promise.all([orderTea(env, g, k), orderTea(env, g, k)]);
    const c = await orderTea(env, g, k); // retry after a "lost" response
    const refs = new Set([a.body.request.ref, b.body.request.ref, c.body.request.ref]);
    expect(refs.size).toBe(1);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(c.body.duplicate).toBe(true);
    expect(env.ctx.db.prepare('SELECT COUNT(*) FROM requests').pluck().get()).toBe(1);
  });

  it('the same key from a second device on the same stay returns the same record', async () => {
    const k = key();
    const a = await orderTea(env, await guest(env), k);
    const b = await orderTea(env, await guest(env), k);
    expect(b.body.request.ref).toBe(a.body.request.ref);
  });
});

describe('re-validated quotes', () => {
  it('explains a price change and requires acceptance before submitting', async () => {
    const g = await guest(env);
    const tea = menuItem(env, 'Mint tea');
    env.ctx.db.prepare('UPDATE food_items SET price_minor = ? WHERE id = ?').run(tea.price_minor + 500, tea.id);
    // The guest's cart still carries the old price they were shown.
    const r = await g.post('/api/guest/requests/food', {
      idempotencyKey: key(),
      lines: [{ itemId: tea.id, quantity: 2, optionIds: [], expectedUnitPriceMinor: tea.price_minor }],
      destination: { kind: 'room' },
      expectedTotalMinor: tea.price_minor * 2,
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('quote_changed');
    expect(r.body.error.details.issues[0]).toMatchObject({ issue: 'price_changed', currentUnitPriceMinor: tea.price_minor + 500 });
    const accepted = await g.post('/api/guest/requests/food', {
      idempotencyKey: key(),
      lines: [{ itemId: tea.id, quantity: 2, optionIds: [], expectedUnitPriceMinor: tea.price_minor + 500 }],
      destination: { kind: 'room' },
      expectedTotalMinor: (tea.price_minor + 500) * 2,
    });
    expect(accepted.status).toBe(201);
  });

  it('rejects unavailable items', async () => {
    const g = await guest(env);
    const dish = menuItem(env, 'Dish of the day');
    const r = await g.post('/api/guest/requests/food', {
      idempotencyKey: key(),
      lines: [{ itemId: dish.id, quantity: 1, optionIds: [] }],
      destination: { kind: 'room' },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.details.issues[0].issue).toBe('unavailable');
  });

  it('never lets a complimentary service silently gain a charge', async () => {
    const g = await guest(env);
    const towels = serviceItem(env, 'Towels');
    env.ctx.db.prepare('UPDATE service_items SET complimentary = 0, price_minor = 2000 WHERE id = ?').run(towels.id);
    const r = await requestTowels(env, g);
    expect(r.status).toBe(409);
    expect(r.body.error.details.issues[0]).toMatchObject({ issue: 'became_chargeable', currentUnitPriceMinor: 2000 });
  });

  it('keeps historical names and prices when the catalogue is edited later', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const tea = menuItem(env, 'Mint tea');
    env.ctx.db.prepare(`UPDATE food_items SET name_en = 'Renamed', price_minor = 99999 WHERE id = ?`).run(tea.id);
    const r = (await g.get(`/api/guest/requests/${ref}`)).body.request;
    expect(r.lines[0]).toMatchObject({ name: { en: 'Mint tea' }, unitPriceMinor: tea.price_minor, quantity: 2 });
    expect(r.totalMinor).toBe(tea.price_minor * 2);
    expect(r.currency).toBe('MAD');
  });

  it('validates option groups (required side for the club sandwich)', async () => {
    const g = await guest(env);
    const club = menuItem(env, 'Club sandwich');
    const r = await g.post('/api/guest/requests/food', {
      idempotencyKey: key(),
      lines: [{ itemId: club.id, quantity: 1, optionIds: [] }],
      destination: { kind: 'room' },
    });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('invalid_options');
  });
});

describe('claims', () => {
  it('two tablets claiming together yield exactly one owner; all see it', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env, 1);
    const t2 = await roomService(env, 2);
    const t = await staffTicket(t1, ref);
    const [a, b] = await Promise.all([
      t1.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision }),
      t2.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.error.code).toBe('already_claimed');
    const view = await staffTicket(t2, ref);
    expect(view.owner.name).toMatch(/Room Service Tablet [12]/);
    expect(view.state).toBe('confirming');
    expect((await g.get(`/api/guest/requests/${ref}`)).body.request.progress).toBe('confirming');
  });

  it('keeps the claim across reconnect; stale devices cannot overwrite; takeover needs a reason', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env, 1);
    const t2 = await roomService(env, 2);
    const claimedTicket = await claimed(t1, ref);
    // Tablet 1 "reconnects" (new session, same device): the claim is still there.
    const t1b = await roomService(env, 1);
    expect((await staffTicket(t1b, ref)).owner.name).toBe('Room Service Tablet 1');
    // Tablet 2 acting on a stale revision or without ownership is rejected.
    const stale = await t2.post(`/api/staff/requests/${claimedTicket.id}/confirmation`, { expectedRevision: claimedTicket.revision, outcome: 'confirmed', method: 'room_call' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('not_owner');
    expect((await t2.post(`/api/staff/requests/${claimedTicket.id}/takeover`, { expectedRevision: claimedTicket.revision, reason: '' })).status).toBe(400);
    const over = await t2.post(`/api/staff/requests/${claimedTicket.id}/takeover`, { expectedRevision: claimedTicket.revision, reason: 'Tablet 1 left the desk' });
    expect(over.status).toBe(200);
    expect(over.body.request.owner.name).toBe('Room Service Tablet 2');
    const ev = over.body.request.events.find((e: { type: string }) => e.type === 'taken_over');
    expect(ev.data).toMatchObject({ from: 'Room Service Tablet 1', reason: 'Tablet 1 left the desk' });
    // The previous owner, still holding the old revision, cannot write any more.
    const old = await t1b.post(`/api/staff/requests/${claimedTicket.id}/confirmation`, { expectedRevision: claimedTicket.revision, outcome: 'confirmed', method: 'room_call' });
    expect(old.status).toBe(409);
    const late = await t1b.post(`/api/staff/requests/${claimedTicket.id}/takeover`, { expectedRevision: claimedTicket.revision, reason: 'taking it back' });
    expect(late.body.error.code).toBe('stale_revision');
  });
});

describe('food confirmation', () => {
  it('cannot progress to fulfilment without a recorded confirmation', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env);
    const t = await claimed(t1, ref);
    const r = await t1.post(`/api/staff/requests/${t.id}/status`, { expectedRevision: t.revision, to: 'in_progress' });
    expect(r.status).toBe(409);
    const pos = await t1.post(`/api/staff/requests/${t.id}/pos`, { expectedRevision: t.revision, status: 'entered' });
    expect(pos.body.error.code).toBe('confirmation_required');
  });

  it('full happy path: call confirmation, amendment, manual POS entry, in progress, completed', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env);
    let t = await claimed(t1, ref);
    t = (await t1.post(`/api/staff/requests/${t.id}/amendment`, { expectedRevision: t.revision, note: 'Guest asked for one tea only', newTotalMinor: 4000 })).body.request;
    t = (await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'confirmed', method: 'room_call' })).body.request;
    expect(t.state).toBe('confirmed');
    expect((await g.get(`/api/guest/requests/${ref}`)).body.request).toMatchObject({ progress: 'confirmed', totalMinor: 4000, amendments: [{ note: 'Guest asked for one tea only' }] });
    t = (await t1.post(`/api/staff/requests/${t.id}/pos`, { expectedRevision: t.revision, status: 'entered', reference: 'POS-778' })).body.request;
    expect(t.pos).toMatchObject({ status: 'entered', reference: 'POS-778' });
    expect(t.state).toBe('confirmed'); // POS entry is a separate field, not a guest status
    t = (await t1.post(`/api/staff/requests/${t.id}/status`, { expectedRevision: t.revision, to: 'in_progress' })).body.request;
    t = (await t1.post(`/api/staff/requests/${t.id}/status`, { expectedRevision: t.revision, to: 'completed' })).body.request;
    expect(t.state).toBe('completed');
    expect(t.events.map((e: { type: string }) => e.type)).toEqual([
      'submitted', 'claimed', 'amended', 'confirmed', 'pos_entered', 'status_in_progress', 'status_completed',
    ]);
    expect((await g.get(`/api/guest/requests/${ref}`)).body.request.progress).toBe('delivered');
  });

  it('cancellation after POS entry requires a recorded staff decision', async () => {
    const g = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env);
    let t = await claimed(t1, ref);
    t = (await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'confirmed', method: 'room_call' })).body.request;
    t = (await t1.post(`/api/staff/requests/${t.id}/pos`, { expectedRevision: t.revision, status: 'uncertain' })).body.request;
    const no = await t1.post(`/api/staff/requests/${t.id}/close`, { expectedRevision: t.revision, outcome: 'cancelled', reason: 'Guest changed mind' });
    expect(no.body.error.code).toBe('pos_decision_required');
    const ok = await t1.post(`/api/staff/requests/${t.id}/close`, {
      expectedRevision: t.revision, outcome: 'cancelled', reason: 'Guest changed mind', posDecision: 'Voided POS ticket with supervisor',
    });
    expect(ok.body.request.state).toBe('cancelled');
    // Uncertain POS status keeps it visible for review in the open queue.
    expect((await staffTicket(t1, ref)).pos.status).toBe('uncertain');
  });
});

describe('confirmation not received and callbacks', () => {
  async function failedTicket() {
    const g = await guest(env);
    const g2 = await guest(env);
    const ref = (await orderTea(env, g)).body.request.ref;
    const t1 = await roomService(env, 1);
    let t = await claimed(t1, ref);
    t = (await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'not_received', method: 'room_call' })).body.request;
    return { g, g2, ref, t1, t };
  }

  it('prevents delivery and persists the guest notice with the outcome', async () => {
    const { g, ref, t1, t } = await failedTicket();
    expect(t.state).toBe('confirmation_not_received');
    expect(t.owner).toBeNull();
    for (const to of ['in_progress', 'completed']) {
      expect((await t1.post(`/api/staff/requests/${t.id}/status`, { expectedRevision: t.revision, to })).status).toBe(409);
    }
    const notices = (await g.get('/api/guest/notices')).body.notices;
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ kind: 'confirmation_not_received', requestRef: ref, readAt: null });
    const gr = (await g.get(`/api/guest/requests/${ref}`)).body.request;
    expect(gr).toMatchObject({ progress: 'not_reached', canRequestCallback: true });
    // Staff can see that the notice exists and whether it has been read.
    expect(t.notices[0].readAt).toBeNull();
    await g.post(`/api/guest/notices/${notices[0].id}/read`);
    expect((await staffTicket(t1, ref)).notices[0].readAt).not.toBeNull();
    // Push is not configured in tests: the outside-app channel is honestly marked as skipped,
    // while the in-app notice above remains the source of truth.
    const job = env.ctx.db.prepare('SELECT status, last_error FROM notification_jobs').get();
    expect(job).toEqual({ status: 'skipped', last_error: 'push_unconfigured' });
    expect((await staffTicket(t1, ref)).notices[0].push).toBe('skipped:push_unconfigured');
  });

  it('a callback reuses the same ticket and creates one new attempt, even under concurrent taps', async () => {
    const { g, g2, ref, t1 } = await failedTicket();
    const [a, b, c] = await Promise.all([
      g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key('a') }),
      g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key('b') }),
      g2.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key('c') }),
    ]);
    for (const r of [a, b, c]) {
      expect(r.status).toBe(200);
      expect(r.body.request.ref).toBe(ref);
      expect(r.body.attemptNo).toBe(2);
    }
    expect([a, b, c].filter((r) => !r.body.coalesced)).toHaveLength(1);
    expect(env.ctx.db.prepare('SELECT COUNT(*) FROM requests').pluck().get()).toBe(1);
    const attempts = env.ctx.db.prepare('SELECT attempt_no, status, requested_by FROM contact_attempts ORDER BY attempt_no').all();
    expect(attempts).toEqual([
      { attempt_no: 1, status: 'not_received', requested_by: 'initial' },
      { attempt_no: 2, status: 'pending', requested_by: 'guest_retry' },
    ]);
    // Department is re-alerted with the ticket available for a single new claim.
    const t = await staffTicket(t1, ref);
    expect(t.state).toBe('received');
    expect(t.owner).toBeNull();
    const t2 = await roomService(env, 2);
    const [x, y] = await Promise.all([
      t1.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision }),
      t2.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    // Same idempotency key replayed later is a no-op.
    const replay = await g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: 'same-key-000' });
    expect(replay.status).toBe(200);
    expect(env.ctx.db.prepare('SELECT COUNT(*) FROM contact_attempts').pluck().get()).toBe(2);
  });

  it('cannot reopen confirmed, POS-entered, completed or cancelled work', async () => {
    const { g, ref, t1 } = await failedTicket();
    await g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() });
    let t = await claimed(t1, ref);
    t = (await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'confirmed', method: 'room_call' })).body.request;
    const again = await g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('callback_not_allowed');
    t = (await t1.post(`/api/staff/requests/${t.id}/pos`, { expectedRevision: t.revision, status: 'entered' })).body.request;
    expect((await g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() })).status).toBe(409);
    await t1.post(`/api/staff/requests/${t.id}/close`, { expectedRevision: t.revision, outcome: 'cancelled', reason: 'test', posDecision: 'voided' });
    expect((await g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() })).status).toBe(409);
  });

  it('services cannot request a callback', async () => {
    const g = await guest(env);
    const ref = (await requestTowels(env, g)).body.request.ref;
    const r = await g.post(`/api/guest/requests/${ref}/callback`, { idempotencyKey: key() });
    expect(r.body.error.code).toBe('callback_not_allowed');
  });

  it('any tablet on the account can cancel an unanswered ticket', async () => {
    const { t } = await failedTicket();
    const t2 = await roomService(env, 2);
    const r = await t2.post(`/api/staff/requests/${t.id}/close`, { expectedRevision: t.revision, outcome: 'cancelled', reason: 'No answer after two calls' });
    expect(r.body.request.state).toBe('cancelled');
  });
});

describe('simple services', () => {
  it('need no call; housekeeping hand-off and completion are recorded separately', async () => {
    const g = await guest(env);
    const sub = await requestTowels(env, g);
    expect(sub.status).toBe(201);
    expect(sub.body.request).toMatchObject({ type: 'service', progress: 'sent', attempts: [], totalMinor: 0 });
    expect(sub.body.request.lines[0]).toMatchObject({ complimentary: true, details: 'Two large ones' });
    const rc = await reception(env);
    let t = await staffTicket(rc, sub.body.request.ref);
    t = (await rc.post(`/api/staff/requests/${t.id}/claim`, { expectedRevision: t.revision })).body.request;
    expect(t.state).toBe('being_handled');
    expect(t.housekeepingContactedAt).toBeNull();
    t = (await rc.post(`/api/staff/requests/${t.id}/housekeeping`, { expectedRevision: t.revision })).body.request;
    expect(t.housekeepingContactedAt).not.toBeNull();
    expect(t.state).toBe('being_handled');
    t = (await rc.post(`/api/staff/requests/${t.id}/status`, { expectedRevision: t.revision, to: 'completed' })).body.request;
    expect(t.state).toBe('completed');
    expect((await g.get(`/api/guest/requests/${t.ref}`)).body.request.progress).toBe('done');
  });

  it('combines several checked items into ONE ticket for Reception', async () => {
    const g = await guest(env);
    const [tb, towels, pillow, pressing] = ['Toothbrush', 'Towels', 'Extra pillow', 'Pressing (paid example)'].map((n) => serviceItem(env, n));
    const r = await g.post('/api/guest/requests/service', {
      idempotencyKey: key(),
      lines: [
        { itemId: tb.id, quantity: 2, expectedComplimentary: true },
        { itemId: towels.id, quantity: 3, details: 'Bath', expectedComplimentary: true },
        { itemId: pillow.id, quantity: 1, expectedComplimentary: true },
        { itemId: pressing.id, quantity: 1, expectedComplimentary: false, expectedUnitPriceMinor: pressing.price_minor },
      ],
      destination: { kind: 'room' },
      notes: 'After 6 pm please',
    });
    expect(r.status).toBe(201);
    expect(r.body.request.lines.map((l: { quantity: number }) => l.quantity)).toEqual([2, 3, 1, 1]);
    expect(r.body.request.totalMinor).toBe(pressing.price_minor);
    expect(env.ctx.db.prepare(`SELECT COUNT(*) FROM requests WHERE type = 'service'`).pluck().get()).toBe(1);
    const rc = await reception(env);
    const t = await staffTicket(rc, r.body.request.ref);
    expect(t.lines).toHaveLength(4);
    expect(t.notes).toBe('After 6 pm please');
  });

  it('rejects the whole order if any line changed, and duplicate lines', async () => {
    const g = await guest(env);
    const [tb, towels] = ['Toothbrush', 'Towels'].map((n) => serviceItem(env, n));
    env.ctx.db.prepare('UPDATE service_items SET available = 0 WHERE id = ?').run(towels.id);
    const changed = await g.post('/api/guest/requests/service', {
      idempotencyKey: key(),
      lines: [
        { itemId: tb.id, quantity: 1, expectedComplimentary: true },
        { itemId: towels.id, quantity: 1, expectedComplimentary: true },
      ],
      destination: { kind: 'room' },
    });
    expect(changed.status).toBe(409);
    expect(changed.body.error.details.issues).toEqual([expect.objectContaining({ index: 1, issue: 'unavailable' })]);
    const dup = await g.post('/api/guest/requests/service', {
      idempotencyKey: key(),
      lines: [
        { itemId: tb.id, quantity: 1, expectedComplimentary: true },
        { itemId: tb.id, quantity: 1, expectedComplimentary: true },
      ],
      destination: { kind: 'room' },
    });
    expect(dup.body.error.code).toBe('duplicate_item');
    expect(env.ctx.db.prepare('SELECT COUNT(*) FROM requests').pluck().get()).toBe(0);
  });

  it('enforces quantity limits', async () => {
    const g = await guest(env);
    const tb = serviceItem(env, 'Toothbrush');
    const r = await g.post('/api/guest/requests/service', {
      idempotencyKey: key(),
      lines: [{ itemId: tb.id, quantity: 9, expectedComplimentary: true }],
      destination: { kind: 'room' },
    });
    expect(r.status).toBe(409);
    expect(r.body.error.details.issues[0]).toMatchObject({ issue: 'quantity_limit', maxQuantity: 4 });
  });

  it('shows a visible fee for paid services and accepts it when acknowledged', async () => {
    const g = await guest(env);
    const pressing = serviceItem(env, 'Pressing (paid example)');
    const r = await g.post('/api/guest/requests/service', {
      idempotencyKey: key(),
      lines: [{ itemId: pressing.id, quantity: 1, expectedComplimentary: false, expectedUnitPriceMinor: pressing.price_minor }],
      destination: { kind: 'room' },
    });
    expect(r.status).toBe(201);
    expect(r.body.request.totalMinor).toBe(pressing.price_minor);
  });
});

describe('pool delivery', () => {
  it('uses configured labels and requires in-person confirmation', async () => {
    const g = await guest(env);
    const loc = poolLocation(env, 2);
    const tea = menuItem(env, 'Mint tea');
    const sub = await g.post('/api/guest/requests/food', {
      idempotencyKey: key(),
      lines: [{ itemId: tea.id, quantity: 1, optionIds: [] }],
      destination: { kind: 'pool', locationId: loc.id },
    });
    expect(sub.status).toBe(201);
    expect(sub.body.request.destination).toMatchObject({ kind: 'pool', label: { en: 'Pool – Lounger L2 (demo)' } });
    const t1 = await roomService(env);
    let t = await claimed(t1, sub.body.request.ref);
    expect((await g.get(`/api/guest/requests/${t.ref}`)).body.request.progress).toBe('confirming_in_person');
    const wrong = await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'confirmed', method: 'room_call' });
    expect(wrong.body.error.code).toBe('invalid_confirmation_method');
    t = (await t1.post(`/api/staff/requests/${t.id}/confirmation`, { expectedRevision: t.revision, outcome: 'confirmed', method: 'in_person' })).body.request;
    expect(t.confirmation).toMatchObject({ method: 'in_person', result: 'confirmed' });
    expect(t.attempts[0]).toMatchObject({ status: 'confirmed', method: 'in_person' });
  });

  it('rejects inactive or foreign locations', async () => {
    const g = await guest(env);
    const loc = poolLocation(env, 1);
    env.ctx.db.prepare('UPDATE delivery_locations SET active = 0 WHERE id = ?').run(loc.id);
    const tea = menuItem(env, 'Mint tea');
    const r = await g.post('/api/guest/requests/food', {
      idempotencyKey: key(),
      lines: [{ itemId: tea.id, quantity: 1, optionIds: [] }],
      destination: { kind: 'pool', locationId: loc.id },
    });
    expect(r.body.error.code).toBe('invalid_destination');
  });
});
