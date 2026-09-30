import type { Response } from 'express';

/**
 * Server-Sent Events hub. Live messages are *hints* only ("ticket 12 changed,
 * revision 5"); clients always re-read state over HTTP, and they reload the full
 * queue/history on every (re)connect. Tickets are persisted before any publish.
 */
export interface LiveEvent {
  type: string;
  [key: string]: unknown;
}

interface Client {
  res: Response;
  channels: string[];
  /** Re-checked on every heartbeat; returning false closes the stream (revocation). */
  stillValid: () => boolean;
}

export class LiveHub {
  private channels = new Map<string, Set<Client>>();
  private timer: NodeJS.Timeout;

  constructor(heartbeatMs = 20_000) {
    this.timer = setInterval(() => this.heartbeat(), heartbeatMs);
    this.timer.unref();
  }

  subscribe(res: Response, channels: string[], stillValid: () => boolean): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const client: Client = { res, channels, stillValid };
    for (const c of channels) {
      if (!this.channels.has(c)) this.channels.set(c, new Set());
      this.channels.get(c)!.add(client);
    }
    this.send(client, { type: 'hello' });
    res.on('close', () => this.remove(client));
  }

  publish(channel: string, event: LiveEvent): void {
    for (const client of this.channels.get(channel) ?? []) this.send(client, event);
  }

  /** Sends a final event and closes every stream on the channel (e.g. session revoked). */
  closeChannel(channel: string, finalEvent?: LiveEvent): void {
    for (const client of [...(this.channels.get(channel) ?? [])]) {
      if (finalEvent) this.send(client, finalEvent);
      client.res.end();
      this.remove(client);
    }
  }

  connectionCount(channel: string): number {
    return this.channels.get(channel)?.size ?? 0;
  }

  close(): void {
    clearInterval(this.timer);
    for (const set of this.channels.values()) for (const c of set) c.res.end();
    this.channels.clear();
  }

  private send(client: Client, event: LiveEvent) {
    client.res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private heartbeat() {
    const seen = new Set<Client>();
    for (const set of this.channels.values()) {
      for (const client of set) {
        if (seen.has(client)) continue;
        seen.add(client);
        let valid = false;
        try {
          valid = client.stillValid();
        } catch {
          valid = false;
        }
        if (!valid) {
          this.send(client, { type: 'session.revoked' });
          client.res.end();
          this.remove(client);
        } else {
          client.res.write(': ping\n\n');
        }
      }
    }
  }

  private remove(client: Client) {
    for (const c of client.channels) {
      const set = this.channels.get(c);
      set?.delete(client);
      if (set && set.size === 0) this.channels.delete(c);
    }
  }
}

export const channels = {
  department: (accountId: string) => `dept:${accountId}`,
  stay: (stayId: string) => `stay:${stayId}`,
  property: (propertyId: string) => `property:${propertyId}`,
};
