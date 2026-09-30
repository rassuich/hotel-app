import type { AppContext } from '../context';
import type { DB } from '../db';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../lib/errors';
import { nowIso } from '../lib/clock';
import { channels } from '../live/hub';
import { currentAssignment, getStay, latestAssignment, type RequestRow } from './rows';
import { orderingBlockReason } from './stays';
import type { GuestContext } from './guestAuth';
import { quoteFood, quoteService, type FoodLineInput, type Quote, type ServiceLineInput } from './catalogue';
import {
  canStaffMoveTo,
  departmentFor,
  guestProgress,
  isTerminal,
  type RequestState,
  type RequestType,
} from '../../../shared/src/states';
import type {
  ContactAttemptDto,
  Destination,
  GuestNoticeDto,
  GuestRequestDto,
  RequestLine,
  StaffRequestDto,
} from '../../../shared/src/api';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export interface StaffActor {
  accountId: string;
  propertyId: string;
  deviceId: number;
  deviceName: string;
}

function addEvent(
  db: DB,
  requestId: number,
  type: string,
  actor: { type: 'guest' | 'device' | 'staff' | 'system'; id?: string | number | null; label: string },
  data: Record<string, unknown> = {},
) {
  db.prepare(
    `INSERT INTO request_events (request_id, type, actor_type, actor_id, actor_label, data_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(requestId, type, actor.type, actor.id === undefined || actor.id === null ? null : String(actor.id), actor.label, JSON.stringify(data), nowIso());
}

const deviceActor = (s: StaffActor) => ({ type: 'device' as const, id: s.deviceId, label: s.deviceName });
const guestActor = (g: GuestContext) => ({ type: 'guest' as const, id: g.session.id.slice(0, 8), label: 'Guest' });

function getRequest(db: DB, id: number): RequestRow | undefined {
  return db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as RequestRow | undefined;
}

function allocateRef(db: DB, propertyId: string): string {
  const row = db
    .prepare('UPDATE properties SET next_ref = next_ref + 1 WHERE id = ? RETURNING ref_prefix, next_ref - 1 AS n')
    .get(propertyId) as { ref_prefix: string; n: number };
  return `${row.ref_prefix}-${String(row.n).padStart(4, '0')}`;
}

function departmentAccountId(db: DB, propertyId: string, type: RequestType): string {
  const id = db
    .prepare(`SELECT id FROM department_accounts WHERE property_id = ? AND role = ? AND active = 1`)
    .pluck()
    .get(propertyId, departmentFor(type)) as string | undefined;
  if (!id) throw new ApiError(503, 'department_unavailable');
  return id;
}

function publishChange(ctx: AppContext, r: Pick<RequestRow, 'id' | 'department_account_id' | 'stay_id'>, type = 'request.updated') {
  const row = getRequest(ctx.db, r.id);
  ctx.hub.publish(channels.department(r.department_account_id), { type, requestId: r.id, revision: row?.revision });
  ctx.hub.publish(channels.stay(r.stay_id), { type: 'requests.changed', ref: row?.ref });
}

// ---------------------------------------------------------------------------
// Guest: submission
// ---------------------------------------------------------------------------

export type DestinationInput = { kind: 'room' } | { kind: 'pool'; locationId: number };

function resolveDestination(ctx: AppContext, g: GuestContext, input: DestinationInput): Destination {
  if (input.kind === 'room') {
    const a = currentAssignment(ctx.db, g.stay.id);
    if (!a) throw conflict('room_changed');
    return { kind: 'room', roomId: a.room_id, label: { fr: `Chambre ${a.room_label}`, en: `Room ${a.room_label}` } };
  }
  const loc = ctx.db
    .prepare('SELECT * FROM delivery_locations WHERE id = ? AND property_id = ? AND active = 1')
    .get(input.locationId, g.property.id) as Record<string, any> | undefined;
  if (!loc) throw badRequest('invalid_destination');
  return { kind: 'pool', locationId: loc.id, label: { fr: loc.label_fr, en: loc.label_en } };
}

function assertCanOrder(ctx: AppContext, g: GuestContext) {
  const reason = orderingBlockReason(ctx, {
    property: g.property,
    stay: g.stay,
    capability: g.session.capability,
    sessionRevision: g.session.assignment_revision,
  });
  if (reason) throw forbidden(reason);
}

function findByIdempotency(db: DB, stayId: string, key: string): RequestRow | undefined {
  return db.prepare('SELECT * FROM requests WHERE stay_id = ? AND idempotency_key = ?').get(stayId, key) as RequestRow | undefined;
}

function insertRequest(
  ctx: AppContext,
  g: GuestContext,
  args: { type: RequestType; quote: Quote; destination: Destination; notes: string | null; idempotencyKey: string },
): RequestRow {
  const { db } = ctx;
  const now = nowIso();
  const assignment = currentAssignment(db, g.stay.id)!;
  const ref = allocateRef(db, g.property.id);
  const dest = JSON.stringify(args.destination);
  const info = db
    .prepare(
      `INSERT INTO requests (ref, property_id, stay_id, assignment_revision, type, department_account_id, state,
         original_destination, current_destination, destination_kind, notes, total_minor, currency, idempotency_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      ref,
      g.property.id,
      g.stay.id,
      assignment.revision,
      args.type,
      departmentAccountId(db, g.property.id, args.type),
      dest,
      dest,
      args.destination.kind,
      args.notes,
      args.quote.totalMinor,
      args.quote.currency,
      args.idempotencyKey,
      now,
      now,
    );
  const id = Number(info.lastInsertRowid);
  const lineStmt = db.prepare(
    `INSERT INTO request_lines (request_id, line_no, item_kind, item_id, name_fr, name_en, options_json, unit_price_minor, quantity, line_total_minor, complimentary, details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  args.quote.lines.forEach((l, i) =>
    lineStmt.run(id, i + 1, l.itemKind, l.itemId, l.nameFr, l.nameEn, JSON.stringify(l.options), l.unitPriceMinor, l.quantity, l.lineTotalMinor, l.complimentary ? 1 : 0, l.details),
  );
  if (args.type === 'food') {
    db.prepare(`INSERT INTO contact_attempts (request_id, attempt_no, requested_by, status, created_at) VALUES (?, 1, 'initial', 'pending', ?)`).run(id, now);
  }
  addEvent(db, id, 'submitted', guestActor(g), { destination: args.destination.kind, totalMinor: args.quote.totalMinor });
  return getRequest(db, id)!;
}

export interface SubmitResult {
  request: RequestRow;
  duplicate: boolean;
}

function submit(
  ctx: AppContext,
  g: GuestContext,
  type: RequestType,
  idempotencyKey: string,
  build: () => { quote: Quote; destination: Destination; notes: string | null },
): SubmitResult {
  const { db } = ctx;
  const result = db.transaction((): SubmitResult => {
    // A retried submission (lost response, double tap) returns the original record.
    const existing = findByIdempotency(db, g.stay.id, idempotencyKey);
    if (existing) {
      if (existing.type !== type) throw conflict('idempotency_key_reused');
      return { request: existing, duplicate: true };
    }
    assertCanOrder(ctx, g);
    const { quote, destination, notes } = build();
    if (quote.issues.length > 0) throw conflict('quote_changed', { issues: quote.issues, totalMinor: quote.totalMinor });
    if (quote.lines.length === 0) throw badRequest('empty_request');
    return { request: insertRequest(ctx, g, { type, quote, destination, notes, idempotencyKey }), duplicate: false };
  })();
  if (!result.duplicate) publishChange(ctx, result.request, 'request.created');
  return result;
}

export function submitFood(
  ctx: AppContext,
  g: GuestContext,
  body: { idempotencyKey: string; lines: FoodLineInput[]; destination: DestinationInput; notes?: string | null; expectedTotalMinor?: number },
): SubmitResult {
  return submit(ctx, g, 'food', body.idempotencyKey, () => {
    const quote = quoteFood(ctx.db, g.property.id, g.property.currency, body.lines);
    if (body.expectedTotalMinor !== undefined && quote.issues.length === 0 && body.expectedTotalMinor !== quote.totalMinor) {
      quote.issues.push({ index: -1, itemId: 0, issue: 'price_changed', quotedUnitPriceMinor: body.expectedTotalMinor, currentUnitPriceMinor: quote.totalMinor });
    }
    return { quote, destination: resolveDestination(ctx, g, body.destination), notes: body.notes?.trim() || null };
  });
}

export function submitService(
  ctx: AppContext,
  g: GuestContext,
  body: { idempotencyKey: string; line: ServiceLineInput; destination: DestinationInput; notes?: string | null },
): SubmitResult {
  return submit(ctx, g, 'service', body.idempotencyKey, () => ({
    quote: quoteService(ctx.db, g.property.id, g.property.currency, body.line),
    destination: resolveDestination(ctx, g, body.destination),
    notes: body.notes?.trim() || null,
  }));
}

// ---------------------------------------------------------------------------
// Guest: "Request another confirmation call" (same ticket, one new attempt)
// ---------------------------------------------------------------------------

export function requestCallback(ctx: AppContext, g: GuestContext, ref: string, idempotencyKey: string): { request: RequestRow; attemptNo: number; coalesced: boolean } {
  const { db } = ctx;
  const out = db.transaction(() => {
    const r = db.prepare('SELECT * FROM requests WHERE ref = ? AND stay_id = ?').get(ref, g.stay.id) as RequestRow | undefined;
    if (!r) throw notFound('request_not_found');
    assertCanOrder(ctx, g);
    if (r.type !== 'food') throw conflict('callback_not_allowed');
    const sameKey = db
      .prepare('SELECT attempt_no FROM contact_attempts WHERE request_id = ? AND idempotency_key = ?')
      .get(r.id, idempotencyKey) as { attempt_no: number } | undefined;
    if (sameKey) return { request: r, attemptNo: sameKey.attempt_no, coalesced: true };
    const pendingRetry = db
      .prepare(`SELECT attempt_no FROM contact_attempts WHERE request_id = ? AND status = 'pending' AND requested_by = 'guest_retry'`)
      .get(r.id) as { attempt_no: number } | undefined;
    // A second device / double tap while a retry is already pending joins that attempt.
    if (pendingRetry && (r.state === 'received' || r.state === 'confirming')) return { request: r, attemptNo: pendingRetry.attempt_no, coalesced: true };
    if (r.state !== 'confirmation_not_received' || r.attention_flag) throw conflict('callback_not_allowed', { state: r.state });
    const a = currentAssignment(db, g.stay.id);
    if (!a || a.revision !== r.assignment_revision) throw conflict('room_changed');
    const now = nowIso();
    const attemptNo = ((db.prepare('SELECT MAX(attempt_no) FROM contact_attempts WHERE request_id = ?').pluck().get(r.id) as number) ?? 0) + 1;
    db.prepare(
      `INSERT INTO contact_attempts (request_id, attempt_no, requested_by, status, idempotency_key, created_at) VALUES (?, ?, 'guest_retry', 'pending', ?, ?)`,
    ).run(r.id, attemptNo, idempotencyKey, now);
    const upd = db
      .prepare(
        `UPDATE requests SET state = 'received', owner_device_id = NULL, claimed_at = NULL, confirmation_result = NULL, confirmation_method = NULL,
           revision = revision + 1, updated_at = ? WHERE id = ? AND state = 'confirmation_not_received'`,
      )
      .run(now, r.id);
    if (upd.changes !== 1) throw conflict('callback_not_allowed');
    addEvent(db, r.id, 'callback_requested', guestActor(g), { attemptNo });
    return { request: getRequest(db, r.id)!, attemptNo, coalesced: false };
  })();
  if (!out.coalesced) publishChange(ctx, out.request, 'request.callback');
  return out;
}

// ---------------------------------------------------------------------------
// Staff operations. Every write checks department scope + expected revision.
// ---------------------------------------------------------------------------

function loadForStaff(db: DB, actor: Pick<StaffActor, 'accountId' | 'propertyId'>, id: number): RequestRow {
  const r = getRequest(db, id);
  if (!r || r.department_account_id !== actor.accountId || r.property_id !== actor.propertyId) throw notFound('request_not_found');
  return r;
}

function checkRevision(r: RequestRow, expected: number) {
  if (r.revision !== expected) throw conflict('stale_revision', { currentRevision: r.revision });
}

function requireOwner(r: RequestRow, actor: StaffActor) {
  if (r.owner_device_id !== actor.deviceId) throw conflict('not_owner');
}

function bump(db: DB, id: number, set: string, params: unknown[], expectedRevision: number) {
  const res = db
    .prepare(`UPDATE requests SET ${set}, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?`)
    .run(...params, nowIso(), id, expectedRevision);
  if (res.changes !== 1) throw conflict('stale_revision');
}

function staffTx<T>(ctx: AppContext, actor: StaffActor, id: number, fn: (r: RequestRow) => T): RequestRow {
  const r0 = ctx.db.transaction(() => {
    const r = loadForStaff(ctx.db, actor, id);
    fn(r);
    return getRequest(ctx.db, id)!;
  })();
  publishChange(ctx, r0);
  return r0;
}

/** Atomic conditional claim: exactly one device wins, even for simultaneous taps. */
export function claim(ctx: AppContext, actor: StaffActor, id: number, expectedRevision: number): RequestRow {
  return staffTx(ctx, actor, id, (r) => {
    if (isTerminal(r.state) || r.state === 'confirmation_not_received') throw conflict('invalid_transition', { state: r.state });
    const next = r.state === 'received' ? (r.type === 'food' ? 'confirming' : 'being_handled') : r.state;
    const now = nowIso();
    const res = ctx.db
      .prepare(
        `UPDATE requests SET owner_device_id = ?, claimed_at = ?, state = ?, revision = revision + 1, updated_at = ?
         WHERE id = ? AND owner_device_id IS NULL AND revision = ?`,
      )
      .run(actor.deviceId, now, next, now, r.id, expectedRevision);
    if (res.changes !== 1) {
      const cur = getRequest(ctx.db, r.id)!;
      if (cur.owner_device_id !== null) throw conflict('already_claimed', { ownerDeviceId: cur.owner_device_id, currentRevision: cur.revision });
      throw conflict('stale_revision', { currentRevision: cur.revision });
    }
    ctx.db.prepare(`UPDATE contact_attempts SET device_id = ? WHERE request_id = ? AND status = 'pending'`).run(actor.deviceId, r.id);
    addEvent(ctx.db, r.id, 'claimed', deviceActor(actor), { state: next });
  });
}

/** Explicit takeover by another device on the same department account, with a recorded reason. */
export function takeover(ctx: AppContext, actor: StaffActor, id: number, expectedRevision: number, reason: string): RequestRow {
  return staffTx(ctx, actor, id, (r) => {
    checkRevision(r, expectedRevision);
    if (isTerminal(r.state)) throw conflict('invalid_transition', { state: r.state });
    if (r.owner_device_id === null) throw conflict('not_claimed');
    if (r.owner_device_id === actor.deviceId) throw conflict('already_owner');
    const previous = ctx.db.prepare('SELECT name FROM devices WHERE id = ?').pluck().get(r.owner_device_id) as string;
    bump(ctx.db, r.id, 'owner_device_id = ?, claimed_at = ?', [actor.deviceId, nowIso()], expectedRevision);
    ctx.db.prepare(`UPDATE contact_attempts SET device_id = ? WHERE request_id = ? AND status = 'pending'`).run(actor.deviceId, r.id);
    addEvent(ctx.db, r.id, 'taken_over', deviceActor(actor), { from: previous, reason });
  });
}

/** Stay must still be active in the ticket's room revision for confirmation to count. */
function assertStayEligibleForConfirmation(db: DB, r: RequestRow) {
  const stay = getStay(db, r.stay_id)!;
  if (stay.status !== 'active') throw conflict('stay_checked_out');
  const a = currentAssignment(db, stay.id);
  if (!a || a.revision !== r.assignment_revision) throw conflict('room_changed');
  if (r.attention_flag) throw conflict('attention_required');
}

export function recordConfirmation(
  ctx: AppContext,
  actor: StaffActor,
  id: number,
  body: { expectedRevision: number; outcome: 'confirmed' | 'not_received'; method: 'room_call' | 'in_person' },
): RequestRow {
  let noticeCreated = false;
  const r1 = staffTx(ctx, actor, id, (r) => {
    checkRevision(r, body.expectedRevision);
    if (r.type !== 'food') throw conflict('invalid_transition');
    if (r.state !== 'confirming') throw conflict('invalid_transition', { state: r.state });
    requireOwner(r, actor);
    const expectedMethod = r.destination_kind === 'pool' ? 'in_person' : 'room_call';
    if (body.method !== expectedMethod) throw badRequest('invalid_confirmation_method', { expected: expectedMethod });
    const now = nowIso();
    if (body.outcome === 'confirmed') {
      assertStayEligibleForConfirmation(ctx.db, r);
      bump(ctx.db, r.id, `state = 'confirmed', confirmation_method = ?, confirmation_result = 'confirmed', confirmed_at = ?`, [body.method, now], body.expectedRevision);
      ctx.db
        .prepare(`UPDATE contact_attempts SET status = 'confirmed', method = ?, device_id = ?, resolved_at = ? WHERE request_id = ? AND status = 'pending'`)
        .run(body.method, actor.deviceId, now, r.id);
      addEvent(ctx.db, r.id, 'confirmed', deviceActor(actor), { method: body.method });
    } else {
      // Outcome and guest notice are persisted together, in one transaction.
      bump(
        ctx.db,
        r.id,
        `state = 'confirmation_not_received', confirmation_method = ?, confirmation_result = 'not_received', owner_device_id = NULL, claimed_at = NULL`,
        [body.method],
        body.expectedRevision,
      );
      ctx.db
        .prepare(`UPDATE contact_attempts SET status = 'not_received', method = ?, device_id = ?, resolved_at = ? WHERE request_id = ? AND status = 'pending'`)
        .run(body.method, actor.deviceId, now, r.id);
      const notice = ctx.db
        .prepare(`INSERT INTO guest_notices (stay_id, request_id, kind, params_json, created_at) VALUES (?, ?, 'confirmation_not_received', ?, ?)`)
        .run(r.stay_id, r.id, JSON.stringify({ ref: r.ref, method: body.method }), now);
      ctx.db
        .prepare(`INSERT INTO notification_jobs (notice_id, channel, status, created_at, updated_at) VALUES (?, 'web_push', 'pending', ?, ?)`)
        .run(notice.lastInsertRowid, now, now);
      addEvent(ctx.db, r.id, 'confirmation_not_received', deviceActor(actor), { method: body.method, noticeId: Number(notice.lastInsertRowid) });
      noticeCreated = true;
    }
  });
  if (noticeCreated) {
    ctx.hub.publish(channels.stay(r1.stay_id), { type: 'notice.created', ref: r1.ref });
    ctx.kickNotifications();
  }
  return r1;
}

/** Records a guest-approved change agreed during the confirmation call. Original lines stay immutable. */
export function recordAmendment(ctx: AppContext, actor: StaffActor, id: number, body: { expectedRevision: number; note: string; newTotalMinor?: number }): RequestRow {
  return staffTx(ctx, actor, id, (r) => {
    checkRevision(r, body.expectedRevision);
    if (r.type !== 'food' || !['confirming', 'confirmed'].includes(r.state)) throw conflict('invalid_transition', { state: r.state });
    requireOwner(r, actor);
    const newTotal = body.newTotalMinor ?? r.total_minor;
    bump(ctx.db, r.id, 'total_minor = ?', [newTotal], body.expectedRevision);
    addEvent(ctx.db, r.id, 'amended', deviceActor(actor), { note: body.note, previousTotalMinor: r.total_minor, newTotalMinor: newTotal });
  });
}

/** Manual POS entry is a separate field; the app cannot verify it happened exactly once. */
export function recordPos(
  ctx: AppContext,
  actor: StaffActor,
  id: number,
  body: { expectedRevision: number; status: 'entered' | 'uncertain' | 'not_entered'; reference?: string | null },
): RequestRow {
  return staffTx(ctx, actor, id, (r) => {
    checkRevision(r, body.expectedRevision);
    if (r.type !== 'food') throw conflict('invalid_transition');
    if (r.confirmation_result !== 'confirmed') throw conflict('confirmation_required');
    requireOwner(r, actor);
    bump(ctx.db, r.id, 'pos_status = ?, pos_reference = ?, pos_updated_at = ?', [body.status, body.reference?.trim() || null, nowIso()], body.expectedRevision);
    addEvent(ctx.db, r.id, 'pos_' + body.status, deviceActor(actor), { reference: body.reference ?? null });
  });
}

export function recordHousekeeping(ctx: AppContext, actor: StaffActor, id: number, expectedRevision: number): RequestRow {
  return staffTx(ctx, actor, id, (r) => {
    checkRevision(r, expectedRevision);
    if (r.type !== 'service' || r.state !== 'being_handled') throw conflict('invalid_transition', { state: r.state });
    requireOwner(r, actor);
    bump(ctx.db, r.id, 'housekeeping_contacted_at = ?', [nowIso()], expectedRevision);
    addEvent(ctx.db, r.id, 'housekeeping_contacted', deviceActor(actor));
  });
}

export function moveStatus(ctx: AppContext, actor: StaffActor, id: number, body: { expectedRevision: number; to: RequestState }): RequestRow {
  return staffTx(ctx, actor, id, (r) => {
    checkRevision(r, body.expectedRevision);
    requireOwner(r, actor);
    if (!canStaffMoveTo(r.type, r.state, body.to)) throw conflict('invalid_transition', { from: r.state, to: body.to });
    // Food never reaches fulfilment without a recorded confirmation.
    if (r.type === 'food' && r.confirmation_result !== 'confirmed') throw conflict('confirmation_required');
    if (r.attention_flag) throw conflict('attention_required');
    const closing = body.to === 'completed';
    bump(ctx.db, r.id, closing ? 'state = ?, closed_at = ?' : 'state = ?', closing ? [body.to, nowIso()] : [body.to], body.expectedRevision);
    addEvent(ctx.db, r.id, 'status_' + body.to, deviceActor(actor));
  });
}

export function closeRequest(
  ctx: AppContext,
  actor: StaffActor,
  id: number,
  body: { expectedRevision: number; outcome: 'rejected' | 'cancelled'; reason: string; posDecision?: string | null },
): RequestRow {
  return staffTx(ctx, actor, id, (r) => {
    checkRevision(r, body.expectedRevision);
    if (isTerminal(r.state)) throw conflict('invalid_transition', { state: r.state });
    // An unowned failed-confirmation ticket can be closed by any device on the account.
    if (!(r.state === 'confirmation_not_received' && r.owner_device_id === null)) requireOwner(r, actor);
    if (body.outcome === 'rejected' && ['confirmed', 'in_progress'].includes(r.state)) throw conflict('invalid_transition', { state: r.state });
    // The app cannot amend the external POS ticket: a staff decision must be recorded.
    if (r.pos_status !== 'not_entered' && !body.posDecision?.trim()) throw badRequest('pos_decision_required');
    const now = nowIso();
    bump(ctx.db, r.id, 'state = ?, close_reason = ?, closed_at = ?', [body.outcome, body.reason, now], body.expectedRevision);
    ctx.db.prepare(`UPDATE contact_attempts SET status = 'superseded', resolved_at = ? WHERE request_id = ? AND status = 'pending'`).run(now, r.id);
    addEvent(ctx.db, r.id, body.outcome, deviceActor(actor), { reason: body.reason, posDecision: body.posDecision ?? null });
  });
}

/** Staff resolution of a ticket flagged by a room move or checkout. */
export function resolveAttention(
  ctx: AppContext,
  actor: StaffActor,
  id: number,
  body: { expectedRevision: number; note: string; useCurrentRoom?: boolean },
): RequestRow {
  return staffTx(ctx, actor, id, (r) => {
    checkRevision(r, body.expectedRevision);
    if (!r.attention_flag) throw conflict('no_attention_flag');
    if (r.owner_device_id !== null && r.owner_device_id !== actor.deviceId) throw conflict('not_owner');
    let extra = '';
    const params: unknown[] = [];
    let data: Record<string, unknown> = { flag: r.attention_flag, note: body.note };
    if (body.useCurrentRoom) {
      if (r.attention_flag !== 'room_moved') throw badRequest('no_current_room');
      const stay = getStay(ctx.db, r.stay_id)!;
      const a = stay.status === 'active' ? currentAssignment(ctx.db, stay.id) : undefined;
      if (!a) throw conflict('stay_checked_out');
      if (r.destination_kind === 'room') {
        const dest: Destination = { kind: 'room', roomId: a.room_id, label: { fr: `Chambre ${a.room_label}`, en: `Room ${a.room_label}` } };
        extra = ', current_destination = ?';
        params.push(JSON.stringify(dest));
      }
      extra += ', assignment_revision = ?';
      params.push(a.revision);
      data = { ...data, newRoom: a.room_label };
    }
    bump(ctx.db, r.id, `attention_flag = NULL, attention_detail = NULL, attention_at = NULL${extra}`, params, body.expectedRevision);
    addEvent(ctx.db, r.id, 'attention_resolved', deviceActor(actor), data);
  });
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

function linesFor(db: DB, requestId: number): RequestLine[] {
  return (db.prepare('SELECT * FROM request_lines WHERE request_id = ? ORDER BY line_no').all(requestId) as Record<string, any>[]).map((l) => ({
    itemId: l.item_id,
    name: { fr: l.name_fr, en: l.name_en },
    options: JSON.parse(l.options_json),
    unitPriceMinor: l.unit_price_minor,
    quantity: l.quantity,
    lineTotalMinor: l.line_total_minor,
    complimentary: !!l.complimentary,
    details: l.details,
  }));
}

function attemptsFor(db: DB, requestId: number): ContactAttemptDto[] {
  return (db.prepare('SELECT * FROM contact_attempts WHERE request_id = ? ORDER BY attempt_no').all(requestId) as Record<string, any>[]).map((a) => ({
    attemptNo: a.attempt_no,
    requestedBy: a.requested_by,
    status: a.status,
    method: a.method,
    createdAt: a.created_at,
    resolvedAt: a.resolved_at,
  }));
}

function amendmentsFor(db: DB, requestId: number) {
  return (db.prepare(`SELECT data_json, created_at FROM request_events WHERE request_id = ? AND type = 'amended' ORDER BY id`).all(requestId) as {
    data_json: string;
    created_at: string;
  }[]).map((e) => ({ note: String(JSON.parse(e.data_json).note ?? ''), createdAt: e.created_at }));
}

export function toGuestDto(ctx: AppContext, g: GuestContext, r: RequestRow): GuestRequestDto {
  const dest = JSON.parse(r.current_destination) as Destination;
  const canRequestCallback =
    r.type === 'food' &&
    r.state === 'confirmation_not_received' &&
    !r.attention_flag &&
    r.assignment_revision === g.session.assignment_revision &&
    orderingBlockReason(ctx, { property: g.property, stay: g.stay, capability: g.session.capability, sessionRevision: g.session.assignment_revision }) === null;
  return {
    ref: r.ref,
    type: r.type,
    state: r.state,
    progress: guestProgress(r.type, r.state, r.destination_kind),
    destination: dest,
    lines: linesFor(ctx.db, r.id),
    totalMinor: r.total_minor,
    currency: r.currency,
    notes: r.notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    canRequestCallback,
    attempts: attemptsFor(ctx.db, r.id),
    amendments: amendmentsFor(ctx.db, r.id),
  };
}

export function listGuestRequests(ctx: AppContext, g: GuestContext): GuestRequestDto[] {
  const rows = ctx.db.prepare('SELECT * FROM requests WHERE stay_id = ? ORDER BY id DESC').all(g.stay.id) as RequestRow[];
  return rows.map((r) => toGuestDto(ctx, g, r));
}

export function getGuestRequest(ctx: AppContext, g: GuestContext, ref: string): GuestRequestDto {
  const r = ctx.db.prepare('SELECT * FROM requests WHERE ref = ? AND stay_id = ?').get(ref, g.stay.id) as RequestRow | undefined;
  if (!r) throw notFound('request_not_found');
  return toGuestDto(ctx, g, r);
}

export function listGuestNotices(ctx: AppContext, g: GuestContext): GuestNoticeDto[] {
  return (ctx.db
    .prepare(
      `SELECT n.*, r.ref FROM guest_notices n LEFT JOIN requests r ON r.id = n.request_id WHERE n.stay_id = ? ORDER BY n.id DESC LIMIT 50`,
    )
    .all(g.stay.id) as Record<string, any>[]).map((n) => ({ id: n.id, kind: n.kind, requestRef: n.ref, createdAt: n.created_at, readAt: n.read_at }));
}

export function markNoticeRead(ctx: AppContext, g: GuestContext, id: number) {
  const res = ctx.db.prepare('UPDATE guest_notices SET read_at = COALESCE(read_at, ?) WHERE id = ? AND stay_id = ?').run(nowIso(), id, g.stay.id);
  if (res.changes !== 1) throw notFound('notice_not_found');
}

export function toStaffDto(db: DB, r: RequestRow): StaffRequestDto {
  const stay = getStay(db, r.stay_id)!;
  const a = stay.status === 'active' ? currentAssignment(db, stay.id) : latestAssignment(db, stay.id);
  const owner = r.owner_device_id
    ? { deviceId: r.owner_device_id, name: db.prepare('SELECT name FROM devices WHERE id = ?').pluck().get(r.owner_device_id) as string, claimedAt: r.claimed_at! }
    : null;
  const events = (db.prepare('SELECT * FROM request_events WHERE request_id = ? ORDER BY id').all(r.id) as Record<string, any>[]).map((e) => ({
    id: e.id,
    type: e.type,
    actorLabel: e.actor_label,
    data: JSON.parse(e.data_json),
    createdAt: e.created_at,
  }));
  const notices = (db
    .prepare(
      `SELECT n.id, n.created_at, n.read_at, (SELECT j.status FROM notification_jobs j WHERE j.notice_id = n.id ORDER BY j.id DESC LIMIT 1) AS push,
              (SELECT j.last_error FROM notification_jobs j WHERE j.notice_id = n.id ORDER BY j.id DESC LIMIT 1) AS push_detail
       FROM guest_notices n WHERE n.request_id = ? ORDER BY n.id`,
    )
    .all(r.id) as Record<string, any>[]).map((n) => ({
    id: n.id,
    createdAt: n.created_at,
    readAt: n.read_at,
    push: n.push ? (n.push_detail ? `${n.push}:${n.push_detail}` : n.push) : null,
  }));
  return {
    id: r.id,
    ref: r.ref,
    type: r.type,
    state: r.state,
    revision: r.revision,
    propertyId: r.property_id,
    roomLabel: a?.room_label ?? null,
    guestName: stay.guest_name,
    stayStatus: stay.status,
    originalDestination: JSON.parse(r.original_destination),
    currentDestination: JSON.parse(r.current_destination),
    lines: linesFor(db, r.id),
    totalMinor: r.total_minor,
    currency: r.currency,
    notes: r.notes,
    owner,
    confirmation: { method: r.confirmation_method, result: r.confirmation_result, at: r.confirmed_at },
    pos: { status: r.pos_status, reference: r.pos_reference, at: r.pos_updated_at },
    housekeepingContactedAt: r.housekeeping_contacted_at,
    attention: { flag: r.attention_flag, at: r.attention_at, detail: r.attention_detail },
    attempts: attemptsFor(db, r.id),
    events,
    notices,
    closeReason: r.close_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function staffQueue(ctx: AppContext, actor: { accountId: string; propertyId: string }, scope: 'open' | 'closed'): StaffRequestDto[] {
  const rows = ctx.db
    .prepare(
      scope === 'open'
        ? `SELECT * FROM requests WHERE department_account_id = ? AND property_id = ?
             AND (state NOT IN ('completed','rejected','cancelled') OR attention_flag IS NOT NULL OR pos_status = 'uncertain')
           ORDER BY id ASC LIMIT 300`
        : `SELECT * FROM requests WHERE department_account_id = ? AND property_id = ? AND state IN ('completed','rejected','cancelled')
           ORDER BY updated_at DESC LIMIT 100`,
    )
    .all(actor.accountId, actor.propertyId) as RequestRow[];
  return rows.map((r) => toStaffDto(ctx.db, r));
}

export function staffRequest(ctx: AppContext, actor: { accountId: string; propertyId: string }, id: number): StaffRequestDto {
  return toStaffDto(ctx.db, loadForStaff(ctx.db, actor, id));
}
