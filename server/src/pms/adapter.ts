/**
 * PMS boundary. Everything that reads "who is in which room" or applies stay
 * changes goes through here, so the manual adapter can later be swapped for a
 * real Pluriel Cloud adapter without touching routes or ticket logic.
 */
export interface PmsStatus {
  adapter: 'manual' | 'pluriel';
  configured: boolean;
  /** True only when stay/room data is checked live against the PMS. */
  liveChecks: boolean;
  /** Most recent stay change known to this app (manual entry or import). */
  lastChangeAt: string | null;
  noteCode: string;
}

/** Stay-change events, whether typed by reception or (later) received from the PMS. */
export type StayEvent =
  | { kind: 'check_in'; guestName: string; roomId: number; occupants: number; scheduledDeparture: string | null; externalRef?: string | null }
  | { kind: 'update'; stayId: string; guestName?: string; occupants?: number; scheduledDeparture?: string | null }
  | { kind: 'room_move'; stayId: string; roomId: number }
  | { kind: 'check_out'; stayId: string };

export interface PmsAdapter {
  readonly id: 'manual' | 'pluriel';
  /** Whether reception may enter stay events by hand through the admin screens. */
  readonly acceptsManualEvents: boolean;
  status(propertyId: string): PmsStatus;
}

export class PmsNotConfiguredError extends Error {
  constructor() {
    super('Pluriel Cloud adapter is not configured: no API documentation or credentials are available yet.');
  }
}
