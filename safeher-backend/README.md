# SafeHer backend

Node.js backend for SafeHer emergency reporting, police dispatch, family contacts,
live location updates, audio evidence metadata, and realtime incident events.

## Setup

```powershell
cd safeher-backend
npm install
Copy-Item .env.example .env
```

Create a Supabase project, run [`supabase/schema.sql`](supabase/schema.sql) in
the Supabase SQL editor, and set `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY` in `.env`. Keep the service-role key server-side.
Also set a long random `JWT_SECRET`.

The schema creates the private `emergency-audio` storage bucket. Police audio
links are returned as one-hour signed URLs.

## Run

```powershell
npm run dev
# or
npm start
```

The backend uses Supabase's HTTPS API, so MongoDB network access and Atlas DNS
configuration are no longer required. For local UI-only work (not API/auth/
emergency functionality), set `ALLOW_START_WITHOUT_DB=true` in development.
Never enable that setting in production.

Create the initial administrator after Supabase is configured:

```powershell
npm run seed
```

The seed command uses `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`.

## API surfaces

- `POST /api/auth/register`, `POST /api/auth/login`
- `POST /api/emergencies` creates a `LEVEL_1`/`LEVEL_2`/`LEVEL_3` incident
- `GET /api/emergencies/history` and `POST /api/emergencies/:id/cancel`
- `POST /api/emergencies/:id/escalate`
- `POST /api/emergencies/:id/location` stores a location history point
- `POST /api/emergencies/:id/audio` stores an audio storage reference
- `GET /api/police/incidents` and atomic `POST /api/police/incidents/:id/claim`
- Police transitions: `respond`, `on-scene`, and `resolve`
- `GET/POST/DELETE /api/contacts`
- Guarded integrations: `POST /make-call` and `POST /send-sms`

Protected endpoints use `Authorization: Bearer <JWT>`. Socket.IO clients connect
with `{ auth: { token } }` and may join `emergency:<id>` rooms. Emergency and
dispatch changes are persisted as `EmergencyEvent` records and broadcast to
subscribed clients.

## Validation

```powershell
npm test
```

The Jest smoke tests cover health and integration-route validation.
