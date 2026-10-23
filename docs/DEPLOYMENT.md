# Development, HTTPS, and deployment

## Local setup

Use Node 24/npm 11 and Docker Compose v2. Reuse this checkout; no extra worktree is needed.

```bash
cp .env.example .env
docker compose up -d --wait
npm ci
npm run db:migrate
npm run db:seed
npm run db:demo
npm run dev
```

Keep `.env` private and gitignored. Preserve existing configuration rather than overwriting it. Development SMTP is captured by Mailpit (inbox port 8025), not delivered to DU. Without SMTP, the development mail-file fallback is a local inbox, not academic verification in production.

## Test on two smartphones with real GPS

Use a laptop and two phones on the same trusted Wi-Fi. Phone A is driver; Phone B is student. This tests the actual foreground Geolocation API over trusted HTTPS. Development identities remain simulated. Do not operate the phone while driving; an assistant should set up tracking while stationary.

### 1. Find the actual laptop LAN address

macOS: `ipconfig getifaddr en0` (use the active interface if different). Linux: inspect `ip -4 addr`. Windows: inspect `ipconfig`. Use the actual Wi-Fi IPv4 address reported, not a guessed address:

```bash
PHONE_IP=YOUR_ACTUAL_LAPTOP_LAN_IPV4
```

Reserve it in your router if needed; a DHCP change invalidates the certificate. Guest-network client isolation may prevent phone-to-laptop access.

### 2. Create and trust a local certificate

