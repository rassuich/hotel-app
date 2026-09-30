import type { Request, Response } from 'express';
import type { AppContext } from '../context';
import { ApiError, forbidden, unauthorized } from '../lib/errors';
import { addHours, nowIso } from '../lib/clock';
import { newId, randomToken, sha256, verifyPassword } from '../lib/crypto';
import type { AccountRole } from '../../../shared/src/states';

export const STAFF_COOKIE = 'pa_staff';

export interface StaffContext {
  sessionId: string;
  accountId: string;
  role: AccountRole;
  propertyId: string;
  propertyName: string;
  nameFr: string;
  nameEn: string;
  deviceId: number | null;
  deviceName: string | null;
}

// Pre-computed dummy hash so unknown usernames cost the same time as wrong passwords.
const DUMMY_HASH = 'scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

export function staffLogin(ctx: AppContext, username: string, password: string): { cookieToken: string } {
  const acc = ctx.db.prepare('SELECT * FROM department_accounts WHERE username = ? AND active = 1').get(username.trim().toLowerCase()) as
    | Record<string, any>
    | undefined;
  const ok = verifyPassword(password, acc?.password_hash ?? DUMMY_HASH);
  if (!acc || !ok) throw new ApiError(401, 'login_failed');
  const token = randomToken(32);
  const now = nowIso();
  ctx.db
    .prepare('INSERT INTO staff_sessions (id, token_hash, account_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(newId(), sha256(token), acc.id, now, now, addHours(now, ctx.config.staffSessionHours));
  return { cookieToken: token };
}

export function setStaffCookie(ctx: AppContext, res: Response, token: string) {
  res.cookie(STAFF_COOKIE, token, {
    httpOnly: true,
    secure: ctx.config.secureCookies,
    sameSite: 'lax',
    path: '/api',
    maxAge: ctx.config.staffSessionHours * 3600_000,
  });
}

export function clearStaffCookie(ctx: AppContext, res: Response) {
  res.clearCookie(STAFF_COOKIE, { httpOnly: true, secure: ctx.config.secureCookies, sameSite: 'lax', path: '/api' });
}

export function loadStaff(ctx: AppContext, req: Request): StaffContext {
  const token = req.cookies?.[STAFF_COOKIE] as string | undefined;
  if (!token) throw unauthorized('not_authenticated');
  const row = ctx.db
    .prepare(
      `SELECT s.id AS session_id, s.expires_at, s.revoked_at, s.device_id, s.last_seen_at, a.id AS account_id, a.role, a.property_id, a.active,
              a.display_name_fr, a.display_name_en, p.name AS property_name, d.name AS device_name, d.active AS device_active
       FROM staff_sessions s JOIN department_accounts a ON a.id = s.account_id JOIN properties p ON p.id = a.property_id
       LEFT JOIN devices d ON d.id = s.device_id
       WHERE s.token_hash = ?`,
    )
    .get(sha256(token)) as Record<string, any> | undefined;
  const now = nowIso();
  if (!row || row.revoked_at || row.expires_at <= now || !row.active) throw unauthorized('not_authenticated');
  if (row.device_id && !row.device_active) throw unauthorized('device_disabled');
  if (Date.parse(now) - Date.parse(row.last_seen_at) > 60_000) {
    ctx.db.prepare('UPDATE staff_sessions SET last_seen_at = ? WHERE id = ?').run(now, row.session_id);
  }
  return {
    sessionId: row.session_id,
    accountId: row.account_id,
    role: row.role,
    propertyId: row.property_id,
    propertyName: row.property_name,
    nameFr: row.display_name_fr,
    nameEn: row.display_name_en,
    deviceId: row.device_id,
    deviceName: row.device_name,
  };
}

export function staffSessionStillValid(ctx: AppContext, sessionId: string): boolean {
  const row = ctx.db
    .prepare(
      `SELECT s.revoked_at, s.expires_at, a.active FROM staff_sessions s JOIN department_accounts a ON a.id = s.account_id WHERE s.id = ?`,
    )
    .get(sessionId) as Record<string, any> | undefined;
  return !!row && !row.revoked_at && row.expires_at > nowIso() && !!row.active;
}

export function requireDevice(s: StaffContext) {
  if (s.role === 'admin') throw forbidden('department_account_required');
  if (!s.deviceId || !s.deviceName) throw forbidden('device_required');
  return { accountId: s.accountId, propertyId: s.propertyId, deviceId: s.deviceId, deviceName: s.deviceName };
}
