# HTTP and Socket.IO API

Base path `/api/v1`; same-origin HTTPS in deployment. The complete machine-readable [OpenAPI document](openapi.json) is also served at `GET /api/v1/openapi`.

Collections return `{items,total,page,limit}`; entities return `{item}`. IDs are MongoDB ObjectID strings unless a public route lookup explicitly accepts slug. Public lists accept `page` ≥1, bounded `limit` (default30/max100), and escaped `search`. Admin lists default100/max500. Error shape is `{error:{code,message,issues?}}`; no stack traces or credentials are exposed.

## Sessions and mutations

`GET /auth/me` returns `{user,csrfToken,demoEnabled}`; anonymous user/CSRF are null. Login returns the same structure and sets `lal_session` (HttpOnly, SameSite=Lax, Secure in production). Send browser credentials; do not store session tokens in localStorage. Send exact allowed `Origin` on mutations. Once authenticated, include `X-CSRF-Token` on every non-auth mutation including logout. Email start/verify, Google and dev-login still require Origin, but no prior CSRF.

| Method/path                             | Access                   | Behavior                                                               |
| --------------------------------------- | ------------------------ | ---------------------------------------------------------------------- |
| GET `/health/live`                      | Public                   | Process liveness                                                       |
| GET `/health/ready`                     | Public                   | Mongo and Redis ping; 503 on unavailable                               |
| GET `/stats`                            | Public                   | Route/schedule counts; real active-trip count separate from demo count |
| POST `/auth/email/start`                | Public                   | `{email}` sends single-use 15-minute link; 202 on delivery             |
| POST `/auth/email/verify`               | Public                   | `{token}` atomically consumes proof, rotates session                   |
| POST `/auth/google`                     | Public                   | `{idToken}` verifies configured Google academic Workspace identity     |
| POST `/auth/dev-login`                  | Development only         | `{persona:"student"                                                    | "driver"                                     | "admin" | "unapproved"}`; disabled production |
| GET `/auth/me`                          | Any                      | Current authoritative session, CSRF, demo mode                         |
| POST `/auth/logout`                     | Session + CSRF           | Revoke cookie session and socket connections                           |
| GET `/routes`                           | Public                   | Search names/slugs/subtitle, paginated                                 |
| GET `/routes/:id`                       | Public                   | ID or slug; draft source and missing geometry preserved                |
| GET `/routes/:id/schedule`              | Public                   | ObjectID and optional `direction=UP                                    | DOWN`; Asia/Dhaka schedule, unknown-day flag |
| GET `/buses`                            | Public inventory         | `routeId`, `search`, `status`; `assigned=true` requires driver         |
| GET `/buses/:id`                        | Public inventory         | Contact/assignment privacy depends on current role                     |
| GET `/buses/:id/live`                   | Student/Admin            | Active snapshot or null; private GPS                                   |
| GET `/trips/active`                     | Student/Admin            | Paginated snapshots; optional `routeId`                                |
| GET `/driver/trips/active`              | Driver                   | Own recoverable active trip or null                                    |
| POST `/driver/trips/start`              | Approved assigned driver | `{busId,routeId,direction,scheduleEntryId?}`                           |
| POST `/driver/trips/:id/locations`      | Owning assigned driver   | Validated GPS observation; rejects ended/unassigned writes             |
| POST `/driver/trips/:id/end`            | Owning driver            | Idempotent end, removes GPS/live cache                                 |
| GET `/admin/drivers`                    | Admin                    | Joined user/profile approval and bus assignments                       |
| PATCH `/admin/drivers/:id/approval`     | Admin                    | `{approved,allowedBusIds?}`; revocation ends active trip               |
| GET/POST `/admin/buses`                 | Admin                    | Inventory listing/create                                               |
| GET/PATCH/DELETE `/admin/buses/:id`     | Admin                    | Strict partial updates; disable/retire ends active trip                |
| GET/POST `/admin/routes`                | Admin                    | Route listing/create                                                   |
| GET/PATCH/DELETE `/admin/routes/:id`    | Admin                    | Review status, stop descriptions, verified geometry                    |
| GET/POST `/admin/schedules`             | Admin                    | Full timetable listing/create                                          |
| GET/PATCH/DELETE `/admin/schedules/:id` | Admin                    | Time/day/variant/staff-only/source review                              |
| POST `/admin/trips/:id/end`             | Admin                    | Ends abandoned trip with audit                                         |
| GET `/admin/audit`                      | Admin                    | Paginated privileged/lifecycle audit                                   |
| GET `/admin/export`                     | Admin                    | JSON export of buses/routes/schedules                                  |
| GET `/admin/metrics`                    | Admin                    | Prometheus process + HTTP metrics                                      |

Example location body (actual values must come from a device; no sample coordinates here):

```typescript
{
  eventId: crypto.randomUUID(),
  latitude: position.coords.latitude,
  longitude: position.coords.longitude,
  observedAt: new Date(position.timestamp).toISOString(),
  accuracy: position.coords.accuracy,
  heading: position.coords.heading,
  speed: position.coords.speed
}
```

`simulated:true` is restricted to explicitly labeled development demo drivers/trips. Server accepts recent observations (up to120s old/10s ahead), enforces accuracy and jump checks, and caps ingestion at30/minute/driver. Each accepted DTO has monotonically increasing `version`, `freshness`, and latest observed/received timestamps. Ended DTOs have `latestPosition:null`; no precise driver movement is shared after end.

Common errors: 400 `VALIDATION_ERROR`, 401 `AUTH_REQUIRED`, 403 `FORBIDDEN`/`CSRF_REJECTED`/`ORIGIN_REJECTED`/assignment errors, 404 missing record, 409 active-trip conflict or out-of-order observation, 422 invalid observation/relationship, 429 auth/report rate limit, 503 missing/unavailable external service. Full API validation remains authoritative; clients must surface error messages and refresh snapshots after conflicts.

## Socket.IO

Same-origin cookie-authenticated Socket.IO v4, websocket-only transport. Only verified students/admins connect. Send `subscribe:trip` with `{tripId}` and an acknowledgement callback. Success is `{ok:true,item:tripSnapshot}`; error `{ok:false,error:{code,message}}`. Initial `trip:location` also supplies the authoritative snapshot. Use `unsubscribe:trip {tripId}` when leaving.

Events: `trip:started`, `trip:location`, `trip:stale`, `trip:ended`, `bus:status`. Trip events carry a direct trip DTO; status is `{tripId,busId,freshness,version}`. Subscribe only to selected trips, resubscribe after reconnect, compare version/timestamps, and never animate stale observations. Active discovery uses HTTP refetch, not a global location broadcast. End removes clients from that room. Logout/expiry revokes sockets. The Redis adapter carries rooms/events across replicas; HTTP polling is disabled, so no sticky-session dependency is introduced.
