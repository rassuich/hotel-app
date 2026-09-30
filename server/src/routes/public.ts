import { Router } from 'express';
import type { AppContext } from '../context';
import { notFound } from '../lib/errors';
import { getProperty, type PropertyRow } from '../services/rows';
import { listContent, listLocations, listMenu, listServices } from '../services/catalogue';
import type { PropertySummary } from '../../../shared/src/api';

const CITY_LABEL = {
  casablanca: { fr: 'Casablanca', en: 'Casablanca' },
  marrakech: { fr: 'Marrakech', en: 'Marrakesh' },
};

export function propertySummary(ctx: AppContext, p: PropertyRow): PropertySummary {
  return {
    id: p.id,
    name: p.name,
    city: p.city,
    cityLabel: CITY_LABEL[p.city],
    tagline: { fr: p.tagline_fr, en: p.tagline_en },
    requestsEnabled: !!p.requests_enabled && ctx.config.orderingProperties.includes(p.id),
    currency: p.currency,
    approxLocation: p.approx_lat !== null && p.approx_lng !== null ? { lat: p.approx_lat, lng: p.approx_lng } : null,
  };
}

/** Public, cacheable hotel information. Nothing here is stay-specific. */
export function publicRoutes(ctx: AppContext): Router {
  const r = Router();
  r.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-cache');
    next();
  });

  const prop = (id: string) => {
    const p = getProperty(ctx.db, id);
    if (!p) throw notFound('property_not_found');
    return p;
  };

  r.get('/config', (_req, res) => {
    res.json({ pushPublicKey: ctx.push.publicKey });
  });

  r.get('/properties', (_req, res) => {
    const rows = ctx.db.prepare('SELECT * FROM properties ORDER BY sort, name').all() as PropertyRow[];
    res.json({ properties: rows.map((p) => propertySummary(ctx, p)) });
  });

  r.get('/properties/:id', (req, res) => {
    const p = prop(req.params.id);
    res.json({ property: { ...propertySummary(ctx, p), activationCheck: p.activation_check } });
  });

  r.get('/properties/:id/content', (req, res) => {
    res.json({ content: listContent(ctx.db, prop(req.params.id).id, false) });
  });

  r.get('/properties/:id/menu', (req, res) => {
    const p = prop(req.params.id);
    res.json({ currency: p.currency, categories: listMenu(ctx.db, p.id) });
  });

  r.get('/properties/:id/services', (req, res) => {
    const p = prop(req.params.id);
    res.json({ currency: p.currency, services: listServices(ctx.db, p.id) });
  });

  r.get('/properties/:id/locations', (req, res) => {
    res.json({ locations: listLocations(ctx.db, prop(req.params.id).id) });
  });

  return r;
}
