# Lal Bus Tracker · লাল বাস ট্র্যাকার

A mobile-first MERN Progressive Web App for University of Dhaka schedules and authenticated, foreground driver GPS sharing. Unofficial student project; no University endorsement is implied.

The supplied **17 routes and 205 timetable entries are unverified screenshot transcriptions**. Every imported item starts as `NEEDS_ADMIN_VERIFICATION`. Timetables are not live predictions, operating days are unknown, and route geometry is absent. The app creates no physical fleet from route names or screenshot numbers.

## Run locally

Requirements: Node.js 24 LTS, npm 11, Docker Engine/Desktop with Compose v2. From the existing checkout:

```bash
cp .env.example .env
docker compose up -d --wait
npm ci
npm run db:migrate
npm run db:seed
npm run db:seed # Safe to repeat: 17 source routes, 205 source schedules
npm run db:demo
npm run dev
```

Preserve an existing `.env` rather than overwriting it. The web server listens on **5173**, the API on **4000**. Vite proxies `/api` and `/socket.io`, so browser authentication uses one origin. MongoDB uses 27017, Redis 6379; database ports bind to laptop loopback. Mailpit captures verification mail on SMTP 1025 and shows its local inbox on port 8025. Mailpit never delivers academic mail externally.

Development sign-in offers explicit **student / approved driver / admin** personas only when both `NODE_ENV=development` and `ALLOW_DEMO_AUTH=true`. These are simulated identities, not proof of university enrollment. The demo driver has a clearly marked demo vehicle with no fabricated fleet number. Do not enable demo authentication on a shared/public server.

## Exercise the complete flow

1. Use separate browser profiles, or the [two-phone HTTPS guide](docs/DEPLOYMENT.md#test-on-two-smartphones-with-real-gps).
2. Sign in as development driver, choose its assigned demo vehicle and route/direction, and start a trip.
3. Sign in as development student on the other device, open the live map, and select the active demo trip.
4. On the driver device, enable foreground sharing and grant precise location permission. A marker appears only after the server accepts a measured point. Keep this screen visible. No reading means no live marker.
5. End the trip. Its active listing and position must clear, and subsequent GPS writes must be rejected.

Without GPS, explicitly acknowledge simulation with `SIMULATION_ACK=true npm run demo:trip`; see `scripts/demo-trip.ts` for options. Its synthetic readings are labeled simulated and cannot enter a non-demo trip. They never represent a physical bus.

## Verification and admin setup

Academic ownership uses a single-use, expiring email link; an allowed suffix alone grants no session. Configure `DU_EMAIL_DOMAINS` with **exact** approved domains. `student.du.ac.bd.evil.com` is rejected. Optional Google Identity verifies ID tokens server-side and checks an explicit hosted-domain allowlist. Production requires real TLS-capable SMTP and an approved sender; see [security](docs/SECURITY.md).

Bootstrap accounts from a trusted terminal:

```bash
npm run admin:create -- --email YOUR_ADMIN_EMAIL --name "Transport administrator"
npm run driver:invite -w @lal/api -- --email YOUR_DRIVER_EMAIL --name "Driver name"
```

These create accounts; users still prove email ownership. No public endpoint creates privileged roles. Admin manages buses, driver approval/assignments, route/schedule review, and live trips. Create physical vehicles from verified records; route names never prove inventory.

## Checks

```bash
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# With the built Docker web/API running on port 8080:
npm run test:deployment
```

Integration tests use actual MongoDB and Redis with isolated records. Test-run output is the source of truth for pass/fail. Browser emulation does not substitute for Android/iPhone hardware verification. No 10,000-user capacity claim is made; [load profiles](docs/LOAD_TEST.md) separate HTTP RPS, viewers, and Socket.IO connections.

## Documentation

- [Architecture and indexes](docs/ARCHITECTURE.md)
- [API, roles, and response conventions](docs/API.md)
- [Seed preservation and ambiguities](docs/DATA_IMPORT.md)
- [Security and retention](docs/SECURITY.md)
- [Docker, HTTPS, exact two-smartphone steps](docs/DEPLOYMENT.md)
- [Load testing and measurement](docs/LOAD_TEST.md)
- [Assumptions and prerequisites](docs/ASSUMPTIONS.md)

The PWA supports static-shell installation/offline rendering. Authenticated responses and live GPS are excluded from service-worker caches. Browser backgrounding, screen lock, or closing the PWA may suspend GPS; reliable background tracking requires a future native tracker.
