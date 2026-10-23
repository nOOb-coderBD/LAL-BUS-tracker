# Lal Bus Tracker — Master Implementation Prompt for Codex

You are a senior full-stack architect, MERN engineer, security engineer, UI/UX designer, QA lead, and DevOps engineer. Build a **real, runnable, production-minded, mobile-first MERN PWA** named **Lal Bus Tracker (লাল বাস ট্র্যাকার)**, tailored to students and transport operators of the University of Dhaka, Bangladesh.

## First instructions — do not skip

1. Inspect the existing repository before changing files. If blank, initialize a monorepo. Never wipe other work without a documented reason.
2. Implement working code, not UI mockups, placeholder services, fake API calls, or pseudocode. Follow phases below, run checks after each phase, and fix errors.
3. Use the accompanying file `lal_bus_tracker_routes_seed.json` as the **importable preliminary schedule/route seed**. It contains 17 unique entries and 205 timetable entries manually transcribed from 18 user screenshots (one duplicate). Treat all seed route names, stop names, and times as **unverified draft data**. Do not fabricate physical bus numbers, coordinates, operating days, or ETAs. Preserve original source metadata, mark every seed entry `NEEDS_ADMIN_VERIFICATION`, and make it easy for an admin to review and edit. Show a clear 'Schedule needs confirmation' badge to users until reviewed.
4. In the current environment, external secrets or OAuth credentials may be missing. Create `.env.example`, wire real services correctly, provide safe local dev/demo login flows gated by `NODE_ENV=development` and `ALLOW_DEMO_AUTH=true`, and document what must be configured for real verification. Do not silently bypass authentication in production.
5. No copyrighted photos or logos should be incorporated without authorization. Use original SVG/CSS illustrations inspired by Curzon Hall architecture and red double-decker DU buses; allow later substitution of appropriately licensed photography. Avoid implying official University of Dhaka endorsement unless authorized.
6. Build a full working vertical slice first (seed -> search -> login -> approved driver start -> GPS -> student live map -> end -> offline), then refine beautiful UI and scalability. Do not block running MVP on optional features.
7. Favor simple, maintainable, well-tested modular monolith over premature microservices. Use scalable interfaces so Redis, CDN, multiple nodes and background workers can be added without major rewrites.

## Product and roles

The app must include STUDENT, DRIVER, and ADMIN permissions, enforced **on the server** and in socket event handlers (not merely hidden frontend buttons).

**Student flow:** Landing -> Sign In -> verify their DU academic email -> Student Dashboard -> Explore buses -> filter by route/bus name/number -> open live map with active trip and latest driver location -> view route details, stops, current/last-updated status, schedule, any assigned physical bus number and category (single/double decker), and driver-shared position only while trip active. Student can browse up/down schedule by time with timezone Asia/Dhaka; must never confuse scheduled departure time with a live prediction. Optional favorites can be added after MVP.

**Driver flow:** Driver login (approved driver only; pre-created/admin invited) -> Driver Dashboard -> select an assigned approved physical bus (display name, route, bus registration/fleet number) -> select trip direction (UP/DOWN) and optional scheduled service -> confirm Start Trip -> actively grant precise location permission -> transmit location periodically from driver's phone -> display live state, GPS quality, elapsed duration, network and battery-conscious hints -> End Trip -> stop location watch and mark trip ended server-side. Prevent simultaneous active trips for same bus or driver. Allow the driver to reclaim their active trip after login/reload. Handle duplicate start/end idempotently. If sharing fails, show strong alert and mark bus stale/offline rather than pretending it is still live.

**Admin flow:** Admin dashboard -> review/approve/revoke driver accounts -> manage fleet buses (real bus number optional until confirmed; no fake defaults), route assignments, allowed drivers, up/down stops and route variants, schedule entries, staff-only services, review/unverify status, live trips, manually end abandoned trips with audit trail, disable problematic trackers. Protect admin bootstrapping with one-time CLI or env secret, never public self-signup.

## Tech stack

