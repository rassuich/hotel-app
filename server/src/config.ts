import path from 'node:path';

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export interface AppConfig {
  dbPath: string;
  port: number;
  /** Origin used to build activation QR links, e.g. https://guest.example.com */
  publicBaseUrl: string;
  secureCookies: boolean;
  trustProxy: boolean;
  /** Properties allowed to receive requests (initial release: Palace only). */
  orderingProperties: string[];
  /** Hours a checked-out session keeps restricted post-stay (bill-area) access. 0 disables. */
  postStayAccessHours: number;
  guestSessionDays: number;
  staffSessionHours: number;
  /**
   * Optional, explicit rule: block ordering N hours after the *scheduled* departure
   * even if reception has not checked the stay out. Disabled (null) by default:
   * actual checkout is the rule.
   */
  scheduledDepartureCutoffHours: number | null;
  rateLimit: { windowMs: number; activationMax: number; loginMax: number };
  push: PushConfig | null;
  pmsAdapter: 'manual' | 'pluriel';
  billProvider: 'none';
  clientDist: string | null;
  silentLogs: boolean;
  /**
   * Secret used to HMAC typed validation codes. From ACTIVATION_CODE_SECRET, or
   * generated once into a file next to the database (never inside it).
   */
  codeSecret: string | null;
}

function num(v: string | undefined, fallback: number): number {
  const n = v === undefined || v === '' ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = num(env.PORT, 3000);
  const push =
    env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT || 'mailto:it@example.invalid' }
      : null;
  const pms = env.PMS_ADAPTER === 'pluriel' ? 'pluriel' : 'manual';
  return {
    dbPath: env.DATABASE_PATH || path.resolve('data', 'palace.sqlite'),
    port,
    publicBaseUrl: (env.PUBLIC_BASE_URL || `http://localhost:${env.NODE_ENV === 'production' ? port : 5173}`).replace(/\/$/, ''),
    secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY === 'true',
    orderingProperties: (env.ORDERING_PROPERTIES || 'palace-anfa').split(',').map((s) => s.trim()).filter(Boolean),
    postStayAccessHours: num(env.POST_STAY_ACCESS_HOURS, 72),
    guestSessionDays: num(env.GUEST_SESSION_DAYS, 30),
    staffSessionHours: num(env.STAFF_SESSION_HOURS, 24 * 14),
    scheduledDepartureCutoffHours: env.SCHEDULED_DEPARTURE_CUTOFF_HOURS ? num(env.SCHEDULED_DEPARTURE_CUTOFF_HOURS, 0) : null,
    rateLimit: {
      windowMs: num(env.RATE_LIMIT_WINDOW_MS, 10 * 60_000),
      activationMax: num(env.RATE_LIMIT_ACTIVATION_MAX, 20),
      loginMax: num(env.RATE_LIMIT_LOGIN_MAX, 20),
    },
    push,
    pmsAdapter: pms,
    billProvider: 'none',
    clientDist: env.CLIENT_DIST === '' ? null : env.CLIENT_DIST || path.resolve('dist', 'client'),
    silentLogs: env.SILENT_LOGS === 'true',
    codeSecret: env.ACTIVATION_CODE_SECRET || null,
  };
}
