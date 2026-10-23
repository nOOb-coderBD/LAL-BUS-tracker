# Security and privacy

## Identity and sessions

Student authentication proves control of the exact academic mailbox with a cryptographically random, single-use link. Only token hashes are stored; links expire after 15 minutes and are atomically consumed. New attempts invalidate older unused links. An exact `DU_EMAIL_DOMAINS` allowlist accepts institution-approved DU domains; suffix lookalikes are rejected. Mailbox ownership alone does not prove current enrollment.

Drivers/admins are CLI-invited, then prove mailbox ownership. Drivers require admin approval and assignment independently of identity proof. Public verification never accepts client-selected roles. Optional Google sign-in verifies token signature, issuer, audience and expiry through the official server library, requires verified academic email, checks hosted domain against the configured workspace allowlist, and refuses mismatched OAuth subjects. Otherwise use mailbox proof.

Opaque random session credentials use `HttpOnly`, `SameSite=Lax` cookies and `Secure` in production. Redis keys contain a SHA-256 session digest; login rotates credentials and logout revokes state/disconnects matching sockets. Mutating requests require an exact allowed Origin, plus session-bound `X-CSRF-Token` outside explicit authentication endpoints. Login endpoints also enforce Origin to prevent login CSRF. Auth/private GPS responses are `no-store`.

## Development isolation

Demo login and simulated GPS require **both** `NODE_ENV=development` and `ALLOW_DEMO_AUTH=true`. Production refuses that combination. Demo users/vehicles are visibly labeled and excluded when demo mode is disabled; simulated coordinates are accepted only for a demo driver on a demo trip. Never present simulator output as a real bus observation.

Local email verification also requires demo mode. Its proof records and sessions are development-only and cannot be consumed in production; newly created students from local mailbox proof are demo identities. Mailpit or `.local/mail` captures mail without proving external mailbox delivery. Never reuse development databases/Redis for production. Configure real TLS-capable SMTP and verified sender in production; delivery failures do not become a bypass.

## Authorization and input controls

- HTTP and Socket.IO check current session, verified status and role server-side. Live room subscriptions are STUDENT/ADMIN only and limited per socket.
- Start/GPS requires approved driver, approved active assigned bus and allowed route. Partial unique ACTIVE-trip indexes prevent simultaneous bus/driver use. Other drivers cannot end/write a trip.
- GPS checks bounded numeric values, timestamps, event IDs, freshness, poor accuracy and implausible jumps. Duplicates cannot advance time; out-of-order readings cannot regress it. Ended trips reject updates and cease broadcasting.
- Zod strict object schemas whitelist writable fields; client Mongo operators and role changes are rejected. Search strings are escaped before regex queries. Body limits and Redis-backed auth/report rate limits bound obvious abuse. Rate-limit responses fail closed.
- Helmet adds API security headers. nginx adds response hardening and no-cache shell handling. Same-origin TLS, React escaping, no HTML injection and a private-free PWA cache reduce XSS exposure; review deployment CSP when changing providers.

## Location retention and operational duties

GPS is shared only during active trips. Ending clears latest position/cache and leaves room subscriptions. Historical points expire using `LOCATION_RETENTION_HOURS` (default 24); Mongo TTL deletion is asynchronous. Stale/offline readings keep their real accepted timestamp; they are never animated as live. Driver contact information is excluded from viewer DTOs.

Audit records track privileged changes and trip lifecycle without tokens or raw passwords. Pino redacts sensitive credential fields; do not enable shell tracing or request-cookie dumps. Protect MongoDB/Redis, mail inboxes, `.env`, certificate keys, test artifacts and backups. Never put server secrets in `VITE_*` variables.

Before public launch, arrange user consent, transport-office authorization, privacy/data-access policy, audit retention, encrypted backups with expiry, TLS renewal monitoring, mail abuse controls and an independent security assessment. A production-minded codebase is not a completed external security audit.