- Monorepo with npm workspaces or pnpm workspaces (choose one and document).
- Frontend: React + TypeScript + Vite, React Router, TanStack Query, Tailwind CSS, shadcn/ui, Motion/Framer Motion, Lucide icons, React Leaflet (or MapLibre with equivalent provider abstraction). PWA via vite-plugin-pwa, accessible Bangla-first + optional English translations.
- Backend: Node.js current supported LTS, Express + TypeScript, MongoDB/Mongoose, Socket.IO, Zod, pino logging, Helmet, secure CORS, centralized typed error handling. OpenAPI/Swagger specification.
- Redis: latest-location cache, pub/sub/fanout and optional rate limiting. In multi-instance deployments, use Socket.IO Redis adapter and document sticky sessions for polling transport (or websocket-only transport with tradeoffs). Redis is not a replacement for persistent trip metadata.
- Auth: DU email address verification, role-based access control, secure httpOnly/SameSite cookies for sessions with appropriate CSRF defense or documented equivalent. For Google Identity, verify ID tokens server-side (signature, issuer, audience, expiry, email_verified, applicable hosted domain). **Important:** `@*.du.ac.bd` cannot by itself prove university enrollment; support configurable `@du.ac.bd` and subdomain allowlist rules; if OAuth does not certify a DU Workspace account, send a time-limited single-use verification link/OTP to the exact academic address. No student account becomes verified merely because a client sends an email-like string. Avoid insecure password-only driver seed accounts.
- Maps: configurable provider URL + key. Show required attribution. For local development use a permitted map tile provider; do not abuse public OSMF tiles at 10k-user scale. Preserve map usability if tiles temporarily fail.
- Infra: Dockerfiles, docker-compose for app/database/Redis, reverse-proxy example, HTTPS configuration in deploy docs, health/live/readiness endpoints, GitHub Actions CI.

## GPS and real-time semantics

**Foreground PWA limitation:** Browser `navigator.geolocation.watchPosition()` is allowed only in secure contexts with explicit permission. On phone lock/background/browser closure, browsers/OS may suspend tracking. DO NOT claim reliable 24/7 background location in a PWA. In v1 document that the driver must keep app foreground and location permission enabled during tracking; use Page Visibility handling, clear safety warnings, wake lock if available with fallback, reconnect/re-sync after resume, and `offline/stale` status. Future native app or companion tracker can implement OS-level background permissions if needed.

Server location ingestion must be authenticated and tied to an ACTIVE trip belonging to the current driver and assigned bus. Accept measured lat/lng, timestamp, accuracy, heading, speed only when available. Validate geographic bounds, clock skew, plausible sample age, rate limits and duplicate event IDs. Treat suspicious jumps/poor accuracy cautiously; don't invent GPS precision. GeoJSON points store `[longitude, latitude]` in Mongo, create 2dsphere indexes where needed. A bus is LIVE only with a recent server-accepted reading; STALE after a configurable threshold (~30 sec), OFFLINE after ~120 sec (configurable), ENDED on end trip. Always display last accepted timestamp and accuracy if available. Never animate stale buses as if moving. NEVER share inactive/private driver movement.

For efficiency, emit a throttled/filtered location report around every 5-10 seconds while foregrounded plus periodic heartbeat as needed. Frontend may smooth live map marker visually between real points, but visibly identify last measured observation and NEVER synthesize fake live coordinates. Server writes a latest-value cache in Redis and minimal persistent snapshots to MongoDB on a configurable interval; retain sensitive historical points only briefly (TTL, e.g. 24h) unless administratively justified. Location stream event names: `trip:started`, `trip:location`, `trip:stale`, `trip:ended`, `bus:status`, `subscribe:trip`, `unsubscribe:trip`. Authorize subscriptions for students/admins, use per-bus/per-trip rooms, send an initial authoritative snapshot after subscribe/reconnect, dedupe/out-of-order events, and handle network interruptions cleanly.

**Trip states:** PLANNED (optional), ACTIVE, STALE (computed), ENDED, INTERRUPTED (as applicable). A stale active trip must not be shown as 'ended'; distinguish GPS freshness from business trip state. End Trip should revoke active broadcast and clear/expire ephemeral location.

## Backend data model (implement Mongoose schemas + validation + indexes)

