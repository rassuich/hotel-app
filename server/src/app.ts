import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { AppConfig } from './config';
import type { AppContext } from './context';
import { migrate, openDatabase, type DB } from './db';
import { LiveHub } from './live/hub';
import { createLogger, type Logger } from './lib/log';
import { csrf, errorHandler, noStore, requestLog, securityHeaders } from './lib/http';
import { ManualPmsAdapter } from './pms/manual';
import { PlurielPmsAdapter } from './pms/pluriel';
import type { PmsAdapter } from './pms/adapter';
import { UnconfiguredBillProvider, type BillProvider } from './bills/provider';
import { createPushSender, type PushSender } from './push/sender';
import { NotificationWorker } from './services/notifications';
import { publicRoutes } from './routes/public';
import { guestRoutes } from './routes/guest';
import { staffRoutes } from './routes/staff';
import { adminRoutes } from './routes/admin';

export interface BuiltApp {
  app: express.Express;
  ctx: AppContext;
  worker: NotificationWorker;
  close: () => void;
}

export interface BuildOptions {
  db?: DB;
  push?: PushSender;
  bills?: BillProvider;
  pms?: PmsAdapter;
  logger?: Logger;
  heartbeatMs?: number;
  startWorker?: boolean;
}

/** Loads (or creates once, mode 0600) the validation-code secret stored beside the database file. */
function resolveCodeSecret(config: AppConfig): string {
  if (config.codeSecret) return config.codeSecret;
  if (config.dbPath === ':memory:') return randomBytes(32).toString('hex');
  const file = path.join(path.dirname(config.dbPath), 'activation-code.secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, secret + '\n', { mode: 0o600 });
  return secret;
}

export async function buildApp(inputConfig: AppConfig, opts: BuildOptions = {}): Promise<BuiltApp> {
  const config: AppConfig = { ...inputConfig, codeSecret: resolveCodeSecret(inputConfig) };
  const db = opts.db ?? openDatabase(config.dbPath);
  migrate(db);
  const log = opts.logger ?? createLogger(config.silentLogs);
  const pms = opts.pms ?? (config.pmsAdapter === 'pluriel' ? new PlurielPmsAdapter() : new ManualPmsAdapter(db));
  const ctx: AppContext = {
    db,
    config,
    hub: new LiveHub(opts.heartbeatMs),
    pms,
    bills: opts.bills ?? new UnconfiguredBillProvider(),
    push: opts.push ?? (await createPushSender(config.push)),
    log,
    kickNotifications: () => worker.kick(),
  };
  const worker = new NotificationWorker(ctx);

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(securityHeaders);
  app.use(cookieParser());
  app.use('/api', requestLog(log));
  app.use('/api', express.json({ limit: '64kb' }));
  app.use('/api', csrf(config.secureCookies));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/api/csrf', noStore, (req, res) => {
    res.json({ token: req.cookies.pa_csrf });
  });
  app.use('/api/public', publicRoutes(ctx));
  app.use('/api/guest', noStore, guestRoutes(ctx));
  app.use('/api/staff', noStore, staffRoutes(ctx));
  app.use('/api/admin', noStore, adminRoutes(ctx));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: { code: 'not_found' } });
  });

  // Production: serve the built PWA. Hashed assets are immutable; the shell and
  // service worker must always be revalidated.
  if (config.clientDist && existsSync(path.join(config.clientDist, 'index.html'))) {
    const dist = config.clientDist;
    app.use(
      express.static(dist, {
        index: false,
        setHeaders(res, file) {
          if (file.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          else res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  app.use(errorHandler(log));

  if (opts.startWorker !== false) worker.start();

  return {
    app,
    ctx,
    worker,
    close: () => {
      worker.stop();
      ctx.hub.close();
    },
  };
}
