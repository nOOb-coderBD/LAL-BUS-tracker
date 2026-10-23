# Validation evidence

Validated on 23 October 2026 (Asia/Dhaka), using this cloud checkout. This is a development MVP, not a production launch or hardware certification.

| Check | Observed result |
| --- | --- |
| npm dependency installation | Successful; lockfile retained |
| MongoDB migration + repeated source import | 17 routes, 205 schedules; duplicate times retained, admin edits preserved |
| `npm run lint` | Passed |
| `npm test` | 17 passed, 0 failed, 0 skipped; actual MongoDB + Redis + SMTP Mailpit |
| `npm run build` | Shared contracts, API TypeScript and Vite/PWA build passed |
| `npm run test:e2e` | 8 passed across desktop Chromium and mobile Chromium emulation |
| Docker API and web image builds | Passed; API readiness confirms MongoDB + Redis |
| nginx configuration / static headers | Passed; CSP, no-sniff, referrer policy and geolocation policy verified |
| `npm run test:deployment` / built PWA offline shell | Browser reload while offline succeeded; 13 cached static assets, 0 API/socket cache entries, 0 page exceptions |
| HTTPS reverse proxy | Caddy readiness request passed using explicit local certificate trust (`curl --cacert`); verification was not disabled |
| HTTP load smoke | 1 VU, 5 seconds, 5 requests, 0 errors; p50 42.64 ms / p95 63.81 ms / p99 66.51 ms |
| Cross-instance Socket.IO smoke | Host API accepted 3 synthetic development reports; 5 viewers on Docker API/nginx received all 15 expected deliveries through Redis, 0 missing messages, 0 version regressions; delivery p50 14 ms / p95 22 ms / p99 22 ms |
| Production dependency audit | `npm audit --omit=dev`: 0 known vulnerabilities at validation time |

Integration coverage includes single-use/expired email proof, exact DU domain rules and lookalikes, origin/CSRF, unapproved/unauthorized accounts, assignment checks, competing drivers, repeated starts/ends, accepted GPS -> student socket, out-of-order rejection, stale/offline status, reconnection snapshot, ending/private location cleanup, session expiry/logout, malformed Socket.IO arguments, and admin database CRUD/reference checks.

Browser coverage includes Bangla route search, preserved duplicated departures, direction switching, 320/375/430px overflow checks, reduced-motion preference, login errors, admin controls, denied map tiles, and two isolated sessions with browser-emulated geolocation. Synthetic fixtures are not physical GPS evidence. A driver's page is kept foregrounded to represent the documented operating requirement.

Small smoke reports are retained in [validation/http-smoke.json](validation/http-smoke.json) and [validation/sockets-smoke.json](validation/sockets-smoke.json). They measure this local run only. Server CPU/RAM and Mongo/Redis pressure at 1k/10k scale remain unmeasured; generator metrics in the socket report are not server metrics. No 10,000-viewer, socket or RPS capacity is claimed.

## Remaining external checks

- Actual Android Chrome and iPhone Safari tracking, precise-location permission, battery and screen-lock behavior: follow [DEPLOYMENT.md](DEPLOYMENT.md#test-on-two-smartphones-with-real-gps).
- External academic mailbox delivery and Google identity: production credentials/configuration were not available. SMTP through the real Mailpit server was exercised; it simulates mailbox ownership.
- Default development map tiles: cloud egress proxy returned HTTP 403 for `tile.openstreetmap.org`. The tile-error fallback works; the requested network addition needs environment-settings review. This does not establish map-provider availability or a production traffic contract.
- Source schedules, stop spelling, fleet identity and service days require transport-office review. Imported data remains unverified; no ETA or surveyed geometry was manufactured.
- Production deployment, independent security assessment, backups/restore and authorized large load tests remain operator work.

Cloud Docker builds required the existing HTTPS proxy, an explicit proxy host mapping derived from runtime DNS, and the platform CA supplied as an ephemeral BuildKit `npm_ca` secret. TLS/checksum verification stayed enabled; no proxy credential or CA private key was added to the repository. Ordinary Docker builds need no platform-specific host mapping. Readable static-file permissions and internal Caddy proxy bypass were verified in the resulting images.
