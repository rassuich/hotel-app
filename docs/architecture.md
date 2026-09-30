# Architecture and implementation decisions

## Layout

```
shared/src/     state machine, money helpers, API DTO types (used by server and client)
server/src/
  app.ts        Express app factory (used by index.ts, the CLI and tests)
  config.ts     environment → typed config
  db/           SQLite open + migration runner; migrations/*.sql
  services/     stays (lifecycle), guestAuth, staffAuth, catalogue (quoting), requests (tickets),
                notifications (push worker)
  routes/       public, guest, staff, admin + zod schemas
  live/hub.ts   Server-Sent Events hub
  pms/          PmsAdapter boundary: manual adapter, unconfigured Pluriel placeholder
  bills/        BillProvider boundary: unconfigured provider
  push/         Web Push sender (VAPID) or disabled sender
  seed/         base configuration vs. demo fixtures
  cli.ts        migrate | seed-demo | reset-demo | backup | generate-vapid
server/test/    API integration tests (supertest, in-memory or temp-file SQLite)
client/         Vite root: index.html, public/ (manifest, sw.js, icons), src/
  src/pages/guest|staff|admin, src/i18n/{fr,en}.json, src/lib (api, live, cart, guest session)
e2e/            Playwright scenarios against the built app
```

Commands use ordinary HTTP (JSON, CSRF-protected). Live updates use **one authenticated SSE
stream** per client (`/api/guest/stream`, `/api/staff/stream`). Events are hints
(`request.created`, `request.updated`, `notice.created`, `session.revoked`); on every (re)connect the
client reloads the queue/history over HTTP. Tickets are committed to SQLite *before* any publish,
so a missed alert or a server restart loses nothing.

## Data model (migration `001_initial.sql`)

| Table | Purpose |
|---|---|
| `properties` | Palace, Hôtel Suisse, Palm Plaza, Palm Appart Club; `requests_enabled`, `activation_check`, ref prefix, currency |
| `rooms`, `delivery_locations` | Room labels; pool tables/loungers (configurable, active flag) |
| `stays`, `room_assignments` | Stable stay ID; assignment **revision** increments on every move. Partial unique indexes: one open room per stay, one open stay per room |
| `activation_credentials` | SHA-256 of the private QR token, bound to stay + assignment revision; revocable |
| `guest_sessions` | Server-revocable session (hash of cookie token), `capability` = `order` or `post_stay`, `bill_access`, expiry |
| `push_subscriptions` | Per guest session |
| `department_accounts`, `devices`, `staff_sessions` | Shared Room Service / Reception accounts (one per property), named tablets, admin accounts |
| `content_items`, `food_categories`, `food_items`, `food_option_groups`, `food_options`, `service_items` | Bilingual catalogue/content; `is_demo` flags |
| `requests` | Ticket: property, stay, assignment revision, type, department, state, immutable `original_destination` + reviewed `current_destination`, totals (minor units + currency), owner device, **revision**, confirmation method/result, POS status/reference, housekeeping timestamp, attention flag, close reason, idempotency key (unique per stay) |
| `request_lines` | Snapshot of names, options and prices at submission |
| `request_events` | Append-only history (submitted, claimed, taken_over, confirmed, confirmation_not_received, amended, pos_*, housekeeping_contacted, status_*, callback_requested, attention_flagged/resolved, cancelled/rejected) |
| `contact_attempts` | Confirmation attempts; partial unique index guarantees **at most one pending attempt per ticket** |
| `guest_notices`, `notification_jobs` | In-app notice (source of truth, `read_at`) and outside-app push job (`pending/sent/skipped/failed`) |

Money is always integer minor units with an explicit currency (default MAD).

## Ticket state machine

| Type | Normal flow | Other outcomes |
|---|---|---|
| Food | received → confirming → confirmed → in_progress → completed | confirmation_not_received, rejected, cancelled |
| Service | received → being_handled → completed | rejected, cancelled |

- **Claim** (`owner_device_id`) is separate from confirmation; claiming moves `received` to
  `confirming`/`being_handled` but is not guest confirmation.
- **Food cannot reach `in_progress`/`completed` without `confirmation_result = confirmed`**
  (checked in the service, not only the UI). Room orders are confirmed by `room_call`, pool orders
  `in_person`.
- **POS entry** (`pos_status`: not_entered / entered / uncertain + reference) and **housekeeping
  hand-off** are fields + events, not guest-visible states. Uncertain entries stay in *À vérifier*.
- Cancelling after (possible) POS entry requires a written POS decision.
- Guest-facing progress is derived in `shared/src/states.ts` (`guestProgress`), so "sent" is never
  shown as "confirmed".

### Concurrency

- **Claim**: `UPDATE … SET owner_device_id = ? WHERE id = ? AND owner_device_id IS NULL AND revision = ?`
  — exactly one tablet wins; the loser gets `already_claimed`.
- Every staff write carries `expectedRevision`; the update is conditional on it and bumps it.
  Stale tablets get `stale_revision` and reload. Claims survive refresh/disconnect; they are
  never auto-released. **Takeover** by another tablet of the same account requires a reason and
  is recorded.
- **Submission idempotency**: `UNIQUE(stay_id, idempotency_key)`; a retried/double submission
  returns the original ticket. The cart keeps its key until success so a lost response is safe.
- **Callback coalescing**: same idempotency key → same attempt; while a guest-requested attempt is
  pending, further taps from any device join it; the DB forbids two pending attempts.

### Failed confirmation and callback

`not_received` atomically: sets the state, resolves the attempt, **releases the claim**, inserts the
guest notice **and** a push job, in one transaction. The guest's *Request another confirmation
call* revalidates session, stay, room revision and ticket state, then creates attempt *n+1*, sets
the ticket back to `received` (unowned) and re-alerts the department. It cannot reopen confirmed,
POS-entered, completed or cancelled work.

