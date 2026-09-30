import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ApiError } from './errors';
import { randomToken, safeEqual } from './crypto';
import type { Logger } from './log';

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    throw new ApiError(400, 'validation_failed', r.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code })));
  }
  return r.data;
}

export const CSRF_COOKIE = 'pa_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Double-submit CSRF protection for every state-changing API call. */
export function csrf(secure: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    let token = req.cookies?.[CSRF_COOKIE] as string | undefined;
    if (!token) {
      token = randomToken(18);
      res.cookie(CSRF_COOKIE, token, { httpOnly: false, secure, sameSite: 'strict', path: '/' });
      req.cookies = { ...(req.cookies ?? {}), [CSRF_COOKIE]: token };
    }
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const header = req.get(CSRF_HEADER);
    if (!header || !safeEqual(header, token)) return next(new ApiError(403, 'csrf_failed'));
    next();
  };
}

export function securityHeaders(req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  if (!req.path.startsWith('/api')) {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
  }
  next();
}

/** Private API responses must never be stored by browsers, proxies or the service worker. */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('Cache-Control', 'no-store');
  next();
}

/** Request log without query strings, bodies or cookies. */
export function requestLog(log: Logger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      if (req.path.endsWith('/stream')) return;
      log.info('http', { method: req.method, path: req.baseUrl + req.path, status: res.statusCode, ms: Date.now() - start });
    });
    next();
  };
}

export function errorHandler(log: Logger) {
  return (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, details: err.details } });
      return;
    }
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: { code: 'invalid_json' } });
      return;
    }
    if ((err as { type?: string }).type === 'entity.too.large') {
      res.status(413).json({ error: { code: 'payload_too_large' } });
      return;
    }
    log.error('unhandled_error', { error: (err as Error)?.message });
    res.status(500).json({ error: { code: 'internal_error' } });
  };
}
