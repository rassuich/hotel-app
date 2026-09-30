/** Interprets the text of a scanned QR: a private stay link, a typed-code QR, or neither. */
export type Scanned = { kind: 'token'; token: string; propertyId: string | null } | { kind: 'code'; code: string } | { kind: 'other' };

const CODE = /^[0-9A-Z]{12}$/;

export function parseScanned(text: string): Scanned {
  const raw = text.trim();
  try {
    const url = new URL(raw);
    if (url.pathname === '/activate') {
      const token = new URLSearchParams(url.hash.slice(1)).get('t');
      if (token && token.length >= 20) return { kind: 'token', token, propertyId: url.searchParams.get('p') };
    }
    return { kind: 'other' };
  } catch {
    /* not a URL */
  }
  const compact = raw.toUpperCase().replace(/[\s-]/g, '');
  return CODE.test(compact) ? { kind: 'code', code: compact } : { kind: 'other' };
}