## Stay lifecycle and access

- The **private QR** contains only a 256-bit random token (`/activate?p=<property>#t=<token>`). The
  fragment is never sent to servers; the client captures it before rendering, strips it with
  `history.replaceState`, and POSTs it once. Only its hash is stored. The property id in the query
  is not secret; it only selects which verification field to show.
- Activation also asks for the **room number** (`properties.activation_check`: `room`, `name` or
  `none`). All failures return the same `activation_failed`; activation is rate-limited per IP.
- The **public hotel QR** (`/p/palace-anfa`) only selects a property.
- Every guest request re-validates the session on the server: not revoked/expired, stay active,
  and session assignment revision = current revision. Old screens and missed live events cannot
  bypass this. The SSE heartbeat also re-checks and closes revoked streams.
- **Room move** (one transaction): end old assignment, open revision+1, revoke all QR credentials
  and sessions, flag unfinished tickets (`attention_flag = room_moved`, original destination kept),
  issue a new QR. Staff resolve each flagged ticket (optionally re-pointing it to the current room)
  before calling/delivering.
- **Checkout**: stay `checked_out`, assignment ended, QR revoked, sessions downgraded to
  `post_stay` (bill area only, expires after `POST_STAY_ACCESS_HOURS`; or revoked if 0), push
  subscriptions deleted, unfinished tickets flagged `checked_out` (never discarded). Submissions and
  callbacks are refused server-side.
- **Occupant change**: rotate the QR with `occupant_change` → all devices signed out, new QR for
  the remaining occupants. A **reprint** rotates the QR but keeps devices signed in.
- **Scheduled departure** is stored and overdue stays are highlighted. An automatic cutoff exists
  only if `SCHEDULED_DEPARTURE_CUTOFF_HOURS` is set explicitly (off by default).

## Integrations (honest status)

- **PMS** — `PmsAdapter` in `server/src/pms/`. All stay changes go through
  `applyStayEvent()` (check_in / update / room_move / check_out), whether typed by reception or,
  later, received from Pluriel. The **manual adapter** reports `liveChecks: false` and the latest
  change time; staff screens show "manual entry, no live PMS check". `PlurielPmsAdapter` contains no
  endpoints and throws if selected. A nightly export alone would not reveal daytime moves or early
  checkouts, so reception must record those events as they happen. (No import is implemented; if
  one is added it must preview/validate and never let an older file undo newer manual events.)
- **Bills** — `BillProvider` is unconfigured: the bill area says "contact reception" and states
  that app requests are not the hotel bill. Real folio content additionally requires
  `guest_sessions.bill_access = 1` for that specific session (tested with a fake provider); no
  roommate gets it by default. No totals or invoices are ever invented.
- **Push** — optional VAPID config. Absent config: subscription endpoint returns
  `push_unconfigured`, jobs are marked `skipped`, the in-app notice still works. Staff see whether a
  notice was pushed and whether it was read.

## Catalogue rules

Prices, availability, options and destinations are re-derived on submission. If the guest's quoted
unit price/total differs, an item/option became unavailable, a quantity limit is exceeded, or a
complimentary service became chargeable, the API returns `409 quote_changed` with per-line issues;
the guest must accept the updated order (or remove items) before re-sending. Request lines snapshot
names/options/prices, so later edits never change history.

## Implementation defaults chosen

- One food ticket per cart; one Services ticket per service request.
- Services and food can go to the room or a labelled pool location.
- Request history is shared by all devices of a stay.
- Staff amendments are recorded as events with an optional new total; original lines stay intact.
- Staff alerts: in-page banner, blinking title and an optional chime (enabled by a tap, as browsers
  require). No system-wide pop-ups are claimed for the POS terminals.
- Admin accounts manage configuration but cannot work tickets; reception can manage stays/QR.
- Demo seed passwords are for local use only; change them via Admin → Accounts.

## Mapping of required checks to tests

| Check | Where |
|---|---|
| Public menus without login; private data needs the right stay | `activation.test.ts` (public content, requires activation), `requests.test.ts` (another stay's ref → 404), e2e #1 |
| Reception QR activates multiple devices; public QR cannot authenticate | `activation.test.ts`, e2e #1–#2 |
| Room move revokes sessions/QR; checkout blocks submission & callback from an old page | `lifecycle.test.ts` (room move, checkout), `resilience.test.ts` (SSE closed), e2e #6 |
| Reused room exposes nothing from the previous stay | `lifecycle.test.ts` › room reuse |
| Food/Services reach only their account/property | `requests.test.ts` › routing and scoping |
| Concurrent claims → one owner; reconnect and takeover reject stale writes | `requests.test.ts` › claims, e2e #2 |
| Double submission / lost response → one request | `requests.test.ts` › idempotent submission, cart key reuse (`client.test.ts`) |
| Failed confirmation prevents delivery and persists the notice | `requests.test.ts` › confirmation not received |
| Callback reuses the ticket, one attempt under concurrent taps | `requests.test.ts` › callbacks, e2e #2 |
| Services need no call; housekeeping and completion separate | `requests.test.ts` › simple services, e2e #3 |
| Pool labels and in-person confirmation | `requests.test.ts` › pool delivery, e2e #4 |
| Restart / missed alerts keep tickets and recoverable notifications | `resilience.test.ts` › server restart, SSE tests |
| Both languages cover core flows and errors; offline never auto-submits | `i18n.test.ts` (parity, every used key, every server error code), e2e #5 and #7, `client.test.ts` (SW policy) |
| Unconfigured PMS/bills/push represented honestly with fallbacks | `resilience.test.ts` › integrations, `lifecycle.test.ts` › bill access |
