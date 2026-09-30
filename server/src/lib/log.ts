/**
 * Minimal, secret-free logging. Never pass request bodies, cookies, tokens or
 * guest names here: log codes, ids and counts only.
 */
type Level = 'info' | 'warn' | 'error';

export interface Logger {
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

const REDACT = /token|password|secret|cookie|authorization|key/i;

function scrub(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) out[k] = REDACT.test(k) ? '[redacted]' : v;
  return out;
}

export function createLogger(silent = false): Logger {
  const write = (level: Level, msg: string, data?: Record<string, unknown>) => {
    if (silent) return;
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...scrub(data) });
    if (level === 'error') console.error(line);
    else console.log(line);
  };
  return {
    info: (m, d) => write('info', m, d),
    warn: (m, d) => write('warn', m, d),
    error: (m, d) => write('error', m, d),
  };
}
