-- Palace d'Anfa guest app: initial schema.
-- Conventions: timestamps are ISO-8601 UTC text; money is integer minor units + currency.
-- Every guest/staff/content table is scoped by property_id so future properties stay isolated.

CREATE TABLE properties (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  city              TEXT NOT NULL CHECK (city IN ('casablanca', 'marrakech')),
  tagline_fr        TEXT NOT NULL DEFAULT '',
  tagline_en        TEXT NOT NULL DEFAULT '',
  approx_lat        REAL,
  approx_lng        REAL,
  room_count        INTEGER,
  ref_prefix        TEXT NOT NULL,
  next_ref          INTEGER NOT NULL DEFAULT 1,
  requests_enabled  INTEGER NOT NULL DEFAULT 0 CHECK (requests_enabled IN (0, 1)),
  activation_check  TEXT NOT NULL DEFAULT 'room' CHECK (activation_check IN ('none', 'room', 'name')),
  currency          TEXT NOT NULL DEFAULT 'MAD',
  timezone          TEXT NOT NULL DEFAULT 'Africa/Casablanca',
  sort              INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE TABLE rooms (
  id           INTEGER PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id),
  label        TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  is_demo      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (property_id, label)
);

CREATE TABLE delivery_locations (
  id           INTEGER PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id),
  zone         TEXT NOT NULL DEFAULT 'pool' CHECK (zone IN ('pool')),
  label_fr     TEXT NOT NULL,
  label_en     TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort         INTEGER NOT NULL DEFAULT 0,
  is_demo      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE stays (
  id                   TEXT PRIMARY KEY,
  property_id          TEXT NOT NULL REFERENCES properties(id),
  guest_name           TEXT NOT NULL,
  occupants            INTEGER NOT NULL DEFAULT 1,
  status               TEXT NOT NULL CHECK (status IN ('active', 'checked_out')),
  scheduled_departure  TEXT,
  checked_out_at       TEXT,
  source               TEXT NOT NULL DEFAULT 'manual',
  external_ref         TEXT,
  is_demo              INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX stays_property_status ON stays(property_id, status);

CREATE TABLE room_assignments (
  id          INTEGER PRIMARY KEY,
  stay_id     TEXT NOT NULL REFERENCES stays(id),
  room_id     INTEGER NOT NULL REFERENCES rooms(id),
  revision    INTEGER NOT NULL,
  started_at  TEXT NOT NULL,
  ended_at    TEXT,
  end_reason  TEXT,
  UNIQUE (stay_id, revision)
);
-- A stay has at most one current room, and a room hosts at most one current stay.
CREATE UNIQUE INDEX room_assignments_open_stay ON room_assignments(stay_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX room_assignments_open_room ON room_assignments(room_id) WHERE ended_at IS NULL;

-- Private reception-issued activation QR. Only a SHA-256 hash of the token is stored.
CREATE TABLE activation_credentials (
  id                   INTEGER PRIMARY KEY,
  stay_id              TEXT NOT NULL REFERENCES stays(id),
  token_hash           TEXT NOT NULL UNIQUE,
  assignment_revision  INTEGER NOT NULL,
  created_at           TEXT NOT NULL,
  revoked_at           TEXT,
  revoke_reason        TEXT
);
CREATE INDEX activation_credentials_stay ON activation_credentials(stay_id);

CREATE TABLE guest_sessions (
  id                   TEXT PRIMARY KEY,
  token_hash           TEXT NOT NULL UNIQUE,
  stay_id              TEXT NOT NULL REFERENCES stays(id),
  property_id          TEXT NOT NULL REFERENCES properties(id),
  assignment_revision  INTEGER NOT NULL,
  capability           TEXT NOT NULL CHECK (capability IN ('order', 'post_stay')),
  language             TEXT NOT NULL DEFAULT 'fr',
  -- Explicit per-session authorization to view real folio content (off by default;
  -- only meaningful once a bill provider is configured).
  bill_access          INTEGER NOT NULL DEFAULT 0 CHECK (bill_access IN (0, 1)),
  created_at           TEXT NOT NULL,
  last_seen_at         TEXT NOT NULL,
  expires_at           TEXT,
  revoked_at           TEXT,
  revoke_reason        TEXT
);
CREATE INDEX guest_sessions_stay ON guest_sessions(stay_id);

CREATE TABLE push_subscriptions (
  id                INTEGER PRIMARY KEY,
  guest_session_id  TEXT NOT NULL REFERENCES guest_sessions(id) ON DELETE CASCADE,
  endpoint          TEXT NOT NULL UNIQUE,
  keys_json         TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

-- Shared department accounts (room service / reception) and property admin accounts.
CREATE TABLE department_accounts (
  id               TEXT PRIMARY KEY,
  property_id      TEXT NOT NULL REFERENCES properties(id),
  role             TEXT NOT NULL CHECK (role IN ('room_service', 'reception', 'admin')),
  username         TEXT NOT NULL UNIQUE,
  display_name_fr  TEXT NOT NULL,
  display_name_en  TEXT NOT NULL,
  password_hash    TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at       TEXT NOT NULL
);
CREATE UNIQUE INDEX department_accounts_one_per_role
  ON department_accounts(property_id, role) WHERE role IN ('room_service', 'reception');

CREATE TABLE devices (
  id          INTEGER PRIMARY KEY,
  account_id  TEXT NOT NULL REFERENCES department_accounts(id),
  name        TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at  TEXT NOT NULL,
  UNIQUE (account_id, name)
);

CREATE TABLE staff_sessions (
  id            TEXT PRIMARY KEY,
  token_hash    TEXT NOT NULL UNIQUE,
  account_id    TEXT NOT NULL REFERENCES department_accounts(id),
  device_id     INTEGER REFERENCES devices(id),
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT
);

CREATE TABLE content_items (
  id           INTEGER PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id),
  kind         TEXT NOT NULL CHECK (kind IN ('info', 'hours', 'contact', 'event')),
  title_fr     TEXT NOT NULL,
  title_en     TEXT NOT NULL,
  body_fr      TEXT NOT NULL DEFAULT '',
  body_en      TEXT NOT NULL DEFAULT '',
  starts_at    TEXT,
  ends_at      TEXT,
  public       INTEGER NOT NULL DEFAULT 1 CHECK (public IN (0, 1)),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort         INTEGER NOT NULL DEFAULT 0,
  is_demo      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE food_categories (
  id           INTEGER PRIMARY KEY,
  property_id  TEXT NOT NULL REFERENCES properties(id),
  name_fr      TEXT NOT NULL,
  name_en      TEXT NOT NULL,
  sort         INTEGER NOT NULL DEFAULT 0,
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE TABLE food_items (
  id              INTEGER PRIMARY KEY,
  property_id     TEXT NOT NULL REFERENCES properties(id),
  category_id     INTEGER NOT NULL REFERENCES food_categories(id),
  name_fr         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  description_fr  TEXT NOT NULL DEFAULT '',
  description_en  TEXT NOT NULL DEFAULT '',
  price_minor     INTEGER NOT NULL CHECK (price_minor >= 0),
  currency        TEXT NOT NULL DEFAULT 'MAD',
  available       INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort            INTEGER NOT NULL DEFAULT 0,
  is_demo         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE food_option_groups (
  id            INTEGER PRIMARY KEY,
  food_item_id  INTEGER NOT NULL REFERENCES food_items(id) ON DELETE CASCADE,
  name_fr       TEXT NOT NULL,
  name_en       TEXT NOT NULL,
  min_select    INTEGER NOT NULL DEFAULT 0,
  max_select    INTEGER NOT NULL DEFAULT 1,
  sort          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE food_options (
  id                 INTEGER PRIMARY KEY,
  group_id           INTEGER NOT NULL REFERENCES food_option_groups(id) ON DELETE CASCADE,
  name_fr            TEXT NOT NULL,
  name_en            TEXT NOT NULL,
  price_delta_minor  INTEGER NOT NULL DEFAULT 0 CHECK (price_delta_minor >= 0),
  available          INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  sort               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE service_items (
  id              INTEGER PRIMARY KEY,
  property_id     TEXT NOT NULL REFERENCES properties(id),
  name_fr         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  description_fr  TEXT NOT NULL DEFAULT '',
  description_en  TEXT NOT NULL DEFAULT '',
  complimentary   INTEGER NOT NULL DEFAULT 1 CHECK (complimentary IN (0, 1)),
  price_minor     INTEGER NOT NULL DEFAULT 0 CHECK (price_minor >= 0),
  currency        TEXT NOT NULL DEFAULT 'MAD',
  max_quantity    INTEGER NOT NULL DEFAULT 4 CHECK (max_quantity >= 1),
  allow_details   INTEGER NOT NULL DEFAULT 0 CHECK (allow_details IN (0, 1)),
  available       INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  sort            INTEGER NOT NULL DEFAULT 0,
  is_demo         INTEGER NOT NULL DEFAULT 0,
  CHECK (complimentary = 0 OR price_minor = 0)
);

CREATE TABLE requests (
  id                         INTEGER PRIMARY KEY,
  ref                        TEXT NOT NULL UNIQUE,
  property_id                TEXT NOT NULL REFERENCES properties(id),
  stay_id                    TEXT NOT NULL REFERENCES stays(id),
  assignment_revision        INTEGER NOT NULL,
  type                       TEXT NOT NULL CHECK (type IN ('food', 'service')),
  department_account_id      TEXT NOT NULL REFERENCES department_accounts(id),
  state                      TEXT NOT NULL,
  original_destination       TEXT NOT NULL,
  current_destination        TEXT NOT NULL,
  destination_kind           TEXT NOT NULL CHECK (destination_kind IN ('room', 'pool')),
  notes                      TEXT,
  total_minor                INTEGER NOT NULL,
  currency                   TEXT NOT NULL,
  owner_device_id            INTEGER REFERENCES devices(id),
  claimed_at                 TEXT,
  revision                   INTEGER NOT NULL DEFAULT 1,
  confirmation_method        TEXT CHECK (confirmation_method IN ('room_call', 'in_person')),
  confirmation_result        TEXT CHECK (confirmation_result IN ('confirmed', 'not_received')),
  confirmed_at               TEXT,
  pos_status                 TEXT NOT NULL DEFAULT 'not_entered' CHECK (pos_status IN ('not_entered', 'entered', 'uncertain')),
  pos_reference              TEXT,
  pos_updated_at             TEXT,
  housekeeping_contacted_at  TEXT,
  attention_flag             TEXT CHECK (attention_flag IN ('room_moved', 'checked_out')),
  attention_at               TEXT,
  attention_detail           TEXT,
  close_reason               TEXT,
  closed_at                  TEXT,
  idempotency_key            TEXT NOT NULL,
  created_at                 TEXT NOT NULL,
  updated_at                 TEXT NOT NULL,
  UNIQUE (stay_id, idempotency_key)
);
CREATE INDEX requests_queue ON requests(department_account_id, state);
CREATE INDEX requests_stay ON requests(stay_id);

CREATE TABLE request_lines (
  id                INTEGER PRIMARY KEY,
  request_id        INTEGER NOT NULL REFERENCES requests(id),
  line_no           INTEGER NOT NULL,
  item_kind         TEXT NOT NULL CHECK (item_kind IN ('food', 'service')),
  item_id           INTEGER NOT NULL,
  name_fr           TEXT NOT NULL,
  name_en           TEXT NOT NULL,
  options_json      TEXT NOT NULL DEFAULT '[]',
  unit_price_minor  INTEGER NOT NULL,
  quantity          INTEGER NOT NULL CHECK (quantity > 0),
  line_total_minor  INTEGER NOT NULL,
  complimentary     INTEGER NOT NULL DEFAULT 0,
  details           TEXT,
  UNIQUE (request_id, line_no)
);

CREATE TABLE request_events (
  id           INTEGER PRIMARY KEY,
  request_id   INTEGER NOT NULL REFERENCES requests(id),
  type         TEXT NOT NULL,
  actor_type   TEXT NOT NULL CHECK (actor_type IN ('guest', 'device', 'staff', 'system')),
  actor_id     TEXT,
  actor_label  TEXT NOT NULL,
  data_json    TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);
CREATE INDEX request_events_request ON request_events(request_id);

CREATE TABLE contact_attempts (
  id               INTEGER PRIMARY KEY,
  request_id       INTEGER NOT NULL REFERENCES requests(id),
  attempt_no       INTEGER NOT NULL,
  requested_by     TEXT NOT NULL CHECK (requested_by IN ('initial', 'guest_retry')),
  status           TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'not_received', 'superseded')),
  method           TEXT CHECK (method IN ('room_call', 'in_person')),
  device_id        INTEGER REFERENCES devices(id),
  idempotency_key  TEXT,
  created_at       TEXT NOT NULL,
  resolved_at      TEXT,
  UNIQUE (request_id, attempt_no)
);
-- At most one pending confirmation attempt per ticket: coalesces duplicate callback taps.
CREATE UNIQUE INDEX contact_attempts_one_pending ON contact_attempts(request_id) WHERE status = 'pending';

CREATE TABLE guest_notices (
  id           INTEGER PRIMARY KEY,
  stay_id      TEXT NOT NULL REFERENCES stays(id),
  request_id   INTEGER REFERENCES requests(id),
  kind         TEXT NOT NULL CHECK (kind IN ('confirmation_not_received')),
  params_json  TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL,
  read_at      TEXT
);
CREATE INDEX guest_notices_stay ON guest_notices(stay_id);

CREATE TABLE notification_jobs (
  id          INTEGER PRIMARY KEY,
  notice_id   INTEGER NOT NULL REFERENCES guest_notices(id),
  channel     TEXT NOT NULL CHECK (channel IN ('web_push')),
  status      TEXT NOT NULL CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX notification_jobs_status ON notification_jobs(status);

CREATE TABLE app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