- `User`: name, email, emailVerifiedAt, role (STUDENT/DRIVER/ADMIN), status, oauthSubject nullable, createdAt, updatedAt; indexes on normalized email.
- `DriverProfile`: userId, driverIdentifier, approvedAt, approvedBy, allowedBusIds, activeTripId nullable; do not publish personal contact info.
- `Bus`: displayNameBn, displayNameEn nullable, fleetNumber nullable, registrationNumber nullable, busType (`SINGLE_DECKER`, `DOUBLE_DECKER`, `OTHER`, `UNKNOWN`), routeIds, assignedDriverIds, active/retired; unique partial indexes for known numbers where appropriate. **Same route name can have multiple physical buses; never conflate a route with a bus**.
- `Route`: slug, nameBn, subtitle, direction (`UP`, `DOWN`) specific stop descriptions, optional manually verified ordered stop IDs/route variants, GeoJSON LineString nullable, status, source screenshot reference, review timestamp, version.
- `Stop`: names, transliteration/search aliases, `Point` nullable until verified; route associations. Never invent coordinates from screenshots.
- `ScheduleEntry`: routeId, direction, local `HH:mm`, departurePlace text, optional `busId`, optional busType, destination or variant, daysOfWeek nullable (unknown != everyday), exception/staffOnly flag, notes, source, verified status. Preserve duplicate times (they may represent distinct vehicles). `Asia/Dhaka` throughout. Never treat timetable as real-time location.
- `Trip`: busId, routeId, driverId, direction, scheduleEntryId nullable, startedAt, endedAt nullable, status, latestPosition ref/point nullable, version, lastHeartbeatAt, audit information.
- `LocationSample`: tripId, busId, GeoJSON point, accuracy, speed, heading, observedAt, receivedAt, expireAt TTL, indexes appropriate to queries.
- `AuditLog`: actor, action, target, metadata scrubbed of secrets, timestamp.
- `EmailVerificationToken` or OTP records: store hashes, expiry and single-use enforcement.

Every schema must have migrations/seed strategy, not ad hoc database changes. Include index analysis and data retention config.

## HTTP API (implement + document in OpenAPI)

```
GET    /api/v1/health/live
GET    /api/v1/health/ready
POST   /api/v1/auth/google
POST   /api/v1/auth/email/start
POST   /api/v1/auth/email/verify
GET    /api/v1/auth/me
POST   /api/v1/auth/logout
GET    /api/v1/routes?search=&page=&limit=
GET    /api/v1/routes/:id
GET    /api/v1/routes/:id/schedule?direction=
GET    /api/v1/buses?routeId=&search=&status=
GET    /api/v1/buses/:id
GET    /api/v1/buses/:id/live
GET    /api/v1/trips/active
POST   /api/v1/driver/trips/start
POST   /api/v1/driver/trips/:id/locations
POST   /api/v1/driver/trips/:id/end
GET    /api/v1/driver/trips/active
GET    /api/v1/admin/drivers
PATCH  /api/v1/admin/drivers/:id/approval
CRUD   /api/v1/admin/buses
CRUD   /api/v1/admin/routes
CRUD   /api/v1/admin/schedules
POST   /api/v1/admin/trips/:id/end
```

Document response examples, authorization errors, request validation and pagination. Use centralized error codes. Public landing and non-sensitive schedule may be readable without login if product configuration allows; precise live bus GPS must require verified student/admin authorization. No unauthenticated driver location injection. Use secure session rotation and protection against CSRF/XSS/NoSQL injection. Rate-limit authentication and driver ingestion appropriately without throttling valid services.

## UI / UX: impress visually, but make it useful

Style name: **DU Heritage Crimson Glass**. Responsive mobile-first with premium editorial design, subtle architectural motifs inspired by Curzon Hall, iconic red double-decker bus illustration, deep crimson gradient, warm off-white backgrounds, airy space, glass surfaces with tasteful blur, softly glowing active-bus signals, animated route line, high-contrast accessible typography. Palette: primary `#A80F24`, vibrant `#DC263A`, off-white `#FFF9F7`, light rose `#F2D6CD`, charcoal `#24212A`; allow dark-mode variants. Use Bengali font (e.g. properly licensed Noto Sans Bengali) with clean fallbacks. Respect reduced-motion and WCAG contrast. Keep critical map controls opaque enough to read. No giant pointless animation, no perpetual expensive canvas loops.

Pages and components:

