# Le Palace d'Anfa — Guest PWA & Staff Companion

Pilot application for **Le Palace d'Anfa, Casablanca** (156 rooms): a bilingual (FR/EN) guest
Progressive Web App for the hotel guide, **Food** (Room Service) and **Services** (Reception)
requests, plus the staff companion used on shared department tablets to receive, claim, confirm
and complete those requests.

One project: **React + Vite** (guest, staff and admin route groups), **Node.js + Express** API,
**SQLite** (single file, local to the backend), **TypeScript** throughout, shared types/state machine
in `shared/`.

> Everything seeded by the demo command is **demo content** — sample menus, prices, hours, events
> and fictitious rooms (`DEMO-101`…). The UI shows a demo banner while any demo fixture remains.

---

## Quick start (local demo)

Requirements: Node.js ≥ 20.11 (tested on 22), npm.

```bash
npm install
npm run db:reset-demo      # creates data/palace.sqlite with demo data; prints logins + private QR links
npm run dev                # API on :3000, PWA on http://localhost:5173 (proxies /api)
```

`db:reset-demo` prints:

| Account | Username | Password (demo) |
|---|---|---|
| Room Service (shared, tablets "Room Service Tablet 1/2") | `palace.roomservice` | `demo-roomservice` |
| Reception (shared, tablets "Reception Tablet 1/2") | `palace.reception` | `demo-reception` |
| Admin | `palace.admin` | `demo-admin-pass` |

…and one **private activation link** per demo stay, e.g.
`http://localhost:5173/activate?p=palace-anfa#t=…` (room `DEMO-101`). Links are shown once;
reception can issue new ones at any time (**Stays & QR → New QR**).

### Demo script (two staff sessions, several guest devices)

1. **Guest phone** – open the activation link, enter room `DEMO-101`. Browse *Restauration*, add
   items, choose *Ma chambre* or a pool lounger, send.
2. **Second guest device** – open the *same* link in another browser/profile (another occupant).
   Both devices share *Mes demandes*.
3. **Room Service Tablet 1 and Tablet 2** – open `http://localhost:5173/staff` in two other
   browser profiles, sign in with `palace.roomservice`, pick a different tablet on each.
   Both are alerted live; tap **Prendre cette demande** on one — the other shows who owns it.
4. Select **Confirmation non reçue** → the guest devices show the explanation and
   **Demander un nouvel appel de confirmation**; tapping it reopens the *same* ticket as call attempt 2.
5. Take it again, **Confirmée par téléphone**, enter it manually in the POS and tick
   **Saisie en caisse** (+ optional reference), **Lancer la préparation**, **Marquer livrée**.
6. **Reception** (`/staff` as `palace.reception`) receives *Services* (towels…), records
   **Gouvernante contactée** and **Terminée**. Under **Séjours et QR** it can create stays,
   print/rotate QR codes, move rooms (signs devices out and issues a new QR) and check out.
7. **Admin** (`/admin` as `palace.admin`) edits menus, services, hotel information, rooms, pool
   tables/loungers, tablets and passwords, and sees integration status.

The public hotel link `/p/palace-anfa` only selects the hotel; it can never activate a stay.

## Build, run, test

```bash
npm run typecheck          # tsc over shared/, server/, client/, tests
npm test                   # 72 unit + API integration tests (vitest, in-memory SQLite)
npm run test:e2e           # 7 Playwright end-to-end scenarios on the built app (fresh demo DB)
npm run build              # client → dist/client, server → dist/server
npm start                  # serves API + built PWA on $PORT (default 3000)
```

`test:e2e` needs a Chromium: it uses `/opt/pw-browsers/chromium` or `$CHROMIUM_PATH` when present,
otherwise run `npx playwright install chromium` once.

Other commands: `npm run db:migrate`, `npm run db:setup` (base configuration only, no demo data —
see docs/operations.md), `npm run db:seed-demo` (into an empty DB),
`npm run db:backup [dir]`, `npm run push:generate-keys`.

Production notes (HTTPS, reverse proxy, environment, backup/restore, staff terminals):
**[docs/operations.md](docs/operations.md)**. Design and data model:
**[docs/architecture.md](docs/architecture.md)**. Configuration reference: [`.env.example`](.env.example).

## What is implemented

**Guest PWA** (`/`, `/p/:property`, `/activate`, `/h/*`)
- Welcome: FR/EN choice, hotel list, optional **Find my hotel** (geolocation stays on the device;
  Casablanca → Palace / Hôtel Suisse, Marrakech → Palm Plaza / Palm Appart Club). Inactive
  properties show information only and cannot receive requests.
- Hotel guide: information, opening hours, events, contacts; public without login.
- Private QR activation (token in URL fragment, removed from the address bar at startup, exchanged
  for an httpOnly session; room-number check).
- Food: categories, options (required/optional groups), quantities, availability, cart kept on the
  device, room or labelled pool destination, notes, total, "confirmation required" notice.
- Services: complimentary vs visible-fee items, quantity limits, optional details; no call needed.
- My requests: shared across the stay's devices, live progress, ticket reference, destination,
  call attempts, agreed amendments; failed-confirmation screen with same-ticket callback.
- My stay: room, notifications opt-in (only if push is configured), bill area (honest
  "contact reception" fallback), sign out of this device. Post-stay: ordering disabled.
- Installable (manifest + icons), service worker caches the shell and **public** info only.
  Requests need connectivity; the cart is kept but **never auto-submitted**.

**Staff companion** (`/staff`) – shared department login + named tablet; live queue sections
(*À vérifier / Nouvelles / En cours / En attente du client*), atomic **Take**, explicit **Take over**
with reason, call / in-person confirmation, *Confirmation non reçue*, amendments, manual POS entry
(entered / uncertain + reference), housekeeping hand-off, completion, reject/cancel (POS decision
required once entered), room-move/checkout warnings with resolution, full history, sound + title
alerts while open.

**Admin / reception** (`/admin`) – stays & QR (create, departure, move, checkout, rotate for
reprint or occupant change, overdue departures, PMS source/freshness), food menu and options,
services, hotel content, rooms and pool locations, accounts/tablets/passwords, integration status.

## External dependencies still needed

These are genuine inputs from outside this codebase — not open design questions:

1. **Pluriel Cloud API documentation and credentials** – to implement `server/src/pms/pluriel.ts`
   behind the existing adapter boundary. Until then, reception keeps stays current by hand.
2. **Real hotel content** – the actual room list/labels (156 rooms), pool table/lounger numbering,
   menus, prices, hours, contacts and events, to replace the demo fixtures.
3. **Web push credentials (optional)** – VAPID keys and a contact address, if outside-app
   notifications are wanted. In-app notices work without them.
4. **Provider-approved deployment on the staff terminals** – confirmation from the POS provider that
   a browser tab/kiosk window on the locked Windows terminals is permitted, and a test there
   (audio, screen lock, background tabs). Nothing here bypasses terminal restrictions.
5. **Bill/folio source (later)** – only if guest bill viewing is wanted; see "Bills" in
   docs/architecture.md.
