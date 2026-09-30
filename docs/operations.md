# Operations

## Configuration

All settings are environment variables; see [`.env.example`](../.env.example). Setup data
(properties, department accounts, tablets, catalogue) lives in the same SQLite file as live guest
data but in separate tables, and the demo fixtures are flagged `is_demo`.

For a pilot with real data, start from an empty database with **base configuration only**
(properties, Room Service / Reception / Admin accounts, four named tablets — no demo rows):

```bash
npm run build
SEED_ROOM_SERVICE_PASSWORD='…' SEED_RECEPTION_PASSWORD='…' SEED_ADMIN_PASSWORD='…' \
DATABASE_PATH=/srv/palace/palace.sqlite node dist/server/cli.mjs setup
```

Then enter the real rooms, pool tables/loungers, menus, services and hotel information in
**Admin**. `db:reset-demo` refuses to run with `NODE_ENV=production` unless `ALLOW_RESET=true`.

## Running in production

```bash
npm ci && npm run build
NODE_ENV=production PORT=3000 DATABASE_PATH=/srv/palace/palace.sqlite \
PUBLIC_BASE_URL=https://guest.<hotel-domain> TRUST_PROXY=true node dist/server/index.mjs
```

- Serve over **HTTPS** only (cookies are `Secure` in production; service workers and push require
  HTTPS). Terminate TLS in a reverse proxy (nginx, Caddy, IIS ARR) and set `TRUST_PROXY=true`.
- The proxy must not buffer `text/event-stream` responses for `/api/*/stream` (the server sends
  `X-Accel-Buffering: no`; for nginx also set `proxy_read_timeout` ≥ 60s).
- Run a **single** Node process (SQLite + in-memory rate limits + SSE hub are per process).
  Use a process manager (systemd, NSSM on Windows, pm2) with restart on failure.
- Keep the database on persistent local disk, never on a network share. Tablets talk only to the API.
- Logs are JSON lines without bodies, cookies, tokens or guest names.

## Backup and restore

Backups use SQLite's online backup API, so they are consistent while the server is running:

```bash
DATABASE_PATH=/srv/palace/palace.sqlite npm run db:backup -- /srv/palace/backups
# or with the built CLI:
DATABASE_PATH=/srv/palace/palace.sqlite node dist/server/cli.mjs backup /srv/palace/backups
```

Schedule it (e.g. hourly + nightly off-site copy) and prune old files. Backups contain guest
names and request history: store them encrypted with restricted access.

Also back up **`activation-code.secret`** (created next to the database on first start, mode 0600),
or set `ACTIVATION_CODE_SECRET` in the environment. It keys the hashes of typed validation codes and
is deliberately kept outside the database. Without it, restored typed codes no longer validate
(QR links still do); reception can simply issue new ones.

Restore:

1. Stop the server.
2. Move the current `palace.sqlite`, `palace.sqlite-wal` and `palace.sqlite-shm` aside.
3. Copy the chosen backup to `palace.sqlite`.
4. Optionally check it: `sqlite3 palace.sqlite "PRAGMA integrity_check;"` → `ok`.
5. Start the server (pending migrations apply automatically), then have reception verify
   in-house stays and room assignments, since events after the backup are lost.
   Guests whose sessions were created after the backup must re-scan their QR.

## Web push (optional)

```bash
npm run push:generate-keys   # prints VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY
```

Set both keys and `VAPID_SUBJECT` (a mailto: or https: contact) and restart. Guests can then opt in
from *Mon séjour*. Without keys the app states that notifications are unavailable and relies on
in-app notices.

## Validation codes and lockout

Each private credential has a QR link and a 12-character typed code. Wrong room answers given with
a valid credential are counted; after **10** the credential (QR and code) is revoked and the stay
shows "No active QR" at reception, which issues a new one. Failed attempts are also limited per IP
(`RATE_LIMIT_ACTIVATION_MAX` per `RATE_LIMIT_WINDOW_MS`); successful validations are not counted.

Printing from **Stays & QR** prints only a guest card (hotel name, QR, code, instructions in
FR/EN/ES) — never the room number or the in-house list.

## Staff terminals

The staff companion is a responsive web app (`/staff`, `/admin`). The Windows tablet-style
terminals are locked into the POS provider's software, so:

- Ask the provider whether a browser window/kiosk tab may run alongside the POS and whether
  audio is allowed; then test on the real terminal: sign-in persistence, sound after the first tap,
  behaviour when the POS is in the foreground, screen lock and reconnection after sleep.
- Alerts are only guaranteed while the staff page is open (banner, blinking tab title, chime).
  No system-wide pop-up is promised, and nothing here attempts to bypass terminal restrictions.
- If the terminals cannot be used, any other tablet or PC with a modern browser works the same way;
  each physical device should be registered as a named tablet in Admin → Accounts & devices.
