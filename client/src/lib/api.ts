/** Same-origin JSON API client with CSRF double-submit and typed error codes. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public details?: any,
  ) {
    super(code);
  }
}

let csrfToken: string | null = null;

function readCsrfCookie(): string | null {
  const m = document.cookie.match(/(?:^|;\s*)pa_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function ensureCsrf(): Promise<string> {
  csrfToken = readCsrfCookie() ?? csrfToken;
  if (csrfToken) return csrfToken;
  const res = await fetch('/api/csrf', { credentials: 'same-origin' });
  const body = await res.json();
  csrfToken = body.token as string;
  return csrfToken;
}

type Listener = (err: ApiError) => void;
const listeners = new Set<Listener>();
/** Lets the guest/staff shells react globally to revoked sessions. */
export function onApiError(fn: Listener) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = await ensureCsrf();
  }
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.code ?? 'generic', data?.error?.details);
    if (err.code === 'csrf_failed') csrfToken = null;
    listeners.forEach((l) => l(err));
    throw err;
  }
  return data as T;
}

export const get = <T = any>(url: string) => api<T>('GET', url);
export const post = <T = any>(url: string, body: unknown = {}) => api<T>('POST', url, body);
export const patch = <T = any>(url: string, body: unknown = {}) => api<T>('PATCH', url, body);
export const del = <T = any>(url: string) => api<T>('DELETE', url);

/** Random, URL-safe idempotency key for one logical submission. */
export function newKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
