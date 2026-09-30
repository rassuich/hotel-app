import type { Request, Response } from 'express';
import type { AppContext } from '../context';
import { ApiError, unauthorized } from '../lib/errors';
import { addHours, nowIso } from '../lib/clock';
import { newId, normalizeCode, randomToken, sha256, CODE_LENGTH } from '../lib/crypto';
import { currentAssignment, getProperty, getStay, type GuestSessionRow, type PropertyRow, type StayRow } from './rows';

export const GUEST_COOKIE = 'pa_guest';

export interface GuestContext {
  session: GuestSessionRow;
  stay: StayRow;
  property: PropertyRow;
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Exchanges a private activation credential — the QR token, or the hand-typed
 * validation code — for a server-revocable session. Every failure returns the
 * same generic error so guesses reveal nothing about which code, room or name exists.
 * A typed code always requires the room number too (it is shorter than the QR token).
 */
export function activate(
  ctx: AppContext,
  input: { token?: string; code?: string; room?: string; name?: string; language: 'fr' | 'en' | 'es' },
): { cookieToken: string; session: GuestSessionRow } {
  const { db } = ctx;
  const fail = () => new ApiError(401, 'activation_failed');
  return db.transaction(() => {
    let cred: { stay_id: string; assignment_revision: number } | undefined;
    const viaCode = !input.token && !!input.code;
    if (input.token) {
      cred = db.prepare('SELECT * FROM activation_credentials WHERE token_hash = ? AND revoked_at IS NULL').get(sha256(input.token)) as typeof cred;
    } else if (input.code) {
      const normalized = normalizeCode(input.code);
      if (normalized.length !== CODE_LENGTH) throw fail();
      cred = db.prepare('SELECT * FROM activation_credentials WHERE code_hash = ? AND revoked_at IS NULL').get(sha256(normalized)) as typeof cred;
    }
    if (!cred) throw fail();
    const stay = getStay(db, cred.stay_id);
    if (!stay || stay.status !== 'active') throw fail();
    const assignment = currentAssignment(db, stay.id);
    if (!assignment || assignment.revision !== cred.assignment_revision) throw fail();
    const property = getProperty(db, stay.property_id)!;
    const check = viaCode ? 'room' : property.activation_check;
    if (check === 'room') {
      if (!input.room || normalize(input.room) !== normalize(assignment.room_label)) throw fail();
    } else if (check === 'name') {
      const n = normalize(input.name ?? '');
      if (n.length < 2 || !normalize(stay.guest_name).includes(n)) throw fail();
    }
    const cookieToken = randomToken(32);
    const now = nowIso();
    const session: GuestSessionRow = {
      id: newId(),
      token_hash: sha256(cookieToken),
      stay_id: stay.id,
      property_id: stay.property_id,
      assignment_revision: assignment.revision,
      capability: 'order',
      language: input.language,
      created_at: now,
      last_seen_at: now,
      expires_at: addHours(now, ctx.config.guestSessionDays * 24),
      revoked_at: null,
      revoke_reason: null,
    };
    db.prepare(
      `INSERT INTO guest_sessions (id, token_hash, stay_id, property_id, assignment_revision, capability, language, created_at, last_seen_at, expires_at)
       VALUES (@id, @token_hash, @stay_id, @property_id, @assignment_revision, @capability, @language, @created_at, @last_seen_at, @expires_at)`,
    ).run(session);
    return { cookieToken, session };
  })();
}

export function setGuestCookie(ctx: AppContext, res: Response, token: string) {
  res.cookie(GUEST_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.secureCookies,
    sameSite: 'lax',
    path: '/api',
    maxAge: ctx.config.guestSessionDays * 24 * 3600_000,
  });
}

export function clearGuestCookie(ctx: AppContext, res: Response) {
  res.clearCookie(GUEST_COOKIE, { httpOnly: true, secure: ctx.config.secureCookies, sameSite: 'lax', path: '/api' });
}

/**
 * Resolves and re-validates the guest session on every request. Revocation is
 * enforced here, so an old open screen or a missed live update cannot bypass it.
 */
export function loadGuest(ctx: AppContext, req: Request): GuestContext {
  const token = req.cookies?.[GUEST_COOKIE] as string | undefined;
  if (!token) throw unauthorized('not_activated');
  const { db } = ctx;
  const session = db.prepare('SELECT * FROM guest_sessions WHERE token_hash = ?').get(sha256(token)) as GuestSessionRow | undefined;
  if (!session) throw unauthorized('not_activated');
  if (session.revoked_at) throw new ApiError(401, 'session_revoked', { reason: session.revoke_reason });
  const now = nowIso();
  if (session.expires_at && session.expires_at <= now) {
    db.prepare(`UPDATE guest_sessions SET revoked_at = ?, revoke_reason = 'expired' WHERE id = ?`).run(now, session.id);
    throw new ApiError(401, 'session_revoked', { reason: 'expired' });
  }
  const stay = getStay(db, session.stay_id)!;
  if (session.capability === 'order') {
    const assignment = currentAssignment(db, stay.id);
    if (stay.status !== 'active' || !assignment || assignment.revision !== session.assignment_revision) {
      // Defensive: lifecycle actions already revoke/downgrade, but never trust that alone.
      db.prepare(`UPDATE guest_sessions SET revoked_at = ?, revoke_reason = 'stay_changed' WHERE id = ?`).run(now, session.id);
      throw new ApiError(401, 'session_revoked', { reason: 'stay_changed' });
    }
  }
  if (Date.parse(now) - Date.parse(session.last_seen_at) > 60_000) {
    db.prepare('UPDATE guest_sessions SET last_seen_at = ? WHERE id = ?').run(now, session.id);
  }
  const property = getProperty(db, session.property_id)!;
  return { session, stay, property };
}

/** Lightweight validity check used by the live stream heartbeat. */
export function guestSessionStillValid(ctx: AppContext, sessionId: string): boolean {
  const s = ctx.db.prepare('SELECT * FROM guest_sessions WHERE id = ?').get(sessionId) as GuestSessionRow | undefined;
  if (!s || s.revoked_at || (s.expires_at && s.expires_at <= nowIso())) return false;
  if (s.capability !== 'order') return false;
  const a = currentAssignment(ctx.db, s.stay_id);
  return !!a && a.revision === s.assignment_revision;
}
