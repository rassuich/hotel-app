import type { AppContext } from '../context';
import type { DB } from '../db';
import { conflict, notFound, badRequest } from '../lib/errors';
import { codeHash, newId, normalizeCode, randomCode, randomToken, sha256 } from '../lib/crypto';
import { addHours, nowIso } from '../lib/clock';
import { channels } from '../live/hub';
import { currentAssignment, getStay, latestAssignment, type StayRow, type PropertyRow } from './rows';
import type { StayEvent } from '../pms/adapter';

export interface IssuedQr {
  token: string;
  url: string;
  /** Hand-typed alternative to the QR (same credential, revoked together). */
  code: string;
}

const UNFINISHED = `state NOT IN ('completed', 'rejected', 'cancelled')`;

function requireStay(db: DB, propertyId: string, stayId: string): StayRow {
  const stay = getStay(db, stayId);
  if (!stay || stay.property_id !== propertyId) throw notFound('stay_not_found');
  return stay;
}

function requireRoom(db: DB, propertyId: string, roomId: number) {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ? AND property_id = ?').get(roomId, propertyId) as
    | { id: number; label: string; active: number }
    | undefined;
  if (!room || !room.active) throw badRequest('room_not_found');
  const occupied = db.prepare('SELECT 1 FROM room_assignments WHERE room_id = ? AND ended_at IS NULL').get(roomId);
  if (occupied) throw conflict('room_occupied');
  return room;
}