1. **Landing**: full-width Curzon-inspired backdrop/artwork with red double-decker illustration and short tagline; polished animated reveal; navbar; CTAs "Track a Bus" and "Driver Login"; live count of *real* active trips; separate scheduled route overview; FAQ/How it works; 'unofficial student project' disclaimer until authorized.
2. **Auth**: student DU mail flow and separate driver entry, graceful credential errors, session persistence, email verification status. Dev-only DEMO personas visibly labelled, never production.
3. **Student dashboard**: header/greeting, search and filtered route cards, Active / Stale / Offline chips, Up/Down tabs, departure timeline, favorite routes optional, upcoming departures calculated only when operating days confirmed, no invented live ETA.
4. **Route detail**: name in Bangla, verified/unverified notice, textual stops in proper order, schedule sections, physical bus list if known. A missing map route geometry should not fabricate a polyline.
5. **Live map**: Leaflet map centered on DU by default, custom red bus pin, route chips, last GPS timestamp, observed accuracy, vehicle type/number, map recenter, compact bottom info sheet, gracefully show 'No active bus' or 'GPS temporarily unavailable'. Use `MapView` abstraction to swap provider.
6. **Driver dashboard**: giant safe thumb-friendly Start Trip/End Trip buttons, approved bus picker, GPS permission card, trip timer, last report, connection indicator, impossible to start without approved assignment. Include explicit safety message 'Do not operate the phone while driving; ask an assistant to set up the tracking.'
7. **Admin console**: mobile usable but desktop-optimized tables and forms; add/edit/verifications, driver approval, live tracker dashboard, audit trail and CSV/JSON import/export.
8. **Error/Offline page**, loading skeletons, empty states, toasts, accessible dialogs, consistent iconography.

Add bilingual labels (Bangla primary and English optional). Mobile screens 320–430 px should have no horizontal overflow. PWA install prompts should be non-intrusive. Do not cache private auth tokens or live GPS in service-worker caches. Cache static shells and non-sensitive schedule with sensible refresh rules.

## Scalability and performance requirements

Design to **test toward at least 10,000 simultaneous viewers** and separately measure 10,000 requests per second; distinguish concurrent users, concurrent socket connections, and RPS. Do not promise an unmeasured guarantee. Build a modular monolith with stateless HTTP/API server replicas, Redis fanout and presence, MongoDB indexes, reverse proxy/load balancer, CDN for static assets, room-based Socket.IO subscription, compact delta payloads, compress when worthwhile, HTTP caching for public schedules, per-route/bus subscriptions rather than broadcasting all GPS to everyone, correct pool sizes, queue/backpressure handling, bounded logs, connection retry with jitter, metrics and backpressure alerts. Document worker/replica scaling and Mongo/Redis connection limits. If Socket.IO long-polling is enabled, document/configure sticky sessions; WebSocket-only is an optional deployment choice with reconnection tradeoffs.

Add `tests/load/` with k6 HTTP profile (smoke, 1k, ramp to 10k VUs only when target infra allows, request-rate targets separately) and Artillery or comparable Socket.IO connection/broadcast profile. Parameterize base URL, credentials, VUs, rate and duration via env vars. NEVER launch 10k-user tests automatically against an arbitrary/public deployment. Include measurable p50/p95/p99 latency, connection success, dropped socket messages, error rate, Node CPU/RAM, Redis/Mongo pressure, and final pass/fail result. Provide thresholds as adjustable objectives, not guaranteed outcomes.

## Repository layout (suggested)

```
lal-bus-tracker/
├── apps/
│   ├── web/
│   │   ├── src/{app,components,features,pages,hooks,lib,styles,i18n}/
│   │   └── public/{icons,illustrations}/
│   └── api/
│       └── src/{config,db,modules,middleware,realtime,utils,docs}/
├── packages/
│   ├── shared/               # Zod contracts, enums, common types
│   └── ui/                   # Only if useful; avoid needless abstractions
├── data/
│   ├── lal_bus_tracker_routes_seed.json
│   └── import-report.json
├── tests/{unit,integration,e2e,load}/
├── infra/{docker,nginx}/
├── docs/{ARCHITECTURE,API,DATA_IMPORT,SECURITY,DEPLOYMENT,LOAD_TEST,ASSUMPTIONS}.md
├── docker-compose.yml
├── .env.example
├── package.json
└── README.md
```

Route modules: `auth`, `users`, `drivers`, `buses`, `routes`, `schedules`, `trips`, `locations`, `admin`. Shared server schema validation and client typing from one source. Prefer clear dependency separation and service/repository layers only where useful.

## Seed-data processing rules

