/**
 * Request (ticket) state machine shared by the server and both front ends.
 *
 * Claim ownership, POS entry and housekeeping hand-off are deliberately kept as
 * separate fields/events rather than extra states (see README "Tickets").
 */
export const REQUEST_TYPES = ['food', 'service'] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const FOOD_STATES = [
  'received',
  'confirming',
  'confirmation_not_received',
  'confirmed',
  'in_progress',
  'completed',
  'rejected',
  'cancelled',
] as const;
export const SERVICE_STATES = ['received', 'being_handled', 'completed', 'rejected', 'cancelled'] as const;

export type FoodState = (typeof FOOD_STATES)[number];
export type ServiceState = (typeof SERVICE_STATES)[number];
export type RequestState = FoodState | ServiceState;

export const TERMINAL_STATES: readonly RequestState[] = ['completed', 'rejected', 'cancelled'];

export function isTerminal(state: RequestState): boolean {
  return TERMINAL_STATES.includes(state);
}

export type DepartmentRole = 'room_service' | 'reception';
export type AccountRole = DepartmentRole | 'admin';

/** Which department receives which request type. */
export function departmentFor(type: RequestType): DepartmentRole {
  return type === 'food' ? 'room_service' : 'reception';
}

export type DestinationKind = 'room' | 'pool';
export type ConfirmationMethod = 'room_call' | 'in_person';
export type PosStatus = 'not_entered' | 'entered' | 'uncertain';
export type AttentionFlag = 'room_moved' | 'checked_out' | null;

/**
 * Staff-driven transitions that change `state`. Claim/takeover/POS/housekeeping/
 * amendment are handled separately and do not appear here.
 */
export const STAFF_STATUS_TRANSITIONS: Record<RequestType, Partial<Record<RequestState, RequestState[]>>> = {
  food: {
    confirmed: ['in_progress'],
    in_progress: ['completed'],
  },
  service: {
    being_handled: ['completed'],
  },
};

export function canStaffMoveTo(type: RequestType, from: RequestState, to: RequestState): boolean {
  return (STAFF_STATUS_TRANSITIONS[type][from] ?? []).includes(to);
}

/** States from which staff may reject/cancel. */
export function canCancel(state: RequestState): boolean {
  return !isTerminal(state);
}

/** Guest-facing progress step (index into a progress bar) for a request. */
export type GuestProgressKey =
  | 'sent'
  | 'confirming'
  | 'confirming_in_person'
  | 'not_reached'
  | 'confirmed'
  | 'preparing'
  | 'delivered'
  | 'handling'
  | 'done'
  | 'declined'
  | 'cancelled';

export function guestProgress(type: RequestType, state: RequestState, destination: DestinationKind): GuestProgressKey {
  if (type === 'service') {
    switch (state) {
      case 'received':
        return 'sent';
      case 'being_handled':
        return 'handling';
      case 'completed':
        return 'done';
      case 'rejected':
        return 'declined';
      default:
        return 'cancelled';
    }
  }
  switch (state) {
    case 'received':
      return 'sent';
    case 'confirming':
      return destination === 'pool' ? 'confirming_in_person' : 'confirming';
    case 'confirmation_not_received':
      return 'not_reached';
    case 'confirmed':
      return 'confirmed';
    case 'in_progress':
      return 'preparing';
    case 'completed':
      return 'delivered';
    case 'rejected':
      return 'declined';
    default:
      return 'cancelled';
  }
}

/** Ordered progress steps for the guest progress indicator. */
export function guestSteps(type: RequestType): GuestProgressKey[] {
  return type === 'food' ? ['sent', 'confirming', 'confirmed', 'preparing', 'delivered'] : ['sent', 'handling', 'done'];
}
