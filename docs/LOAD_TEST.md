# Load testing

Concurrent viewers, open Socket.IO connections and HTTP requests per second measure different things. These profiles are measurement tools, not a 10k capacity guarantee. **Run only against infrastructure you control and are authorized to load-test.** The scripts require explicit target acknowledgment; loads above 100 viewers/RPS also require a separate opt-in. No large test is launched automatically by CI.

## HTTP profiles (k6)

Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/) using official instructions. Start a seeded local deployment and set `BASE_URL` to its same-origin server. Example modest smoke:

```bash
ACK_OWN_TARGET=YES BASE_URL=http://127.0.0.1:5173 PROFILE=smoke VUS=2 DURATION=10s k6 run tests/load/http.js
```

The script requests public routes/health with exactly one HTTP request per iteration. It reports p50/p95/p99 and failed/check rates to `load-http-summary.json`. Default objectives are error rate <1%, p95 <750ms, p99 <1500ms; tune with `MAX_ERROR_RATE`, `P95_MS`, `P99_MS`. These are adjustable test objectives, not availability claims.

After sizing generator/target, explicitly ramp viewers:

```bash
ACK_OWN_TARGET=YES ALLOW_LARGE_LOAD=YES PROFILE=1k VUS=1000 RAMP_DURATION=2m DURATION=2m BASE_URL=https://YOUR_OWN_STAGING_DOMAIN k6 run tests/load/http.js
ACK_OWN_TARGET=YES ALLOW_LARGE_LOAD=YES PROFILE=10k VUS=10000 RAMP_DURATION=10m DURATION=5m BASE_URL=https://YOUR_OWN_STAGING_DOMAIN k6 run tests/load/http.js
```

Separate arrival-rate target, one request/iteration:

```bash
ACK_OWN_TARGET=YES ALLOW_LARGE_LOAD=YES PROFILE=rps RATE=10000 VUS=2000 DURATION=60s BASE_URL=https://YOUR_OWN_STAGING_DOMAIN k6 run tests/load/http.js
```

That command asks the generator for 10k RPS; it is not proof that either machine can sustain it. Check achieved `http_reqs` rate, dropped iterations, errors and generator saturation. Scale generators if necessary. For authenticated endpoints supply `SESSION_COOKIE` securely through the environment; never commit or log it. Public schedules alone do not measure GPS or socket fanout.

## Socket.IO connection and broadcast profile

`tests/load/sockets.mjs` uses the real Socket.IO client, websocket transport, cookie session, Origin header and authorized trip subscription. It measures connection success/timing, subscribed viewers, disconnections, regressions and observed server-receipt-to-delivery time. Use a fresh verified student session and an active **demo** trip from an approved driver on a development target. Acquire the session through your normal test login/cookie jar; never paste real credentials into tracked files.

```bash
ACK_OWN_TARGET=YES BASE_URL=http://127.0.0.1:5173 ORIGIN=http://localhost:5173 TRIP_ID=YOUR_ACTIVE_DEMO_TRIP_ID SESSION_COOKIE="$LAL_TEST_SESSION_COOKIE" VUS=5 DURATION_SECONDS=20 node tests/load/sockets.mjs
```

Send authenticated driver GPS reports (real measured foreground points or labeled simulator samples) during the window. Set `EXPECTED_MESSAGES` only when the publishing harness sends exactly that many distinct versions during the test. Empty initial snapshots/duplicate versions do not count; without an expected count, dropped/missing messages remain explicitly **unmeasured**. Counts include a nonempty initial snapshot, so start with an empty trip for a precise publish test. Sender/receiver clocks must be synchronized for latency interpretation.

Use `ALLOW_LARGE_LOAD=YES VUS=1000` or `VUS=10000` only after provisioning file descriptors, source ports, Redis/Mongo capacity, proxy connection limits and generator resources. `BATCH_DELAY_MS` controls connection ramp batches; `REPORT_PATH` sets JSON report location. No production synthetic injection is permitted. Use an isolated staging environment rather than enabling development auth on a public production service.

## Record infrastructure evidence

Collect the API's admin-only Prometheus metrics (`/api/v1/admin/metrics`) through a secured collector, plus:

- API p50/p95/p99 latency, error status rates, process CPU/RSS, heap, event loop and active connections.
- Redis memory/evictions, connected clients, command latency, pub/sub/network throughput; noeviction memory limits must alert before writes fail.
- MongoDB operation latency, write throughput, pool waiters, CPU/disk, current connections and TTL backlog.
- Proxy connections/errors, websocket handshakes, network bandwidth, reconnect bursts and cache hit rates.
- Generator CPU/RAM/event loop/file descriptors to identify load-generator bottlenecks.

Record commit SHA, hardware, replicas/pool sizes, exact settings, achieved RPS/connection counts, run duration, all thresholds and final pass/fail. Keep cookies, mail tokens and coordinates out of shared reports. Set bounded logs/retention. Stop on rising errors, DB pressure or missed updates rather than silently relaxing thresholds.

## Deployment scaling

Use stateless API replicas with a shared Redis Socket.IO adapter and the same MongoDB. This build is websocket-only; polling requires sticky sessions if added later. CDN only public static assets/schedules, never auth or private GPS. Configure WebSocket upgrade support, sufficient proxy idle timeout and connection limits. Account for each replica's Mongo pool (currently 30) and Redis connections; benchmark freshness sweep cost as fleets grow. Any sustained 10k claim needs a measured, reproducible report from that actual architecture.