Input `data/lal_bus_tracker_routes_seed.json` is based on screenshots of the DU transport schedule. Import all **17 unique named entries** and all **205 source timetable entries**, no deduplication of identical departure times, with idempotent upsert keys (source route slug + direction + original per-route sequence index) so repeated imports do not duplicate records. It lists one screenshot per unique route (the repeated বৈশাখী screenshot is not a separate route). Preserve original Bengali names and display text. Some entries have bus TYPE (single/double decker), and only a minority show actual bus NUMBER (e.g. 4168); don't mistake type for bus number, or route name for physical bus identity. Unknown numbers, locations and operating days remain `null` and require admin verification. Preserve staff-only tags for associated journeys. Do not geocode freeform stop lists into fake 'exact' stops automatically; optionally offer admin suggestions clearly labelled unverified. Dates like `06-Oct-2024` and relative update labels only describe the old screenshot, not current correctness. Include a report of import counts and ambiguities.

## Implementation phases (execute, test, report results)

**Phase 1:** scaffold monorepo, TS config, ESLint/Prettier, styles, Docker Compose MongoDB + Redis, env validation, shared schemas. Check builds.

**Phase 2:** implement all key Mongo schemas/indexes + idempotent 17-route/205-schedule importer + simple admin verification statuses + working route list/detail API + responsive pages. Run unit and smoke tests.

**Phase 3:** real DU email verification (configurable verified-domain/workspace strategies); secure session, roles and driver/admin onboarding. Provide development-only mock auth to test before credentials are available. Test unauthorized access.

**Phase 4:** bus inventory and assignment, driver Start/End Trip APIs, robust GPS capture/error handling, live location ingest, Redis cache, Socket.IO subscriptions and student live map. Test with two browsers on different devices and simulator.

**Phase 5:** full premium Bengali UI polish, accessibility, responsive PWA shell, offline state, reliable retry/resubscribe, map status, admin CRUD/approval UI. Test Android Chrome and iPhone Safari foreground tracking.

**Phase 6:** security audit, automated unit/integration/E2E test suite, CI, API docs, Docker/nginx/deployment docs, load-testing scripts, metrics and performance report. Do not assert 10k capacity without measured evidence.

## Mandatory automated tests

1. Reject non-DU / unverified student email. Verify allowed subdomain variations and reject lookalike domains such as `student.du.ac.bd.evil.com`.
2. Prevent student location writes, unapproved driver start, unassigned bus starts, bus with two active trips, other-driver end-trip.
3. Start -> GPS updates -> student sees exact coordinates -> End -> bus disappears from active/live state (with appropriate ended notice).
4. Simulated disconnection -> stale -> offline; reconnect returns latest server snapshot and prevents time regression from out-of-order points.
5. Idempotent seed import yields exactly 17 unique entries and 205 source schedule entries each time; duplicated departure time remains distinct.
6. Timezone Asia/Dhaka and 12h/24h conversion; no schedule projected without known service days.
7. Bus number null and absence of route GPS coords render correctly, not as fake vehicles/routes.
8. Unprivileged routes/actions denied server side; rate limits, token expiry and session logout work.
9. Map tiles fail -> show error/placeholder without crashing or suppressing route list.
10. Visual/responsive mobile checks, accessible button sizes, reduced-motion settings and Bengali display.

## Demo simulator and cross-device testing

Implement a development-only `npm run demo:trip` CLI or protected dev tool that sends points along an explicitly labelled synthetic path near campus and respects trip auth. Synthetic points must never enter production datasets or be presented as real buses. Include a README recipe for testing: laptop hosts API and React frontend, smartphone A logs in as driver with approved demo bus and shares location; smartphone B logs in as a separate verified development student and watches position update; end trip; test timeout/offline; test mobile browser lock limitation. For REAL GPS, use an HTTPS deployment or development HTTPS tunnel/hostname on both phones; plain `http://LAN-IP` is typically not eligible for browser geolocation. Provide exact documented commands, env examples, troubleshooting for Android/iOS location permissions, and a production checklist. Ensure `.env` is gitignored.

## Completion criteria

Finish with a reproducible local setup using `cp .env.example .env`, `docker compose up -d`, `npm install`, migration/seed commands, and `npm run dev` (or equivalent clearly documented commands). The following must work with real local services: verify/access a student demo session, login approved demo driver, choose bus, start, share or simulate GPS, view map on a second device, view full schedule data, end, and see live status cease. Build, tests and lint must pass. Provide output summaries: files changed, what works, commands run and results, security/availability caveats, missing external credentials, remaining TODOs. Do not claim tests passed unless actually executed.

**Now implement the project. Start by inspecting the workspace and writing an executable phased task checklist, then create and test the actual files. Continue through the critical vertical slice with no fake backend.**
