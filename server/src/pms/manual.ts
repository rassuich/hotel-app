import type { DB } from '../db';
import type { PmsAdapter, PmsStatus } from './adapter';

/**
 * Manual/demo adapter: the app's own `stays` tables are the source of truth,
 * maintained by reception as events happen. It never claims live PMS checks.
 */
export class ManualPmsAdapter implements PmsAdapter {
  readonly id = 'manual' as const;
  readonly acceptsManualEvents = true;

  constructor(private db: DB) {}

  status(propertyId: string): PmsStatus {
    const last = this.db
      .prepare('SELECT MAX(updated_at) FROM stays WHERE property_id = ?')
      .pluck()
      .get(propertyId) as string | null;
    return { adapter: 'manual', configured: true, liveChecks: false, lastChangeAt: last, noteCode: 'pms_manual_note' };
  }
}
