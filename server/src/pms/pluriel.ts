import type { PmsAdapter, PmsStatus } from './adapter';
import { PmsNotConfiguredError } from './adapter';

/**
 * Placeholder for Pluriel Cloud. Deliberately contains NO endpoints: the API
 * documentation is not available yet, and inventing endpoints would be fiction.
 * Selecting it (PMS_ADAPTER=pluriel) makes the server refuse to start.
 */
export class PlurielPmsAdapter implements PmsAdapter {
  readonly id = 'pluriel' as const;
  readonly acceptsManualEvents = false;

  constructor() {
    throw new PmsNotConfiguredError();
  }

  status(_propertyId: string): PmsStatus {
    return { adapter: 'pluriel', configured: false, liveChecks: false, lastChangeAt: null, noteCode: 'pms_pluriel_unconfigured' };
  }
}
