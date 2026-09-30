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
