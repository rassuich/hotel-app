import { Router, type NextFunction, type Request, type Response } from 'express';
import type { AppContext } from '../context';
import { ApiError, forbidden } from '../lib/errors';
import { parse } from '../lib/http';
import { rateLimit } from '../lib/rateLimit';
import { nowIso } from '../lib/clock';
import { channels } from '../live/hub';
import { currentAssignment, latestAssignment } from '../services/rows';
import {
  activate,
  clearGuestCookie,
  guestSessionStillValid,
  loadGuest,
  setGuestCookie,
  type GuestContext,
} from '../services/guestAuth';
import { orderingBlockReason } from '../services/stays';
import {
  getGuestRequest,
  listGuestNotices,
  listGuestRequests,
  markNoticeRead,
  requestCallback,
  submitFood,
  submitService,
  toGuestDto,
} from '../services/requests';
import * as S from './schemas';
import { listContent, listLocations, listMenu, listServices } from '../services/catalogue';
import { propertySummary } from './public';
import type { GuestMeDto } from '../../../shared/src/api';

export function guestRoutes(ctx: AppContext): Router {
  const r = Router();

  /** Full ordering permission: active stay, current room revision, not post-stay. */
  const ordering = (req: Request): GuestContext => {
    const g = loadGuest(ctx, req);
    if (g.session.capability !== 'order') throw forbidden('post_stay_only');
    return g;
  };

  r.post(
    '/activate',
    rateLimit({ name: 'activate', windowMs: ctx.config.rateLimit.windowMs, max: ctx.config.rateLimit.activationMax }),
    (req, res) => {
      const body = parse(S.activateBody, req.body);
      const { cookieToken } = activate(ctx, body);
      setGuestCookie(ctx, res, cookieToken);
      res.status(201).json({ ok: true });
    },
  );

  r.get('/me', (req, res) => {
    const g = loadGuest(ctx, req);
    const a = g.stay.status === 'active' ? currentAssignment(ctx.db, g.stay.id) : latestAssignment(ctx.db, g.stay.id);
    const reason = orderingBlockReason(ctx, {
      property: g.property,
      stay: g.stay,
      capability: g.session.capability,
      sessionRevision: g.session.assignment_revision,
    });
    const me: GuestMeDto = {
      capability: g.session.capability,
      property: { id: g.property.id, name: g.property.name },
      roomLabel: g.session.capability === 'order' ? (a?.room_label ?? null) : null,
      guestName: g.stay.guest_name,
      stayStatus: g.stay.status,
      canOrder: reason === null,
      orderingBlockedReason: reason,
    };
    res.json({ me });
  });

  r.patch('/language', (req, res) => {
    const g = loadGuest(ctx, req);
    const { language } = parse(S.languageBody, req.body);
    ctx.db.prepare('UPDATE guest_sessions SET language = ? WHERE id = ?').run(language, g.session.id);
    res.json({ ok: true });
  });

  r.post('/logout', (req, res) => {
    try {
      const g = loadGuest(ctx, req);
      ctx.db.prepare(`UPDATE guest_sessions SET revoked_at = ?, revoke_reason = 'signed_out' WHERE id = ?`).run(nowIso(), g.session.id);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
    }
    clearGuestCookie(ctx, res);
    res.json({ ok: true });
  });

  // ---- Hotel guide and catalogue: validated guests only, scoped to their stay's hotel ----
  r.get('/catalog/property', (req, res) => {
    res.json({ property: propertySummary(ctx, ordering(req).property) });
  });
  r.get('/catalog/content', (req, res) => {
    res.json({ content: listContent(ctx.db, ordering(req).property.id, true) });
  });
  r.get('/catalog/menu', (req, res) => {
    const p = ordering(req).property;
    res.json({ currency: p.currency, categories: listMenu(ctx.db, p.id) });
  });
  r.get('/catalog/services', (req, res) => {
    const p = ordering(req).property;
    res.json({ currency: p.currency, services: listServices(ctx.db, p.id) });
  });
  r.get('/catalog/locations', (req, res) => {
    res.json({ locations: listLocations(ctx.db, ordering(req).property.id) });
  });

  r.get('/requests', (req, res) => {
    res.json({ requests: listGuestRequests(ctx, ordering(req)) });
  });

  r.get('/requests/:ref', (req, res) => {
    res.json({ request: getGuestRequest(ctx, ordering(req), req.params.ref) });
  });

  r.post('/requests/food', (req, res) => {
    const g = ordering(req);
    const body = parse(S.foodSubmitBody, req.body);
    const out = submitFood(ctx, g, body);
    res.status(out.duplicate ? 200 : 201).json({ request: toGuestDto(ctx, g, out.request), duplicate: out.duplicate });
  });

  r.post('/requests/service', (req, res) => {
    const g = ordering(req);
    const body = parse(S.serviceSubmitBody, req.body);
    const out = submitService(ctx, g, body);
    res.status(out.duplicate ? 200 : 201).json({ request: toGuestDto(ctx, g, out.request), duplicate: out.duplicate });
  });

  r.post('/requests/:ref/callback', (req, res) => {
    const g = ordering(req);
    const { idempotencyKey } = parse(S.callbackBody, req.body);
    const out = requestCallback(ctx, g, String(req.params.ref), idempotencyKey);
    res.json({ request: toGuestDto(ctx, g, out.request), attemptNo: out.attemptNo, coalesced: out.coalesced });
  });

  r.get('/notices', (req, res) => {
    res.json({ notices: listGuestNotices(ctx, ordering(req)) });
  });

  r.post('/notices/:id/read', (req, res) => {
    markNoticeRead(ctx, ordering(req), Number(req.params.id));
    res.json({ ok: true });
  });

  r.post('/push-subscription', (req, res) => {
    const g = ordering(req);
    if (!ctx.push.configured) throw new ApiError(503, 'push_unconfigured');
    const body = parse(S.pushSubscriptionBody, req.body);
    ctx.db
      .prepare(
        `INSERT INTO push_subscriptions (guest_session_id, endpoint, keys_json, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET guest_session_id = excluded.guest_session_id, keys_json = excluded.keys_json`,
      )
      .run(g.session.id, body.endpoint, JSON.stringify(body.keys), nowIso());
    res.status(201).json({ ok: true });
  });

  r.delete('/push-subscription', (req, res) => {
    const g = loadGuest(ctx, req);
    ctx.db.prepare('DELETE FROM push_subscriptions WHERE guest_session_id = ?').run(g.session.id);
    res.json({ ok: true });
  });

  /**
   * Bill area. Available to both ordering and restricted post-stay sessions, but
   * real folio content needs a configured provider AND explicit authorization.
   */
  r.get('/bill', async (req, res) => {
    const g = loadGuest(ctx, req);
    if (!ctx.bills.configured) {
      res.json({ bill: { status: 'unconfigured', fallback: 'contact_reception' } });
      return;
    }
    const allowed = ctx.db.prepare('SELECT bill_access FROM guest_sessions WHERE id = ?').pluck().get(g.session.id) as number;
    if (!allowed) {
      res.json({ bill: { status: 'not_authorized', fallback: 'contact_reception' } });
      return;
    }
    const doc = await ctx.bills.getBill({ id: g.stay.id, propertyId: g.property.id, externalRef: g.stay.external_ref });
    res.json({ bill: { status: 'available', document: doc } });
  });

  r.get('/stream', (req, res) => {
    const g = ordering(req);
    const sessionId = g.session.id;
    ctx.hub.subscribe(res, [channels.stay(g.stay.id)], () => guestSessionStillValid(ctx, sessionId));
  });

  // A revoked/expired session also drops its cookie, so the device is told once and starts clean.
  r.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof ApiError && err.code === 'session_revoked') clearGuestCookie(ctx, res);
    next(err);
  });

  return r;
}