Install [mkcert](https://github.com/FiloSottile/mkcert#installation) from official instructions. macOS: `brew install mkcert`. From repository root:

```bash
mkdir -p infra/certs
mkcert -install
mkcert -cert-file infra/certs/phone.pem -key-file infra/certs/phone-key.pem "$PHONE_IP" localhost 127.0.0.1
mkcert -CAROOT
```

Transfer **only `rootCA.pem`** from the final directory to each phone by a trusted method such as AirDrop/USB. Never transfer `rootCA-key.pem` or `phone-key.pem`. Remove the private development CA afterward on borrowed devices.

- **Android:** Settings → Security/Privacy → More security settings → Encryption & credentials → Install a certificate → CA certificate. Select `rootCA.pem`. Vendor menus vary. Chrome must trust the CA; a warning page is not successful HTTPS validation.
- **iPhone:** Open the transferred file; install its profile under Settings → General → VPN & Device Management. Enable full trust under Settings → General → About → Certificate Trust Settings. Safari must show no certificate warning.

### 3. Use one exact HTTPS origin

Edit `.env` with the actual address:

```dotenv
NODE_ENV=development
ALLOW_DEMO_AUTH=true
APP_ORIGIN=https://YOUR_ACTUAL_LAPTOP_LAN_IPV4:8443
ALLOWED_ORIGINS=https://YOUR_ACTUAL_LAPTOP_LAN_IPV4:8443,http://localhost:5173,http://127.0.0.1:5173
COOKIE_SECURE=true
TRUST_PROXY=true
```

Restart `npm run dev`. In another terminal:

```bash
docker compose --profile phone up -d phone
```

The supplied Caddy proxy presents the certificate on 8443 and proxies host Vite on 5173. Docker Desktop supports `host.docker.internal`; Linux Compose supplies host-gateway mapping. Allow incoming laptop TCP 8443 on your trusted LAN firewall. Keep database ports on loopback.

On **both phones**, open `https://<actual-laptop-LAN-IP>:8443` with the same host/port. Plain `http://LAN-IP:5173` is normally ineligible for GPS. Never click through a TLS warning and call validation complete.

### 4. Start → GPS → student map → end

1. **Phone A:** Sign in as the explicitly labeled development Driver. Open Driver dashboard. Select the assigned demo bus, route and UP/DOWN direction. Confirm Start Trip.
2. **Phone B:** Sign in as the explicitly labeled development Student. Open live tracking and select Phone A's trip. Before a point arrives, GPS is unavailable; no invented marker should appear.
3. **Phone A:** Enable location sharing. Grant precise location / while-using permission. Stand somewhere with usable GPS, keep the app visible and screen unlocked. Check the latest server-accepted timestamp/accuracy.
4. **Phone B:** Confirm its map uses the driver's measured position and same accepted reading. Check accuracy. Scheduled departures stay separate; there is no invented ETA.
5. **Phone A:** Walk a short, safe distance while foregrounded. Reports are throttled to around 5–10 seconds. **Phone B** should receive accepted Socket.IO updates. GPS noise alone is not reliable movement evidence.
6. Reload Phone A: the existing trip should be recoverable; resume GPS sharing if required. Reload Phone B to verify snapshot recovery.
7. Press **End Trip** on Phone A. Phone B must remove the active marker/listing or show ended state. Old GPS must not continue to look live.

### 5. Stale/offline and browser limits

With a trip active, disable Phone A's network or background its browser while Phone B stays online. From the **last server-accepted point**, wait beyond 30 seconds for STALE, then beyond 120 seconds total for OFFLINE. The business trip remains ACTIVE until ended. Resume app/network/GPS sharing: a new accepted point restores freshness. Disconnection must not fabricate newer readings.

Test screen lock separately. Android/iOS may suspend foreground PWA GPS in background: this is a browser limitation, not background tracking support. Wake Lock is best effort and cannot override OS policies.

Troubleshooting:

- Android: enable device Location and Chrome site Location permission; choose precise accuracy where offered.
- iOS: Settings → Privacy & Security → Location Services must be on; allow Safari Websites while using and Precise Location. Review per-site permission in Safari.
- No socket updates: verify exact origin, session validity, Redis readiness, and WebSocket upgrade forwarding. Refresh after login/logout.
- No GPS: check TLS trust, permission, foreground visibility, and displayed geolocation errors. Do not substitute fabricated positions.
- Tile failure: route list and GPS status should remain usable; configure an authorized provider rather than removing verification.

Afterward: `docker compose --profile phone stop phone`; end active demo trips and disable demo auth before real use.

## Development simulator

`SIMULATION_ACK=true npm run demo:trip` uses protected development driver APIs and explicitly synthetic samples. It targets demo records only; it never validates physical GPS. Read `scripts/demo-trip.ts` for options. Keep the student view open to inspect events and end-state cleanup. Never use it against production.

## Docker application build

Default Compose starts data/mail services. Build the complete app:

```bash
docker compose --profile app build
docker compose --profile app up -d
docker compose --profile app exec api node apps/api/dist/cli.js seed
```

API migrates indexes before listening. nginx serves built assets and proxies `/api` and websocket-only `/socket.io`. Web binds loopback 8080. Containers default to `NODE_ENV=production`, `ALLOW_DEMO_AUTH=false`, regardless of host development defaults. Secure session cookies require TLS before authentication testing. For an isolated Docker demo, explicitly use `APP_NODE_ENV=development`, `APP_ALLOW_DEMO_AUTH=true`, and the exact allowed origin; never expose this publicly.

## Production prerequisites

Compose is a development/reference stack. Before real use:

1. Supply your own domain, public DNS, trusted TLS and exact origin policy. `infra/caddy/Caddyfile.production` uses `DOMAIN`; run Caddy on the Docker host forwarding to loopback web8080. Permit 80/443 for certificate issuance/renewal. Never publish Vite.
2. Set `NODE_ENV=production`, `ALLOW_DEMO_AUTH=false`, `APP_NODE_ENV=production`, `APP_ALLOW_DEMO_AUTH=false`, `APP_ORIGIN=https://your-domain`, `ALLOWED_ORIGINS=https://your-domain`, and `COOKIE_SECURE=true`. The documented Caddy → nginx → Express chain has two trusted proxy hops: set `APP_TRUST_PROXY_HOPS=2` for that topology. Compose defaults to `APP_TRUST_PROXY_HOPS=1` for nginx → API without Caddy. A directly configured API uses `TRUST_PROXY`; set its exact provider proxy count (for example, `1` behind one managed reverse proxy or `2` behind Caddy and nginx). `TRUST_PROXY=false`/`0` trusts no forwarded client address; legacy `true` remains equivalent to `1`. Accepted hop counts are 0–5. Keep the API private and choose the exact fixed chain: over-trusting a shorter/direct path permits forged client IPs, while under-trusting both proxies merges visitors into one authentication rate-limit bucket.
3. Replace Mailpit using `APP_SMTP_HOST`, `APP_SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` with TLS-capable SMTP and an approved sender. Institution approval determines valid DU domains. A development inbox never proves real academic ownership.
4. Provision private authenticated MongoDB/Redis and backups. Override API URIs for managed services; never expose unauthenticated local containers. Restrict reachability and test restoration.
5. Bootstrap admin by CLI, invite/approve real drivers, create verified buses/assignments, review screenshot schedules/stops, and remove demo records.
6. Contract an appropriate map provider. Build with `VITE_MAP_TILE_URL` and correct attribution. Public OSM tiles are only a modest development default; never send a 10k-user load test to them.
7. Add monitoring, privacy/retention review, measured abuse controls, and [authorized load tests](LOAD_TEST.md). Complete physical Android Chrome/iPhone Safari tests before making reliability claims.

Deploy server secrets at runtime; never put them in source, Docker build arguments, logs, or load reports. Client `VITE_*` values are public build-time configuration.

## Enterprise proxy / trusted CA image builds

The Dockerfiles support an optional BuildKit secret named `npm_ca`. On managed networks, pass the organization's trusted PEM bundle via `--secret id=npm_ca,src=/actual/trusted-ca-bundle.pem` and standard `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY` build arguments as needed. npm retains certificate verification; never use `strict-ssl=false` or an insecure TLS flag. The CA secret mount is scoped to dependency installation and is not copied into the runtime image. Supply these options through your approved BuildKit/Compose setup; do not embed proxy passwords in tracked configuration. Ordinary public-network builds need no custom CA secret.
