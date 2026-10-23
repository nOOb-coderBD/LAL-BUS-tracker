# Deploy Lal Bus Tracker to Vercel

This deployment keeps the React PWA, Express API, secure session cookie and Socket.IO endpoint on one Vercel origin. Use externally hosted MongoDB, Redis and TLS-capable SMTP. No separate socket host or paid database is created by this repository.

Vercel's [current WebSocket guide](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections), updated 1 October 2026, documents native WebSocket/Socket.IO support in public beta on Fluid Compute. This deployment uses that capability. It still needs a successful authenticated deployment and real service connections before it has a working public URL.

## Before deploying

You need:

- A Vercel account with access to the project and this GitHub repository.
- A hosted MongoDB database that the deployment can reach, with authentication and TLS enabled.
- A hosted Redis connection URL supporting TCP connections and Redis pub/sub. A REST-only Redis API URL is not sufficient for ioredis or the Socket.IO adapter.
- A real SMTP service and approved sender for academic-mail ownership proof. Mailpit and development email files do not verify a public user's academic mailbox.
- The actual HTTPS production origin assigned by Vercel or configured as your custom domain. Use that exact origin in the settings below; do not invent a URL or use a deployment URL that belongs to another project.

Existing service credentials are entered privately in Vercel Environment Variables. Do not send secret values in chat, put them in `vercel.json`, or add them as `VITE_*` variables. Choosing or purchasing new services remains an operator decision.

## Project settings

Connect the repository to Vercel, or authenticate and link it with the Vercel CLI from the repository root:

```bash
npx vercel login
npx vercel link
```

If the CLI is already authenticated and linked to the intended project, reuse that binding. Select the existing project/team deliberately; do not create a replacement project to work around an access error.

Keep **Root Directory** at the repository root. Selecting `apps/web` alone excludes the API entrypoint and shared contracts. Use Node.js 24 and the checked-in `vercel.json` for build, output and routing settings. The build installs development tools as well as runtime packages, builds shared contracts/API/frontend, and serves the compiled frontend from `apps/web/dist`.

Enable **Fluid Compute** under project **Settings → Functions** if it is not already enabled. Current Vercel documentation says it is enabled by default for projects created on or after 23 April 2025.

## Environment variables

Configure these for the **Production** environment before testing the complete app:

