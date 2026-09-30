import { get, post } from './api';

function b64ToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'enabled' | 'available';

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  const { pushPublicKey } = await get<{ pushPublicKey: string | null }>('/api/public/config');
  if (!pushPublicKey) return 'unconfigured';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'enabled' : 'available';
}

/** Opt-in only, after an explicit tap. Absence of permission never blocks requests. */
export async function enablePush(): Promise<PushState> {
  const { pushPublicKey } = await get<{ pushPublicKey: string | null }>('/api/public/config');
  if (!pushPublicKey) return 'unconfigured';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(pushPublicKey) as BufferSource });
  await post('/api/guest/push-subscription', sub.toJSON());
  return 'enabled';
}
