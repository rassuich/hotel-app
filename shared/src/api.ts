/** DTOs exchanged between the API and the front ends. */
import type {
  AccountRole,
  AttentionFlag,
  ConfirmationMethod,
  DestinationKind,
  GuestProgressKey,
  PosStatus,
  RequestState,
  RequestType,
} from './states';

export type Lang = 'fr' | 'en' | 'es';
export const LANGS: readonly Lang[] = ['fr', 'en', 'es'];
/** Bilingual content plus Spanish; an empty string means "not translated yet". */
export interface Localized {
  fr: string;
  en: string;
  es: string;
}

export interface PropertySummary {
  id: string;
  name: string;
  city: 'casablanca' | 'marrakech';
  cityLabel: Localized;
  tagline: Localized;
  requestsEnabled: boolean;
  currency: string;
  /** True while any sample/demo fixture is still configured for this property. */
  hasDemoContent: boolean;
}

export interface ContentItem {
  id: number;
  kind: 'info' | 'hours' | 'contact' | 'event';
  title: Localized;
  body: Localized;
  startsAt: string | null;
  endsAt: string | null;
  isDemo: boolean;
}

export interface FoodOption {
  id: number;
  name: Localized;
  priceDeltaMinor: number;
  available: boolean;
}
export interface FoodOptionGroup {
  id: number;
  name: Localized;
  minSelect: number;
  maxSelect: number;
  options: FoodOption[];
}
export interface FoodItem {
  id: number;
  categoryId: number;
  name: Localized;
  description: Localized;
  priceMinor: number;
  currency: string;
  available: boolean;
  optionGroups: FoodOptionGroup[];
  isDemo: boolean;
}
export interface FoodCategory {
  id: number;
  name: Localized;
  items: FoodItem[];
}
export interface ServiceItem {
  id: number;
  name: Localized;
  description: Localized;
  complimentary: boolean;
  priceMinor: number;
  currency: string;
  maxQuantity: number;
  allowDetails: boolean;
  available: boolean;
  isDemo: boolean;
}
export interface DeliveryLocation {
  id: number;
  zone: 'pool';
  label: Localized;
}

export interface Destination {
  kind: DestinationKind;
  /** Room label (for kind=room) or delivery location label snapshot. */
  label: Localized;
  roomId?: number;
  locationId?: number;
}

export interface RequestLine {
  itemId: number;
  name: Localized;
  options: { id: number; name: Localized; priceDeltaMinor: number }[];
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  complimentary: boolean;
  details: string | null;
}

export interface ContactAttemptDto {
  attemptNo: number;
  requestedBy: 'initial' | 'guest_retry';
  status: 'pending' | 'confirmed' | 'not_received' | 'superseded';
  method: ConfirmationMethod | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface GuestRequestDto {
  ref: string;
  type: RequestType;
  state: RequestState;
  progress: GuestProgressKey;
  destination: Destination;
  lines: RequestLine[];
  totalMinor: number;
  currency: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  canRequestCallback: boolean;
  attempts: ContactAttemptDto[];
  amendments: { note: string; createdAt: string }[];
}

export interface GuestNoticeDto {
  id: number;
  kind: 'confirmation_not_received';
  requestRef: string | null;
  createdAt: string;
  readAt: string | null;
}

export type GuestCapability = 'order' | 'post_stay';

export interface GuestMeDto {
  capability: GuestCapability;
  property: { id: string; name: string; timezone: string };
  /** Language stored on the session (set at validation, updated when the guest switches). */
  language: Lang;
  roomLabel: string | null;
  guestName: string;
  stayStatus: 'active' | 'checked_out';
  canOrder: boolean;
  orderingBlockedReason: string | null;
}

export interface QuoteLineIssue {
  index: number;
  itemId: number;
  issue: 'unavailable' | 'price_changed' | 'became_chargeable' | 'option_unavailable' | 'quantity_limit';
  quotedUnitPriceMinor?: number;
  currentUnitPriceMinor?: number;
  maxQuantity?: number;
}

export interface StaffRequestDto {
  id: number;
  ref: string;
  type: RequestType;
  state: RequestState;
  revision: number;
  propertyId: string;
  roomLabel: string | null;
  guestName: string;
  stayStatus: 'active' | 'checked_out';
  originalDestination: Destination;
  currentDestination: Destination;
  lines: RequestLine[];
  totalMinor: number;
  currency: string;
  notes: string | null;
  owner: { deviceId: number; name: string; claimedAt: string } | null;
  confirmation: { method: ConfirmationMethod | null; result: 'confirmed' | 'not_received' | null; at: string | null };
  pos: { status: PosStatus; reference: string | null; at: string | null };
  housekeepingContactedAt: string | null;
  attention: { flag: AttentionFlag; at: string | null; detail: string | null };
  attempts: ContactAttemptDto[];
  events: { id: number; type: string; actorLabel: string; data: Record<string, unknown>; createdAt: string }[];
  notices: { id: number; createdAt: string; readAt: string | null; push: string | null }[];
  closeReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffMeDto {
  account: { id: string; role: AccountRole; name: Localized; propertyId: string; propertyName: string };
  device: { id: number; name: string } | null;
}

export interface ApiErrorBody {
  error: { code: string; message?: string; details?: unknown };
}