| Name               | Value to configure                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`         | `production` (Vercel normally supplies this)                                                                   |
| `ALLOW_DEMO_AUTH`  | `false`                                                                                                        |
| `APP_ORIGIN`       | The actual, stable HTTPS production origin shown in this Vercel project; no path or trailing slash             |
| `ALLOWED_ORIGINS`  | The same exact origin; add only other origins you operate and explicitly need                                  |
| `COOKIE_SECURE`    | `true`                                                                                                         |
| `TRUST_PROXY`      | The verified trusted proxy hop count for the deployment ingress; `1` behind one trusted platform reverse proxy |
| `MONGODB_URI`      | The authenticated TLS connection string for the hosted database                                                |
| `REDIS_URL`        | The authenticated TCP/TLS Redis URL supporting pub/sub                                                         |
| `SMTP_HOST`        | Your actual SMTP host                                                                                          |
| `SMTP_PORT`        | Your provider's actual TLS/STARTTLS port                                                                       |
| `SMTP_USER`        | SMTP authentication user, when required                                                                        |
| `SMTP_PASS`        | SMTP credential, entered securely                                                                              |
| `SMTP_FROM`        | An approved sender address for your SMTP service                                                               |
| `DU_EMAIL_DOMAINS` | The exact academic domains approved for this deployment                                                        |

`SMTP_URL` can replace the individual SMTP connection/authentication fields. It must be an `smtp:` or `smtps:` connection URL without query overrides; encode credentials correctly and keep it private. Certificate verification and production TLS remain enabled.

Optional settings:

- `PUBLIC_URL` may specify the public base URL for verification links; otherwise the app uses `APP_ORIGIN`.
- `GOOGLE_CLIENT_ID` and `GOOGLE_WORKSPACE_DOMAINS` enable server-verified Google identity when the institution's Workspace policy is known. Email proof remains available independently.
- `VITE_MAP_TILE_URL` and `VITE_MAP_ATTRIBUTION` configure the public map provider at build time. Browser-visible tile keys are public configuration; use provider restrictions appropriate to that key. Follow the provider's attribution and traffic policy.
- Freshness, retention and session settings are documented in `.env.example` and `SECURITY.md`.

The direct API default `TRUST_PROXY=false`/`0` ignores forwarded client addresses. Legacy `true` is one trusted hop. Explicit counts 0–5 are supported. Use the actual fixed ingress chain, keep private origins private, and validate client-address handling before relying on per-IP abuse controls. The Docker Caddy → nginx → Express example is a different two-proxy topology and does not determine Vercel's hop setting.

Do not use `ALLOW_DEMO_AUTH=true` in production. Public development personas would grant simulated student, driver and admin access. The API refuses that production combination.

Preview deployment URLs differ from the stable production origin. Configure preview origins and separate nonproduction service bindings deliberately if previews are needed; a broad allowlist for unrelated `vercel.app` tenants is not appropriate.

## Migrate and import the hosted database

Run the index migration and idempotent source importer against the actual hosted database. Deployment does not create a MongoDB/Redis service or silently replace it with in-memory data.

One way to obtain the configured production variables securely on a trusted workstation is:

```bash
umask 077
npx vercel env pull .env.vercel.production --environment=production
chmod 600 .env.vercel.production
NODE_ENV=production ALLOW_DEMO_AUTH=false node --env-file=.env.vercel.production --import tsx apps/api/src/cli.ts migrate
NODE_ENV=production ALLOW_DEMO_AUTH=false node --env-file=.env.vercel.production --import tsx apps/api/src/cli.ts seed
```

Authenticate/link the intended project first and preserve any pre-existing local env file. `.env.vercel.production` is gitignored; protect and remove it when it is no longer needed. Run `npm ci --include=dev` on the workstation first if the CLI dependencies are not installed. Explicit production flags prevent the repository's local development `.env` from enabling simulated accounts during this operation.

The importer preserves all 17 source routes, 205 source schedule entries, duplicate times, unknown operating days and original metadata. Every source entry initially needs admin verification. Do not run `db:demo` against production.

Bootstrap an administrator through the existing protected CLI using the same private environment file:

```bash
NODE_ENV=production ALLOW_DEMO_AUTH=false node --env-file=.env.vercel.production --import tsx apps/api/src/cli.ts admin --email "$ADMIN_EMAIL" --name "$ADMIN_NAME"
```

Set `ADMIN_EMAIL` and `ADMIN_NAME` to the actual operator's non-secret identity in your terminal. The account still needs mailbox ownership proof. Driver invitations, approvals and real bus assignments follow `README.md`; no public endpoint creates privileged roles.

## Deploy and verify the actual URL

After the project, environment variables and database are prepared:

```bash
npx vercel --prod
```

Use the successful deployment URL reported by Vercel and its configured production alias. A local build, a Git push or a static landing page alone is not evidence that the API and tracking flow work publicly.

Validate on that actual deployment:

1. `/api/v1/health/live` and `/api/v1/health/ready` must succeed, with readiness reporting both MongoDB and Redis available.
2. Load routes and schedules from the hosted database. Source schedules remain clearly unverified; no physical fleet or live GPS is inferred from them.
3. Verify an actual academic mailbox through the configured SMTP provider. Non-DU addresses and unverified sessions must be rejected.
4. Log in with an approved, assigned driver account and a separate student account. Start a trip, grant foreground location permission over trusted HTTPS, and confirm that the student's exact accepted reading updates through Socket.IO.
5. Keep a viewer connected beyond the function duration. Confirm reconnect, re-subscription and authoritative snapshot recovery. End the trip and verify that sharing and active visibility cease.
6. Confirm that offline PWA caches contain static assets, not private API/GPS responses. `DEPLOYMENT_URL` can point the existing `npm run test:deployment` check at the actual deployment after the basic flow works.
7. Follow the exact two-phone steps in `DEPLOYMENT.md` with the public HTTPS origin. A public trusted Vercel certificate removes the need to install the laptop's local development CA.

Socket.IO uses WebSocket transport directly. Connections can land on different function instances, so MongoDB remains authoritative and Redis supplies session storage, latest-location data and cross-instance fanout. Never rely on one warm function's memory to retain users or trip state.

Vercel currently documents a 300-second maximum on Hobby, with other limits depending on the selected plan. Connections close at the function's maximum duration and must reconnect; beta behavior and pricing may change. Open connections can keep function memory billable. This repository does not upgrade a plan or claim 10,000-viewer/RPS capacity. Measure an authorized deployment before making capacity promises.

## If deployment is blocked

- Vercel login/team/project access must be supplied through Vercel's supported authentication flow, not a token pasted into chat.
- MongoDB/Redis connection failures keep readiness unavailable; verify the actual URI, network access and provider connection limits while preserving TLS verification.
- SMTP failures keep real email sign-in unavailable. Configure the actual sender/service; do not enable demo authentication to bypass production proof.
- If the current Vercel project does not have Fluid Compute/native WebSocket support available, treat realtime deployment as blocked until that platform requirement is resolved. Do not silently substitute a static tracker or claim socket validation passed.
