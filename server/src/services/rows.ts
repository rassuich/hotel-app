/** Row shapes and small shared queries. */
import type { DB } from '../db';
import type { RequestState, RequestType } from '../../../shared/src/states';

export interface PropertyRow {
  id: string;
  name: string;
  city: 'casablanca' | 'marrakech';
  tagline_fr: string;
  tagline_en: string;
  approx_lat: number | null;
  approx_lng: number | null;
  room_count: number | null;
  ref_prefix: string;
  next_ref: number;
  requests_enabled: number;
  activation_check: 'none' | 'room' | 'name';
  currency: string;
  timezone: string;
  sort: number;
}

export interface StayRow {
  id: string;
  property_id: string;
  guest_name: string;
  occupants: number;
  status: 'active' | 'checked_out';
  scheduled_departure: string | null;
  checked_out_at: string | null;
  source: string;
  external_ref: string | null;
  is_demo: number;
  created_at: string;
  updated_at: string;
}

export interface AssignmentRow {
  id: number;
  stay_id: string;
  room_id: number;
  revision: number;
  started_at: string;
  ended_at: string | null;
  room_label: string;
}

export interface GuestSessionRow {
  id: string;
  token_hash: string;
  stay_id: string;
  property_id: string;
  assignment_revision: number;
  capability: 'order' | 'post_stay';
  language: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
}

export interface RequestRow {
  id: number;
  ref: string;
  property_id: string;
  stay_id: string;
  assignment_revision: number;
  type: RequestType;
  department_account_id: string;
  state: RequestState;
  original_destination: string;
  current_destination: string;
  destination_kind: 'room' | 'pool';
  notes: string | null;
  total_minor: number;
  currency: string;
  owner_device_id: number | null;
  claimed_at: string | null;
  revision: number;
  confirmation_method: 'room_call' | 'in_person' | null;
  confirmation_result: 'confirmed' | 'not_received' | null;
  confirmed_at: string | null;
  pos_status: 'not_entered' | 'entered' | 'uncertain';
  pos_reference: string | null;
  pos_updated_at: string | null;
  housekeeping_contacted_at: string | null;
  attention_flag: 'room_moved' | 'checked_out' | null;
  attention_at: string | null;
  attention_detail: string | null;
  close_reason: string | null;
  closed_at: string | null;
  idempotency_key: string;
  created_at: string;
  updated_at: string;
}

export function getProperty(db: DB, id: string): PropertyRow | undefined {
  return db.prepare('SELECT * FROM properties WHERE id = ?').get(id) as PropertyRow | undefined;
}

export function getStay(db: DB, id: string): StayRow | undefined {
  return db.prepare('SELECT * FROM stays WHERE id = ?').get(id) as StayRow | undefined;
}

export function currentAssignment(db: DB, stayId: string): AssignmentRow | undefined {
  return db
    .prepare(
      `SELECT ra.*, r.label AS room_label FROM room_assignments ra
       JOIN rooms r ON r.id = ra.room_id
       WHERE ra.stay_id = ? AND ra.ended_at IS NULL`,
    )
    .get(stayId) as AssignmentRow | undefined;
}

/** Latest assignment (open or closed), used to label rooms for checked-out stays. */
export function latestAssignment(db: DB, stayId: string): AssignmentRow | undefined {
  return db
    .prepare(
      `SELECT ra.*, r.label AS room_label FROM room_assignments ra
       JOIN rooms r ON r.id = ra.room_id
       WHERE ra.stay_id = ? ORDER BY ra.revision DESC LIMIT 1`,
    )
    .get(stayId) as AssignmentRow | undefined;
}
