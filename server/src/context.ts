import type { AppConfig } from './config';
import type { DB } from './db';
import type { LiveHub } from './live/hub';
import type { PmsAdapter } from './pms/adapter';
import type { BillProvider } from './bills/provider';
import type { PushSender } from './push/sender';
import type { Logger } from './lib/log';

export interface AppContext {
  db: DB;
  config: AppConfig;
  hub: LiveHub;
  pms: PmsAdapter;
  bills: BillProvider;
  push: PushSender;
  log: Logger;
  /** Wakes the notification worker after a notice is persisted. */
  kickNotifications: () => void;
}
