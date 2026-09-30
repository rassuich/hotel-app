import type { NextFunction, Request, Response } from 'express';
import { ApiError } from './errors';

/**
 * Small fixed-window, in-memory limiter. Adequate for a single-process pilot;
 * it resets on restart, which is acceptable for activation/login throttling.
 */
export function rateLimit(opts: { windowMs: number; max: number; name: string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${opts.name}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
    }
    if (entry.count > opts.max) {
      return next(new ApiError(429, 'rate_limited', { retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) }));
    }
    next();
  };
}

/**
 * Failure-only limiter: a request is refused once an IP has accumulated `max`
 * failures in the window; successful attempts cost nothing.
 */
export function failureLimiter(opts: { windowMs: number; max: number }) {
  const fails = new Map<string, { count: number; resetAt: number }>();
  const key = (req: Request) => req.ip ?? 'unknown';
  return {
    check(req: Request) {
      const e = fails.get(key(req));
      const now = Date.now();
      if (e && e.resetAt > now && e.count >= opts.max) {
        throw new ApiError(429, 'rate_limited', { retryAfterSeconds: Math.ceil((e.resetAt - now) / 1000) });
      }
    },
    fail(req: Request) {
      const now = Date.now();
      let e = fails.get(key(req));
      if (!e || e.resetAt <= now) {
        e = { count: 0, resetAt: now + opts.windowMs };
        fails.set(key(req), e);
      }
      e.count += 1;
      if (fails.size > 10_000) for (const [k, v] of fails) if (v.resetAt <= now) fails.delete(k);
    },
  };
}
