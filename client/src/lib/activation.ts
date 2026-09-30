/**
 * The private activation token arrives in the URL fragment (#t=...), which
 * browsers never send to servers. It is captured once at startup — before any
 * rendering, analytics or navigation — and immediately removed from the address
 * bar and history entry. It then lives only in memory until exchanged.
 */
let captured: { token: string | null; propertyId: string | null } = { token: null, propertyId: null };

export function captureActivationFromUrl() {
  if (window.location.pathname !== '/activate') return;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const propertyId = new URLSearchParams(window.location.search).get('p');
  captured = { token: hash.get('t'), propertyId };
  if (window.location.hash) {
    window.history.replaceState(null, '', '/activate' + (propertyId ? `?p=${encodeURIComponent(propertyId)}` : ''));
  }
}

export function activationCapture() {
  return captured;
}

export function forgetActivationToken() {
  captured = { token: null, propertyId: captured.propertyId };
}