/** Issues a fresh private activation token for the stay's current room revision. */
function issueCredential(ctx: AppContext, propertyId: string, stayId: string, revision: number): IssuedQr {
  const token = randomToken(32);
  const code = randomCode();
  ctx.db
    .prepare('INSERT INTO activation_credentials (stay_id, token_hash, code_hash, assignment_revision, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(stayId, sha256(token), codeHash(ctx.config.codeSecret!, normalizeCode(code)), revision, nowIso());
  // The property id (not secret) lets the page show the right verification field;
  // the token itself travels only in the fragment, which browsers never send to servers.
  return { token, code, url: `${ctx.config.publicBaseUrl}/activate?p=${encodeURIComponent(propertyId)}#t=${token}` };
}

function revokeCredentials(db: DB, stayId: string, reason: string) {
  db.prepare('UPDATE activation_credentials SET revoked_at = ?, revoke_reason = ? WHERE stay_id = ? AND revoked_at IS NULL').run(
    nowIso(),
    reason,
    stayId,
  );
}

function revokeSessions(db: DB, stayId: string, reason: string) {
  db.prepare('UPDATE guest_sessions SET revoked_at = ?, revoke_reason = ? WHERE stay_id = ? AND revoked_at IS NULL').run(
    nowIso(),
    reason,
    stayId,
  );
}

/** Flags unfinished tickets for staff resolution; nothing is discarded. Returns affected ids. */
function flagUnfinished(db: DB, stayId: string, flag: 'room_moved' | 'checked_out', detail: string): { id: number; department_account_id: string }[] {
  const now = nowIso();
  const rows = db
    .prepare(`SELECT id, department_account_id FROM requests WHERE stay_id = ? AND ${UNFINISHED}`)
    .all(stayId) as { id: number; department_account_id: string }[];
  const upd = db.prepare(
    `UPDATE requests SET attention_flag = ?, attention_at = ?, attention_detail = ?, revision = revision + 1, updated_at = ? WHERE id = ?`,
  );
  const ev = db.prepare(
    `INSERT INTO request_events (request_id, type, actor_type, actor_label, data_json, created_at) VALUES (?, 'attention_flagged', 'system', 'System', ?, ?)`,
  );
  for (const r of rows) {
    upd.run(flag, now, detail, now, r.id);
    ev.run(r.id, JSON.stringify({ flag, detail }), now);
  }
  return rows;
}

function notifyFlagged(ctx: AppContext, rows: { id: number; department_account_id: string }[], stayId: string) {
  for (const r of rows) ctx.hub.publish(channels.department(r.department_account_id), { type: 'request.updated', requestId: r.id });
  ctx.hub.publish(channels.stay(stayId), { type: 'requests.changed' });
}

/**
 * Single entry point for stay changes, whether entered manually by reception or
 * (in future) received from the PMS adapter.
 */
export function applyStayEvent(
  ctx: AppContext,
  propertyId: string,
  event: StayEvent,
  opts: { source?: string; isDemo?: boolean } = {},
): { stayId: string; qr?: IssuedQr } {
  const { db } = ctx;
  switch (event.kind) {
    case 'check_in': {
      const out = db.transaction(() => {
        requireRoom(db, propertyId, event.roomId);
        const id = newId();
        const now = nowIso();
        db.prepare(
          `INSERT INTO stays (id, property_id, guest_name, occupants, status, scheduled_departure, source, external_ref, is_demo, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
        ).run(id, propertyId, event.guestName, event.occupants, event.scheduledDeparture, opts.source ?? 'manual', event.externalRef ?? null, opts.isDemo ? 1 : 0, now, now);
        db.prepare('INSERT INTO room_assignments (stay_id, room_id, revision, started_at) VALUES (?, ?, 1, ?)').run(id, event.roomId, now);
        return { stayId: id, qr: issueCredential(ctx, propertyId, id, 1) };
      })();
      return out;
    }
    case 'update': {
      db.transaction(() => {
        const stay = requireStay(db, propertyId, event.stayId);
        db.prepare(
          `UPDATE stays SET guest_name = ?, occupants = ?, scheduled_departure = ?, updated_at = ? WHERE id = ?`,
        ).run(
          event.guestName ?? stay.guest_name,
          event.occupants ?? stay.occupants,
          event.scheduledDeparture === undefined ? stay.scheduled_departure : event.scheduledDeparture,
          nowIso(),
          stay.id,
        );
      })();
      return { stayId: event.stayId };
    }
    case 'room_move': {
      let flagged: { id: number; department_account_id: string }[] = [];
      const qr = db.transaction(() => {
        const stay = requireStay(db, propertyId, event.stayId);
        if (stay.status !== 'active') throw conflict('stay_checked_out');
        const current = currentAssignment(db, stay.id);
        if (!current) throw conflict('stay_has_no_room');
        if (current.room_id === event.roomId) throw badRequest('same_room');
        const now = nowIso();
        // End the old assignment first so the unique "one open stay per room" index allows swaps.
        db.prepare(`UPDATE room_assignments SET ended_at = ?, end_reason = 'moved' WHERE id = ?`).run(now, current.id);
        const room = requireRoom(db, propertyId, event.roomId);
        const revision = current.revision + 1;
        db.prepare('INSERT INTO room_assignments (stay_id, room_id, revision, started_at) VALUES (?, ?, ?, ?)').run(stay.id, room.id, revision, now);
        db.prepare('UPDATE stays SET updated_at = ? WHERE id = ?').run(now, stay.id);
        revokeCredentials(db, stay.id, 'room_moved');
        revokeSessions(db, stay.id, 'room_moved');
        flagged = flagUnfinished(db, stay.id, 'room_moved', `${current.room_label} → ${room.label}`);
        return issueCredential(ctx, propertyId, stay.id, revision);
      })();
      ctx.hub.closeChannel(channels.stay(event.stayId), { type: 'session.revoked', reason: 'room_moved' });
      notifyFlagged(ctx, flagged, event.stayId);
      return { stayId: event.stayId, qr };
    }
    case 'check_out': {
      let flagged: { id: number; department_account_id: string }[] = [];
      db.transaction(() => {
        const stay = requireStay(db, propertyId, event.stayId);
        if (stay.status !== 'active') throw conflict('stay_checked_out');
        const now = nowIso();
        db.prepare(`UPDATE stays SET status = 'checked_out', checked_out_at = ?, updated_at = ? WHERE id = ?`).run(now, now, stay.id);
        db.prepare(`UPDATE room_assignments SET ended_at = ?, end_reason = 'checked_out' WHERE stay_id = ? AND ended_at IS NULL`).run(now, stay.id);
        revokeCredentials(db, stay.id, 'checked_out');
        if (ctx.config.postStayAccessHours > 0) {
          // Downgrade: existing sessions keep only the restricted post-stay (bill area) capability.
          db.prepare(
            `UPDATE guest_sessions SET capability = 'post_stay', expires_at = ? WHERE stay_id = ? AND revoked_at IS NULL`,
          ).run(addHours(now, ctx.config.postStayAccessHours), stay.id);
        } else {
          revokeSessions(db, stay.id, 'checked_out');
        }
        db.prepare(
          `DELETE FROM push_subscriptions WHERE guest_session_id IN (SELECT id FROM guest_sessions WHERE stay_id = ?)`,
        ).run(stay.id);
        flagged = flagUnfinished(db, stay.id, 'checked_out', 'checked_out');
      })();
      ctx.hub.closeChannel(channels.stay(event.stayId), { type: 'session.changed', reason: 'checked_out' });
      notifyFlagged(ctx, flagged, event.stayId);
      return { stayId: event.stayId };
    }
  }
}

/**
 * Rotates the private QR. Default for an occupant change: also sign out every
 * device so access is re-issued only to the remaining occupants.
 */
export function rotateQr(ctx: AppContext, propertyId: string, stayId: string, opts: { revokeSessions: boolean; reason: string }): IssuedQr {
  const { db } = ctx;
  const qr = db.transaction(() => {
    const stay = requireStay(db, propertyId, stayId);
    if (stay.status !== 'active') throw conflict('stay_checked_out');
    const current = currentAssignment(db, stay.id);
    if (!current) throw conflict('stay_has_no_room');
    revokeCredentials(db, stay.id, `rotated:${opts.reason}`);
    if (opts.revokeSessions) revokeSessions(db, stay.id, `rotated:${opts.reason}`);
    db.prepare('UPDATE stays SET updated_at = ? WHERE id = ?').run(nowIso(), stay.id);
    return issueCredential(ctx, propertyId, stay.id, current.revision);
  })();
  if (opts.revokeSessions) ctx.hub.closeChannel(channels.stay(stayId), { type: 'session.revoked', reason: 'rotated' });
  return qr;
}

/** Why this stay/session may not submit or retry right now (null = allowed). */
export function orderingBlockReason(
  ctx: AppContext,
  args: { property: PropertyRow; stay: StayRow; capability: 'order' | 'post_stay'; sessionRevision: number },
): string | null {
  const { property, stay } = args;
  if (!property.requests_enabled || !ctx.config.orderingProperties.includes(property.id)) return 'property_not_accepting';
  if (stay.status !== 'active') return 'stay_checked_out';
  if (args.capability !== 'order') return 'post_stay_only';
  const current = currentAssignment(ctx.db, stay.id);
  if (!current || current.revision !== args.sessionRevision) return 'room_changed';
  const cutoff = ctx.config.scheduledDepartureCutoffHours;
  if (cutoff !== null && stay.scheduled_departure) {
    if (new Date(nowIso()) > new Date(addHours(stay.scheduled_departure, cutoff))) return 'scheduled_departure_passed';
  }
  return null;
}

export interface StayListItem {
  id: string;
  guestName: string;
  occupants: number;
  status: 'active' | 'checked_out';
  roomId: number | null;
  roomLabel: string | null;
  revision: number | null;
  scheduledDeparture: string | null;
  overdue: boolean;
  checkedOutAt: string | null;
  activeSessions: number;
  activeQr: boolean;
  openRequests: number;
  attentionRequests: number;
  source: string;
  isDemo: boolean;
  updatedAt: string;
}

export function listStays(ctx: AppContext, propertyId: string, filter: 'active' | 'checked_out' | 'overdue' | 'all'): StayListItem[] {
  const { db } = ctx;
  const where = filter === 'checked_out' ? `AND s.status = 'checked_out'` : filter === 'all' ? '' : `AND s.status = 'active'`;
  const stays = db
    .prepare(`SELECT * FROM stays s WHERE s.property_id = ? ${where} ORDER BY s.status, s.updated_at DESC LIMIT 500`)
    .all(propertyId) as StayRow[];
  const now = new Date(nowIso());
  const items = stays.map((s) => {
    const a = s.status === 'active' ? currentAssignment(db, s.id) : latestAssignment(db, s.id);
    const counts = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM guest_sessions WHERE stay_id = @id AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > @now)) AS sessions,
          (SELECT COUNT(*) FROM activation_credentials WHERE stay_id = @id AND revoked_at IS NULL) AS qr,
          (SELECT COUNT(*) FROM requests WHERE stay_id = @id AND ${UNFINISHED}) AS open,
          (SELECT COUNT(*) FROM requests WHERE stay_id = @id AND attention_flag IS NOT NULL) AS attention`,
      )
      .get({ id: s.id, now: now.toISOString() }) as { sessions: number; qr: number; open: number; attention: number };
    return {
      id: s.id,
      guestName: s.guest_name,
      occupants: s.occupants,
      status: s.status,
      roomId: a?.room_id ?? null,
      roomLabel: a?.room_label ?? null,
      revision: a?.revision ?? null,
      scheduledDeparture: s.scheduled_departure,
      overdue: s.status === 'active' && !!s.scheduled_departure && new Date(s.scheduled_departure) < now,
      checkedOutAt: s.checked_out_at,
      activeSessions: counts.sessions,
      activeQr: counts.qr > 0,
      openRequests: counts.open,
      attentionRequests: counts.attention,
      source: s.source,
      isDemo: !!s.is_demo,
      updatedAt: s.updated_at,
    };
  });
  return filter === 'overdue' ? items.filter((i) => i.overdue) : items;
}
