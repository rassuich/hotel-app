import type { PushConfig } from '../config';

export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type PushResult = { ok: true } | { ok: false; gone: boolean; error: string };

export interface PushSender {
  readonly configured: boolean;
  readonly publicKey: string | null;
  send(sub: PushSubscriptionData, payload: string): Promise<PushResult>;
}

export class DisabledPushSender implements PushSender {
  readonly configured = false;
  readonly publicKey = null;
  async send(): Promise<PushResult> {
    return { ok: false, gone: false, error: 'push_unconfigured' };
  }
}

/** Web Push using VAPID credentials from the environment. */
export async function createPushSender(config: PushConfig | null): Promise<PushSender> {
  if (!config) return new DisabledPushSender();
  const webpush = (await import('web-push')).default;
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return {
    configured: true,
    publicKey: config.publicKey,
    async send(sub, payload) {
      try {
        await webpush.sendNotification(sub, payload, { TTL: 3600 });
        return { ok: true };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return { ok: false, gone: status === 404 || status === 410, error: `push_http_${status ?? 'error'}` };
      }
    },
  };
}
