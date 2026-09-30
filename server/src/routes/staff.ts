import { Router, type Request } from 'express';
import type { AppContext } from '../context';
import { forbidden, notFound } from '../lib/errors';
import { parse } from '../lib/http';
import { rateLimit } from '../lib/rateLimit';
import { nowIso } from '../lib/clock';
import { channels } from '../live/hub';
import {
  clearStaffCookie,
  loadStaff,
  requireDevice,
  setStaffCookie,
  staffLogin,
  staffSessionStillValid,
} from '../services/staffAuth';
import * as R from '../services/requests';
import * as S from './schemas';
import type { StaffMeDto } from '../../../shared/src/api';

export function staffRoutes(ctx: AppContext): Router {
  const r = Router();
  const dev = (req: Request) => requireDevice(loadStaff(ctx, req));
  const id = (req: Request) => {
    const n = Number(req.params.id);
    if (!Number.isInteger(n) || n <= 0) throw notFound('request_not_found');
    return n;
  };

  r.post('/login', rateLimit({ name: 'staff-login', windowMs: ctx.config.rateLimit.windowMs, max: ctx.config.rateLimit.loginMax }), (req, res) => {
    const body = parse(S.staffLoginBody, req.body);
    const { cookieToken } = staffLogin(ctx, body.username, body.password);
    setStaffCookie(ctx, res, cookieToken);
    res.status(201).json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    try {
      const s = loadStaff(ctx, req);
      ctx.db.prepare('UPDATE staff_sessions SET revoked_at = ? WHERE id = ?').run(nowIso(), s.sessionId);
    } catch {
      /* already signed out */
    }
    clearStaffCookie(ctx, res);
    res.json({ ok: true });
  });

  r.get('/me', (req, res) => {
    const s = loadStaff(ctx, req);
    const me: StaffMeDto = {
      account: { id: s.accountId, role: s.role, name: { fr: s.nameFr, en: s.nameEn }, propertyId: s.propertyId, propertyName: s.propertyName },
      device: s.deviceId ? { id: s.deviceId, name: s.deviceName! } : null,
    };
    res.json({ me });
  });

  r.get('/devices', (req, res) => {
    const s = loadStaff(ctx, req);
    const devices = ctx.db.prepare('SELECT id, name FROM devices WHERE account_id = ? AND active = 1 ORDER BY name').all(s.accountId);
    res.json({ devices });
  });

  /** A shared department login identifies which named tablet is in use. */
  r.post('/device', (req, res) => {
    const s = loadStaff(ctx, req);
    if (s.role === 'admin') throw forbidden('department_account_required');
    const { deviceId } = parse(S.deviceBody, req.body);
    const d = ctx.db.prepare('SELECT id FROM devices WHERE id = ? AND account_id = ? AND active = 1').get(deviceId, s.accountId);
    if (!d) throw notFound('device_not_found');
    ctx.db.prepare('UPDATE staff_sessions SET device_id = ? WHERE id = ?').run(deviceId, s.sessionId);
    res.json({ ok: true });
  });

  r.get('/queue', (req, res) => {
    const a = dev(req);
    const scope = req.query.scope === 'closed' ? 'closed' : 'open';
    res.json({ requests: R.staffQueue(ctx, a, scope), serverTime: nowIso() });
  });

  r.get('/requests/:id', (req, res) => {
    res.json({ request: R.staffRequest(ctx, dev(req), id(req)) });
  });

  const respond = (row: Parameters<typeof R.toStaffDto>[1]) => ({ request: R.toStaffDto(ctx.db, row) });

  r.post('/requests/:id/claim', (req, res) => {
    const { expectedRevision } = parse(S.revisionBody, req.body);
    res.json(respond(R.claim(ctx, dev(req), id(req), expectedRevision)));
  });

  r.post('/requests/:id/takeover', (req, res) => {
    const b = parse(S.takeoverBody, req.body);
    res.json(respond(R.takeover(ctx, dev(req), id(req), b.expectedRevision, b.reason)));
  });

  r.post('/requests/:id/confirmation', (req, res) => {
    res.json(respond(R.recordConfirmation(ctx, dev(req), id(req), parse(S.confirmationBody, req.body))));
  });

  r.post('/requests/:id/amendment', (req, res) => {
    res.json(respond(R.recordAmendment(ctx, dev(req), id(req), parse(S.amendmentBody, req.body))));
  });

  r.post('/requests/:id/pos', (req, res) => {
    res.json(respond(R.recordPos(ctx, dev(req), id(req), parse(S.posBody, req.body))));
  });

  r.post('/requests/:id/housekeeping', (req, res) => {
    const { expectedRevision } = parse(S.revisionBody, req.body);
    res.json(respond(R.recordHousekeeping(ctx, dev(req), id(req), expectedRevision)));
  });

  r.post('/requests/:id/status', (req, res) => {
    res.json(respond(R.moveStatus(ctx, dev(req), id(req), parse(S.statusBody, req.body))));
  });

  r.post('/requests/:id/close', (req, res) => {
    res.json(respond(R.closeRequest(ctx, dev(req), id(req), parse(S.closeBody, req.body))));
  });

  r.post('/requests/:id/resolve-attention', (req, res) => {
    res.json(respond(R.resolveAttention(ctx, dev(req), id(req), parse(S.resolveBody, req.body))));
  });

  r.get('/stream', (req, res) => {
    const s = loadStaff(ctx, req);
    requireDevice(s);
    ctx.hub.subscribe(res, [channels.department(s.accountId)], () => staffSessionStillValid(ctx, s.sessionId));
  });

  return r;
}
