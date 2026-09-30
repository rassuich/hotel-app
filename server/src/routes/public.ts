import { Router } from 'express';
import type { AppContext } from '../context';
import { notFound } from '../lib/errors';
import { getProperty, type PropertyRow } from '../services/rows';
import type { PropertySummary } from '../../../shared/src/api';

const CITY_LABEL = {
  casablanca: { fr: 'Casablanca', en: 'Casablanca', es: 'Casablanca' },
  marrakech: { fr: 'Marrakech', en: 'Marrakesh', es: 'Marrakech' },
};

export function propertySummary(ctx: AppContext, p: PropertyRow): PropertySummary {
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    cityLabel: CITY_LABEL[p.city],
    tagline: { fr: p.tagline_fr, en: p.tagline_en, es: p.tagline_es ?? '' },
    requestsEnabled: !!p.requests_enabled && ctx.config.orderingProperties.includes(p.id),
    currency: p.currency,
    hasDemoContent: !!ctx.db
      .prepare(
        `SELECT EXISTS(SELECT 1 FROM content_items WHERE property_id = @p AND is_demo = 1)
             OR EXISTS(SELECT 1 FROM food_items WHERE property_id = @p AND is_demo = 1)
             OR EXISTS(SELECT 1 FROM service_items WHERE property_id = @p AND is_demo = 1)
             OR EXISTS(SELECT 1 FROM rooms WHERE property_id = @p AND is_demo = 1)`,
      )
      .pluck()
      .get({ p: p.id }),
  };
}

/**
 * Public surface is deliberately minimal: only hotel guests may see content, so
 * menus, services and information are served from /api/guest/catalog/* behind a
 * session. The gate screen may still show which hotel a private link belongs to.
 */
export function publicRoutes(ctx: AppContext): Router {
  const r = Router();
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache');
    next();
  });

  r.get('/config', (_req, res) => {
    res.json({ pushPublicKey: ctx.push.publicKey });
  });

  r.get('/properties/:id', (req, res) => {
    const p = getProperty(ctx.db, req.params.id);
    if (!p) throw notFound('property_not_found');
    res.json({ property: { id: p.id, name: p.name, city: p.city, activationCheck: p.activation_check } });
  });

  return r;
}
